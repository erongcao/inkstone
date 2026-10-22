//! 图片资源：把拖进来的图片落盘、把 Markdown 里的图片路径变成 WebView 能显示的 URL。
//!
//! ## 为什么不直接用 `asset://` 协议
//!
//! Tauri 2 的 asset protocol 需要在 `tauri.conf.json` 里配 `assetProtocol.scope`，
//! 而 scope 本质是**一份允许 WebView 读取的目录白名单**——放宽它等于把整个用户目录
//! 交给渲染层，缩窄它又会挡掉「文档在 A 目录、图片在 B 目录」这类正常用法。
//! 权衡之后选了另一条路：Rust 侧读文件、拼 `data:` URL 交给前端。
//!
//! 代价是内存（base64 比原文件大 1/3）与读盘开销，收益是：
//!   - **不需要动安全配置**，默认权限模型不变
//!   - 相对路径、绝对路径、跨目录路径走同一条代码路径，行为完全一致
//!   - 浏览器降级模式下（`pnpm dev`）也能工作，不依赖 Tauri
//!
//! 大文件不内联：超过 [`MAX_INLINE_BYTES`] 直接报错，
//! 前端退回显示替代文本——一张 20 MB 的原图不该把内存吃穿。

use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use tauri::{AppHandle, Manager};

/// 图片子目录名（Typora 同款约定）
const ASSET_DIR: &str = "assets";

/// 未命名文档时图片的落盘位置
const UNTITLED_DIR: &str = "Pictures/Inkstone";

/// 超过这个大小就不内联成 data URL
const MAX_INLINE_BYTES: u64 = 16 * 1024 * 1024;

/// 一次拖放允许的最大图片体积，防止前端传进来几百 MB
const MAX_UPLOAD_BYTES: usize = 64 * 1024 * 1024;

/// 把可能带目录分隔符的名字压成单个安全文件名。
///
/// **这是安全边界**：文件名来自拖放事件 / 剪贴板，属于外部输入。
/// 只取最后一段、再把文件系统非法字符与控制字符换成 `_`，
/// 保证结果一定落在目标目录里（挡掉 `../../etc/passwd` 这类穿越）。
fn sanitize_file_name(name: &str) -> Result<String, String> {
    // 先按两种分隔符切，取最后一段（Windows 的 `\` 在 Unix 上不是分隔符）
    let tail = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let cleaned: String = tail
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|' | '/' | '\\') {
                '_'
            } else {
                c
            }
        })
        .collect();
    let cleaned = cleaned.trim().trim_start_matches('.').to_string();
    if cleaned.is_empty() {
        return Err("文件名无效".to_string());
    }
    Ok(cleaned)
}

/// 文档所在目录；未命名文档退回 `~/Pictures/Inkstone`
fn asset_base_dir(app: &AppHandle, doc_path: Option<&str>) -> Result<PathBuf, String> {
    if let Some(path) = doc_path.filter(|p| !p.trim().is_empty()) {
        let parent = Path::new(path)
            .parent()
            .ok_or_else(|| "文档路径没有父目录".to_string())?;
        return Ok(parent.join(ASSET_DIR));
    }
    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("取不到用户主目录: {e}"))?;
    Ok(home.join(UNTITLED_DIR))
}

/// 给文件换个不冲突的名字：`a.png` → `a-1.png` → `a-2.png`
///
/// **永远不覆盖已有文件**：用户拖进来一张和现有图片同名的图，
/// 直接覆盖等于悄悄毁掉他之前放进去的东西。
async fn unique_path(dir: &Path, file_name: &str) -> Result<PathBuf, String> {
    let candidate = dir.join(file_name);
    if !exists(&candidate).await {
        return Ok(candidate);
    }
    let (stem, ext) = match file_name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (file_name.to_string(), String::new()),
    };
    for n in 1..10_000u32 {
        let next = dir.join(format!("{stem}-{n}{ext}"));
        if !exists(&next).await {
            return Ok(next);
        }
    }
    // 一万个同名几乎不可能；真撞上就退回带时间戳的名字，不覆盖任何东西
    Ok(dir.join(format!(
        "{stem}-{}{ext}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    )))
}

/// 「文件是否已存在」——权限错误一律当作「不存在」，让后续写入去报错
async fn exists(path: &Path) -> bool {
    tokio::fs::try_exists(path).await.unwrap_or(false)
}

/// 把绝对路径写成相对文档的正斜杠路径（相对不了才退回绝对路径）
fn to_markdown_path(written: &Path, base_dir: &Path) -> String {
    let base = base_dir.parent().unwrap_or(base_dir);
    match written.strip_prefix(base) {
        Ok(rel) => rel
            .components()
            .map(|c| c.as_os_str().to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join("/"),
        // 跨卷符 / 跨盘符时 strip_prefix 会失败，老实写绝对路径
        Err(_) => written.to_string_lossy().to_string(),
    }
}

/// 保存一张图片，返回写进 Markdown 的路径。
///
/// `bytes` 传 base64 而不是 `Vec<u8>`：Tauri 的 JSON IPC 会把字节数组
/// 展开成 `[104,105,…]` 这种数字列表，一张 1 MB 的图就是 100 万个数字，
/// 序列化本身就是瓶颈。base64 文本走同一条通道，体积还更小。
#[tauri::command]
pub async fn save_image(
    app: AppHandle,
    doc_path: Option<String>,
    file_name: String,
    data_base64: String,
) -> Result<String, String> {
    if data_base64.len() > MAX_UPLOAD_BYTES * 2 {
        return Err("图片太大了（上限 64 MB）".to_string());
    }
    let bytes = BASE64
        .decode(data_base64.as_bytes())
        .map_err(|e| format!("图片数据解码失败: {e}"))?;

    let base_dir = asset_base_dir(&app, doc_path.as_deref())?;
    let dir = base_dir.parent().unwrap_or(&base_dir).to_path_buf();
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("创建 {} 失败: {e}", dir.display()))?;

    let safe_name = sanitize_file_name(&file_name)?;
    let target = unique_path(&dir, &safe_name).await?;

    // 与文档写入同款：先写临时文件再 rename，避免半张图
    let temp = dir.join(format!(".{safe_name}.inkstone.tmp"));
    tokio::fs::write(&temp, &bytes)
        .await
        .map_err(|e| format!("写入图片失败: {e}"))?;
    if let Err(e) = tokio::fs::rename(&temp, &target).await {
        let _ = tokio::fs::remove_file(&temp).await;
        return Err(format!("保存图片失败 ({}): {e}", target.display()));
    }

    Ok(to_markdown_path(&target, &base_dir))
}

/// 根据扩展名猜 MIME（够用即可，不追求覆盖全部几百种格式）
fn mime_from_extension(ext: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        "heic" => "image/heic",
        "tiff" | "tif" => "image/tiff",
        _ => "application/octet-stream",
    }
}

/// 把 Markdown 里的图片地址解析成 WebView 能显示的 URL。
///
/// - `http(s)://` / `data:` / 绝对路径 → 原样返回
/// - 相对路径 → 按**文档所在目录**解析（这是 Markdown 的通用约定，
///   也是 Typora / VS Code / Obsidian 的做法）
///
/// 相对路径里常带百分号编码（`my%20photo.png`），这里解码后再读盘。
#[tauri::command]
pub async fn read_image_data_url(doc_path: Option<String>, src: String) -> Result<String, String> {
    let trimmed = src.trim();
    if trimmed.is_empty() {
        return Err("图片地址为空".to_string());
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("data:")
        || lower.starts_with("blob:")
    {
        return Ok(trimmed.to_string());
    }

    let decoded = percent_decode(trimmed);
    let raw = Path::new(&decoded);
    let absolute = if raw.is_absolute() {
        raw.to_path_buf()
    } else {
        let base = match doc_path.as_deref().filter(|p| !p.trim().is_empty()) {
            Some(p) => Path::new(p)
                .parent()
                .ok_or_else(|| "文档路径没有父目录".to_string())?
                .to_path_buf(),
            // 没有文档可作基准时，相对路径无从解析——直接说清楚，别猜
            None => return Err("未保存的文档无法解析相对图片路径".to_string()),
        };
        base.join(raw)
    };

    let meta = tokio::fs::metadata(&absolute)
        .await
        .map_err(|e| format!("读取图片失败 ({}): {e}", absolute.display()))?;
    if meta.len() > MAX_INLINE_BYTES {
        return Err(format!(
            "图片超过 {} MB，未内联显示",
            MAX_INLINE_BYTES / 1024 / 1024
        ));
    }
    let bytes = tokio::fs::read(&absolute)
        .await
        .map_err(|e| format!("读取图片失败 ({}): {e}", absolute.display()))?;

    let ext = absolute
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default();
    Ok(format!(
        "data:{};base64,{}",
        mime_from_extension(ext),
        BASE64.encode(&bytes)
    ))
}

/// 最小化的百分号解码：只处理 `%XX`，其余原样保留
fn percent_decode(text: &str) -> String {
    if !text.contains('%') {
        return text.to_string();
    }
    let bytes = text.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(byte) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// 给单元测试用：路径 → Markdown 里的写法
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 文件名里的目录成分被剥掉() {
        assert_eq!(sanitize_file_name("../../etc/passwd").unwrap(), "passwd");
        assert_eq!(sanitize_file_name("C:\\Users\\me\\a.png").unwrap(), "a.png");
    }

    #[test]
    fn 非法字符被替换而不是被删掉() {
        assert_eq!(sanitize_file_name("a:b*c?.png").unwrap(), "a_b_c_.png");
        assert_eq!(sanitize_file_name("图 片.png").unwrap(), "图 片.png");
    }

    #[test]
    fn 隐藏文件与空名被拒() {
        assert!(sanitize_file_name(".").is_err());
        assert!(sanitize_file_name("   ").is_err());
        assert_eq!(sanitize_file_name(".gitignore").unwrap(), "gitignore");
    }

    #[test]
    fn 相对路径用正斜杠() {
        let base = Path::new("/docs/note/assets");
        let written = Path::new("/docs/note/assets/图 1.png");
        assert_eq!(to_markdown_path(written, base), "assets/图 1.png");
    }

    #[test]
    fn 跨目录时退回绝对路径() {
        let base = Path::new("/docs/note/assets");
        let written = Path::new("/other/pic.png");
        assert_eq!(to_markdown_path(written, base), "/other/pic.png");
    }

    #[test]
    fn 百分号解码() {
        assert_eq!(percent_decode("my%20photo.png"), "my photo.png");
        assert_eq!(percent_decode("中文.png"), "中文.png");
        assert_eq!(percent_decode("%E4%B8%AD.png"), "中.png");
        assert_eq!(percent_decode("100%.png"), "100%.png");
    }

    #[test]
    fn 扩展名映射() {
        assert_eq!(mime_from_extension("PNG"), "image/png");
        assert_eq!(mime_from_extension("jpeg"), "image/jpeg");
        assert_eq!(mime_from_extension("svg"), "image/svg+xml");
    }
}

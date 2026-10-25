//! pandoc 桥：把 Markdown 转成 pandoc 支持的格式（docx / odt / epub / rtf / latex / mediawiki / rst）。
//!
//! ## 为什么调外部进程而不是链接 pandoc 库
//!
//! pandoc 是 GPL-2.0 授权的 Haskell 程序。本项目是 MIT 授权，**不能**链接或内嵌 pandoc 的代码
//! ——那会让整个应用变成 GPL 作品。以**独立进程**方式调用则是合法的：pandoc 自己的许可证
//! 不传染到调用方。
//!
//! 这一点在 `scripts/check-licenses.mjs` 的白名单里有对应说明（pandoc 根本不在
//! npm 依赖树里，所以不会被扫到）。
//!
//! ## 为什么 pandoc 侧的输出不经过前端
//!
//! docx / epub / odt 是**二进制**（zip 容器）。如果走「Rust → base64 → JS → base64 → Rust」
//! 的通道，一份 1 MB 的 docx 会在 IPC 上产生约 2.7 MB 的字符串，纯粹浪费。
//! 所以命令分成两段：
//!   1. 前端弹「另存为」对话框，拿到目标路径
//!   2. 前端把 **Markdown 源码**（文本）+ 目标路径传给本命令
//!   3. 本命令启动 pandoc，把 **Markdown 从 stdin 灌进去**，让 pandoc **直接写目标文件**
//!
//! 这样二进制数据一个字节都不用穿过 JS 边界。
//!
//! ## pandoc 的 Markdown 扩展要显式对齐
//!
//! pandoc 默认的 `markdown` 读写器已经包含 GFM 表格、任务列表、自动链接、围栏代码块，
//! 但**不含** `$...$` 行内公式（那是 `tex_math_dollars` 扩展）。
//! 本项目的解析层（remark-math）默认开启单 `$`，所以这里显式加上该扩展，
//! 让 pandoc 的行为与编辑器内所见一致（架构约束 3：解析规则唯一——同一份内容在两处
//! 必须解析成同样的结构）。
//!
//! `--from=markdown+tex_math_dollars+yaml_metadata_block` 就是这个对齐点。

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use tokio::sync::oneshot;

/// pandoc 的可执行文件名（Windows 下带 .exe）
#[cfg(windows)]
const PANDOC_BIN: &str = "pandoc.exe";
#[cfg(not(windows))]
const PANDOC_BIN: &str = "pandoc";

/// pandoc 输出格式 → 文件对话框里的过滤器名
fn filter_label(format: &str) -> &str {
    match format {
        "docx" => "Word 文档",
        "odt" => "OpenDocument 文档",
        "epub" => "EPUB 电子书",
        "rtf" => "RTF 富文本",
        "latex" => "LaTeX 源码",
        "mediawiki" => "MediaWiki 标记",
        "rst" => "reStructuredText",
        _ => "文件",
    }
}

/// pandoc 的输出格式 → 文件扩展名
fn extension_of(format: &str) -> &str {
    match format {
        "docx" => "docx",
        "odt" => "odt",
        "epub" => "epub",
        "rtf" => "rtf",
        "latex" => "tex",
        "mediawiki" => "mediawiki",
        "rst" => "rst",
        _ => "txt",
    }
}

/// pandoc 探测结果
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PandocInfo {
    /// 是否可用
    pub available: bool,
    /// 版本号首行（如 "pandoc 3.8"）；不可用时为空串
    pub version: String,
    /// 实际使用的可执行文件路径；不可用时为空串
    pub path: String,
    /// 不可用的原因（人类可读）
    pub reason: String,
}

/// 在 PATH 与若干常见安装位置里找 pandoc。
///
/// 常见位置是必要的：Homebrew / MacPorts / conda 装的 pandoc **不一定**在 GUI 应用
/// 继承到的 PATH 里（macOS 从 Finder 启动的 GUI 应用拿到的是系统最小 PATH，
/// 常常只有 `/usr/bin:/bin:/usr/sbin:/sbin`）。找不到就报「未安装」，
/// 而实际上用户装了——那是最让人抓狂的一类误报。
fn find_pandoc() -> Option<PathBuf> {
    // 1. PATH
    if let Ok(path) = std::env::var("PATH") {
        for dir in path.split(':') {
            if dir.is_empty() {
                continue;
            }
            let candidate = Path::new(dir).join(PANDOC_BIN);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    // 2. 常见安装位置
    let home = std::env::var("HOME").unwrap_or_default();
    let mut candidates: Vec<PathBuf> = vec![
        PathBuf::from("/opt/homebrew/bin").join(PANDOC_BIN),
        PathBuf::from("/usr/local/bin").join(PANDOC_BIN),
        PathBuf::from("/usr/bin").join(PANDOC_BIN),
        PathBuf::from("/opt/anaconda3/bin").join(PANDOC_BIN),
        PathBuf::from("/snap/bin").join(PANDOC_BIN),
    ];
    if !home.is_empty() {
        candidates.push(Path::new(&home).join(".local/bin").join(PANDOC_BIN));
        candidates.push(Path::new(&home).join(".pandoc/bin").join(PANDOC_BIN));
    }
    candidates.into_iter().find(|path| path.is_file())
}

/// 探测 pandoc 是否可用，并取回版本号
#[tauri::command]
pub fn detect_pandoc() -> PandocInfo {
    let Some(path) = find_pandoc() else {
        return PandocInfo {
            available: false,
            version: String::new(),
            path: String::new(),
            reason: "未找到 pandoc。安装后即可导出 Word / EPUB / LaTeX 等格式".to_string(),
        };
    };

    let output = Command::new(&path).arg("--version").output();
    match output {
        Ok(out) if out.status.success() => {
            let version = String::from_utf8_lossy(&out.stdout)
                .lines()
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            PandocInfo {
                available: true,
                version,
                path: path.to_string_lossy().to_string(),
                reason: String::new(),
            }
        }
        Ok(out) => PandocInfo {
            available: false,
            version: String::new(),
            path: path.to_string_lossy().to_string(),
            reason: format!(
                "pandoc 无法运行: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ),
        },
        Err(err) => PandocInfo {
            available: false,
            version: String::new(),
            path: path.to_string_lossy().to_string(),
            reason: format!("pandoc 无法启动: {err}"),
        },
    }
}

/// 弹「另存为」对话框选 pandoc 输出的目标路径。
///
/// 返回 `None` 表示用户取消。
#[tauri::command]
pub async fn pick_pandoc_output(
    app: AppHandle,
    format: String,
    suggested_name: String,
) -> Result<Option<String>, String> {
    let (tx, rx) = oneshot::channel();

    let ext = extension_of(&format).to_string();
    app.dialog()
        .file()
        .set_title("导出")
        .add_filter(filter_label(&format), &[&ext])
        .set_file_name(&suggested_name)
        .save_file(move |picked| {
            let _ = tx.send(picked);
        });

    let picked = rx.await.map_err(|e| format!("文件对话框异常: {e}"))?;
    let Some(file_path) = picked else {
        return Ok(None);
    };
    let path = file_path
        .into_path()
        .map_err(|e| format!("无法解析文件路径: {e}"))?;
    Ok(Some(path.to_string_lossy().to_string()))
}

/// 用 pandoc 把 Markdown 转成目标格式，直接写到 `output_path`。
///
/// `source` 是 Markdown 源码（含 front matter），`resource_dir` 是文档所在目录——
/// pandoc 解析相对路径的图片时需要它来找文件，缺了会把图片静默丢掉。
///
/// 返回值里的 `warnings` 是 pandoc 的警告（如「公式无法转成 OMML，降级成 TeX」）。
/// 它们不影响导出成功，但用户应该知道——否则打开 Word 才发现公式不对却不知原因。
#[tauri::command]
pub async fn convert_with_pandoc(
    format: String,
    source: String,
    output_path: String,
    resource_dir: String,
) -> Result<PandocOutput, String> {
    let Some(pandoc) = find_pandoc() else {
        return Err("未找到 pandoc，无法导出该格式。请先安装 pandoc".to_string());
    };

    // 阻塞的子进程调用放进 spawn_blocking：
    // pandoc 转换一份长文档要几百毫秒，直接在异步任务里同步等会把运行时线程占住。
    tauri::async_runtime::spawn_blocking(move || {
        run_pandoc(&pandoc, &format, &source, &output_path, &resource_dir)
    })
    .await
    .map_err(|e| format!("导出任务异常: {e}"))?
}

/// 真正跑 pandoc 子进程
fn run_pandoc(
    pandoc: &Path,
    format: &str,
    source: &str,
    output_path: &str,
    resource_dir: &str,
) -> Result<PandocOutput, String> {
    let mut child = Command::new(pandoc)
        .arg("--from=markdown+tex_math_dollars+yaml_metadata_block")
        .arg(format!("--to={format}"))
        .arg(format!("--output={output_path}"))
        // 相对路径图片按文档所在目录解析
        .arg(format!("--resource-path={resource_dir}"))
        // standalone：LaTeX / docx 等需要完整文档结构；mediawiki / rst 不需要，
        // 但开着也无害（pandoc 对这几个格式会忽略）
        .arg("--standalone")
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("启动 pandoc 失败: {e}"))?;

    // 把 Markdown 写进 stdin 然后关闭——pandoc 读到 EOF 才会开始转换
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(source.as_bytes())
            .map_err(|e| format!("向 pandoc 写入内容失败: {e}"))?;
        // 显式 drop 关闭管道；不关的话 pandoc 会一直等 stdin
        drop(stdin);
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("等待 pandoc 结束失败: {e}"))?;

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if output.status.success() {
        // 成功但有警告：**要带回去**。
        //
        // 实测例子：pandoc 转 docx/odt/epub 时遇到块级公式会警告
        // 「Could not convert TeX math ... rendering as TeX」——
        // 也就是说 Word 里的公式会变成一段 TeX 源码。
        // 用户拿到文件才发现公式不对，却完全不知道原因；
        // 而这个信息 pandoc 已经告诉我们了。
        //
        // 警告与错误要分开：警告不影响导出成功，但用户应该知道。
        return Ok(PandocOutput {
            warnings: parse_warnings(&stderr),
        });
    }

    // pandoc 的错误信息全在 stderr。**要如实带回去**——
    // 「导出失败」四个字对用户毫无用处，
    // 而 pandoc 的 stderr 通常直接写着「Unknown option」或「Could not read file」这种能定位的话。
    if stderr.is_empty() {
        return Err(format!("pandoc 退出码 {:?}", output.status.code()));
    }
    Err(stderr)
}

/// pandoc 的输出（成功时的警告）
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PandocOutput {
    /// pandoc 的警告（成功时也可能出现）
    pub warnings: Vec<String>,
}

/// 从 stderr 里提取警告。
///
/// pandoc 的警告格式是 `[WARNING] 内容`（可能多行）。
/// 只取 `[WARNING]` 开头的行——其它内容（普通日志）不用打扰用户。
fn parse_warnings(stderr: &str) -> Vec<String> {
    if stderr.is_empty() {
        return Vec::new();
    }
    let mut warnings = Vec::new();
    let mut current = String::new();
    for line in stderr.lines() {
        if line.starts_with("[WARNING]") {
            if !current.is_empty() {
                warnings.push(current.trim().to_string());
            }
            current = line.trim_start_matches("[WARNING]").trim().to_string();
        } else if !current.is_empty() {
            // 警告的续行（缩进的公式内容之类）
            current.push('\n');
            current.push_str(line);
        }
    }
    if !current.is_empty() {
        warnings.push(current.trim().to_string());
    }
    warnings
}

/// 探测 pandoc 的版本（同步，供 Rust 内部测试用）
#[cfg(test)]
pub(crate) fn detect_pandoc_sync() -> PandocInfo {
    detect_pandoc()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 输出格式对应正确的扩展名() {
        assert_eq!(extension_of("docx"), "docx");
        assert_eq!(extension_of("epub"), "epub");
        assert_eq!(extension_of("latex"), "tex");
        assert_eq!(extension_of("mediawiki"), "mediawiki");
        assert_eq!(extension_of("rst"), "rst");
        // 未知格式兜底成 txt，不能返回空串——那会让文件名变成「文档.」
        assert_eq!(extension_of("unknown"), "txt");
    }

    #[test]
    fn 过滤器名字对每种格式都不是空的() {
        for format in ["docx", "odt", "epub", "rtf", "latex", "mediawiki", "rst"] {
            assert!(!filter_label(format).is_empty(), "{format} 缺过滤器名");
        }
    }

    #[test]
    fn 探测_pandoc_不会崩溃() {
        // 装了就是 available=true，没装就是 false——
        // 两种情况都必须给出可读的 version/reason，不能是空串
        let info = detect_pandoc_sync();
        if info.available {
            assert!(!info.version.is_empty(), "可用时版本号不能为空");
            assert!(!info.path.is_empty());
        } else {
            assert!(!info.reason.is_empty(), "不可用时必须说明原因");
        }
    }

    #[test]
    fn 找不到_pandoc_时报错而不是静默成功() {
        // 用一个肯定不存在的路径调 run_pandoc：
        // 错误信息必须带上原因，不能是空串
        let err = run_pandoc(
            Path::new("/nonexistent/pandoc"),
            "docx",
            "# hi",
            "/tmp/out.docx",
            "/tmp",
        )
        .unwrap_err();
        assert!(!err.is_empty());
        assert!(
            err.contains("pandoc"),
            "错误信息要说明是 pandoc 的问题: {err}"
        );
    }

    #[test]
    fn 警告被单独提取出来() {
        // 实测 pandoc 的输出格式
        let stderr =
            "[WARNING] Could not convert TeX math \n  \\int_0^1 x^2 dx\n  , rendering as TeX\n";
        let warnings = parse_warnings(stderr);
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("Could not convert TeX math"));
        // 续行也要带进来——公式源码在下一行
        assert!(warnings[0].contains("int_0^1"));
    }

    #[test]
    fn 多条警告分别提取() {
        let stderr = "[WARNING] 第一条\n[WARNING] 第二条\n";
        let warnings = parse_warnings(stderr);
        assert_eq!(warnings.len(), 2);
        assert_eq!(warnings[0], "第一条");
        assert_eq!(warnings[1], "第二条");
    }

    #[test]
    fn 非警告内容不被当成警告() {
        // 普通日志不该打扰用户
        assert!(parse_warnings("some ordinary log line\n").is_empty());
        assert!(parse_warnings("").is_empty());
    }
}

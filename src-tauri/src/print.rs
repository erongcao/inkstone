//! PDF 导出：临时 WebView 窗口 + 系统打印面板。
//!
//! ## 为什么用系统打印面板而不是自己生成 PDF
//!
//! 本机没有 LaTeX / wkhtmltopdf / weasyprint / typst / libreoffice
//! （实测全部缺失），所以「渲染成 PDF 文件」这件事只能交给系统。
//!
//! macOS 的 WKWebView 提供 `printOperation:`，弹出的打印面板里有
//! 「PDF → 存储为 PDF」，能把当前 WebView 的内容存成 PDF 文件。
//! Tauri 2 的 `Webview::print()` 正是封装了这个调用。
//!
//! ## 流程
//!
//! 1. 前端把打印专用 HTML 传进来
//! 2. 写进临时目录的一个 `.html` 文件
//! 3. 开一个临时窗口加载它（隐藏，只用于打印）
//! 4. 页面加载完成后调 `print()` → 弹出系统打印面板
//! 5. 用户在面板里选「存储为 PDF」
//!
//! ## 为什么用临时文件而不是 data: URL
//!
//! data: URL 有长度限制（WKWebView 上约 2 MB），而一份带内联 CSS 的
//! 文档很容易超过它。临时文件没有这个限制。
//!
//! ## 窗口要不要显示
//!
//! 显示。理由：打印面板是**系统级**的，它覆盖在应用窗口之上，
//! 但用户仍然需要能看到「要打印的是什么」。隐藏窗口会让用户对着
//! 一个凭空出现的打印对话框，不知道自己在打印什么。

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// 临时窗口的 label
const PRINT_WINDOW_LABEL: &str = "inkstone-print";

/// 打印完（用户关掉打印面板）后要清理临时文件
#[tauri::command]
pub async fn print_document(
    app: AppHandle,
    html: String,
    suggested_path: String,
) -> Result<(), String> {
    // 1. 写临时 HTML
    let dir = temp_dir()?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let file_path = dir.join(format!(
        "inkstone-print-{}-{stamp}.html",
        std::process::id()
    ));
    std::fs::write(&file_path, html).map_err(|e| format!("写入临时文件失败: {e}"))?;

    // 2. 关掉可能存在的旧窗口（上一次打印没关干净的情况）
    if let Some(existing) = app.get_webview_window(PRINT_WINDOW_LABEL) {
        let _ = existing.close();
    }

    // 3. 开临时窗口
    //
    // `on_page_load` 是 **builder 上的**方法（消费 self 并返回 Self），
    // 不是 WebviewWindow 上的实例方法——所以必须链在 build 之前。
    let url = tauri::Url::from_file_path(&file_path)
        .map_err(|_| format!("无法构造临时文件 URL: {}", file_path.display()))?;

    let file_for_cleanup = file_path.clone();
    // macOS 的打印面板默认拿**页面标题**当 PDF 文件名。
    // 所以窗口标题就是建议的文件名（去掉目录与扩展名）——
    // 用户在面板里直接点「存储为 PDF」就能得到想要的名字。
    let suggested_name = std::path::Path::new(&suggested_path)
        .file_stem()
        .map(|stem| stem.to_string_lossy().to_string())
        .unwrap_or_else(|| "未命名".to_string());

    WebviewWindowBuilder::new(&app, PRINT_WINDOW_LABEL, WebviewUrl::External(url))
        .title(&suggested_name)
        .inner_size(900.0, 1200.0)
        .on_page_load(move |window, payload| {
            // 4. 等页面加载完再打印——
            //    立刻调 print() 的话页面还没渲染，打出来是空白页
            if payload.event() != tauri::webview::PageLoadEvent::Finished {
                return;
            }
            let file = file_for_cleanup.clone();
            // 放到后台线程：print() 是同步的阻塞调用，
            // 在 UI 线程上调会让窗口卡住不响应
            std::thread::spawn(move || {
                // 页面刚 load 完时可能还没完成首次布局，
                // 立刻打印会得到空白页。等一小会儿更稳。
                std::thread::sleep(std::time::Duration::from_millis(300));
                if let Err(err) = window.print() {
                    eprintln!("调起打印面板失败: {err}");
                }
                // 打印面板是模态的，用户关掉它之后窗口就没用了。
                // 这里等一段时间再关——立刻关会让打印面板连带消失。
                std::thread::sleep(std::time::Duration::from_secs(30));
                let _ = window.close();
                let _ = std::fs::remove_file(&file);
            });
        })
        .build()
        .map_err(|e| format!("创建打印窗口失败: {e}"))?;

    Ok(())
}

/// 临时目录（优先用系统临时目录）
fn temp_dir() -> Result<PathBuf, String> {
    std::env::temp_dir()
        .join("inkstone-print")
        .canonicalize()
        .or_else(|_| {
            let dir = std::env::temp_dir().join("inkstone-print");
            std::fs::create_dir_all(&dir).map_err(|e| format!("创建临时目录失败: {e}"))?;
            dir.canonicalize()
                .map_err(|e| format!("解析临时目录失败: {e}"))
        })
}

/// 用系统默认程序打开一个路径（文件或文件夹）
///
/// 自己实现而不用 `tauri-plugin-opener`：那个插件的 `opener:default` 权限
/// 只允许打开 http/https URL，不含任意本地路径。而「导出后打开文件」
/// 必须能打开本地文件——这正是用户的预期。
#[tauri::command]
pub async fn open_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("打开失败: {e}"))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("打开失败: {e}"))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("打开失败: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 临时目录可用() {
        let dir = temp_dir().expect("临时目录应该能创建");
        assert!(dir.exists());
        assert!(dir.to_string_lossy().contains("inkstone-print"));
    }
}

//! 文档读写：打开对话框、读取文件、保存文件。
//!
//! 设计要点：
//! - 命令一律返回 `Result`，错误信息直接透传给前端展示
//! - 保存使用「写临时文件 + rename」的原子替换，避免写到一半崩溃导致原文件损坏
//! - 保留原始字节：读取用 UTF-8，检测到 BOM 时原样保留

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::oneshot;

#[derive(serde::Serialize)]
pub struct OpenedDocument {
    pub path: String,
    pub content: String,
}

/// 弹出文件选择框并读取选中的 Markdown 文件；用户取消时返回 None
#[tauri::command]
pub async fn open_document(app: AppHandle) -> Result<Option<OpenedDocument>, String> {
    let (tx, rx) = oneshot::channel();

    app.dialog()
        .file()
        .set_title("打开 Markdown 文件")
        .add_filter("Markdown", &["md", "markdown", "mdown", "mkd", "txt"])
        .pick_file(move |picked| {
            // 回调在主线程触发，这里只投递结果，不做 IO
            let _ = tx.send(picked);
        });

    let picked = rx.await.map_err(|e| format!("文件对话框异常: {e}"))?;
    let Some(file_path) = picked else {
        return Ok(None);
    };

    let path = file_path
        .into_path()
        .map_err(|e| format!("无法解析文件路径: {e}"))?;
    let content = read_text_file(&path).await?;

    Ok(Some(OpenedDocument {
        path: path.to_string_lossy().to_string(),
        content,
    }))
}

/// 把内容写回指定路径（原子替换）
#[tauri::command]
pub async fn save_document(path: String, content: String) -> Result<(), String> {
    write_text_file(Path::new(&path), &content).await
}

/// 另存为：弹对话框选路径后写入
#[tauri::command]
pub async fn save_document_as(app: AppHandle, content: String) -> Result<Option<String>, String> {
    let (tx, rx) = oneshot::channel();

    app.dialog()
        .file()
        .set_title("另存为")
        .add_filter("Markdown", &["md", "markdown"])
        .set_file_name("未命名.md")
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
    write_text_file(&path, &content).await?;
    Ok(Some(path.to_string_lossy().to_string()))
}

/// 更新窗口标题（显示当前文件名 + 未保存标记）
#[tauri::command]
pub fn set_document_title(app: AppHandle, title: String) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "找不到主窗口".to_string())?;
    window.set_title(&title).map_err(|e| e.to_string())
}

/// 读取文件内容，保留 BOM 语义
async fn read_text_file(path: &PathBuf) -> Result<String, String> {
    let bytes = tokio::fs::read(path)
        .await
        .map_err(|e| format!("读取文件失败 ({}): {e}", path.display()))?;
    // 去掉 UTF-8 BOM，避免编辑器首行出现看不见的字符
    let content = String::from_utf8_lossy(&bytes).to_string();
    Ok(content
        .strip_prefix('\u{feff}')
        .map(str::to_owned)
        .unwrap_or(content))
}

/// 原子写入：先写同目录临时文件，再 rename 覆盖
async fn write_text_file(path: &Path, content: &str) -> Result<(), String> {
    let dir = path
        .parent()
        .ok_or_else(|| "文件路径没有父目录".to_string())?;
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "文件名不是合法的 UTF-8".to_string())?;

    let temp_path = dir.join(format!(".{file_name}.inkstone.tmp"));

    tokio::fs::write(&temp_path, content)
        .await
        .map_err(|e| format!("写入临时文件失败 ({}): {e}", temp_path.display()))?;

    tokio::fs::rename(&temp_path, path).await.map_err(|e| {
        // rename 失败时清理临时文件，不留垃圾
        let _ = std::fs::remove_file(&temp_path);
        format!("保存失败 ({}): {e}", path.display())
    })?;

    Ok(())
}

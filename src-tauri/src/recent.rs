//! 最近文件记录。
//!
//! 用途：
//! 1. 「文件 → 最近文件」菜单（M3 的 UI 会读这里）
//! 2. 会话恢复：下次启动可以列出最近编辑过的文档
//!
//! 存储格式：纯文本，一行一个路径，最新的在最前面，最多保留 N 条。
//! 之所以不用 JSON：这份数据只由本应用读写，纯文本便于人工检查与排障。

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

/// 最近文件的最大条数
const MAX_RECENT: usize = 20;

/// 获取应用数据目录（~/.config/inkstone 或 macOS 的 Application Support）
fn data_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok()
}

fn recent_file_path(app: &AppHandle) -> Option<PathBuf> {
    data_dir(app).map(|dir| dir.join("recent-files.txt"))
}

/// 记录一个最近打开的文件
pub fn record(app: &AppHandle, path: &Path) -> Result<(), String> {
    let Some(file) = recent_file_path(app) else {
        return Ok(());
    };

    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建配置目录失败 ({}): {e}", parent.display()))?;
    }

    let entry = path.to_string_lossy().to_string();

    // 读出已有记录，去掉与本次相同的项，再把新项放到最前
    let mut entries: Vec<String> = std::fs::read_to_string(&file)
        .unwrap_or_default()
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();

    entries.retain(|e| e != &entry);
    entries.insert(0, entry);
    entries.truncate(MAX_RECENT);

    let content = entries.join("\n");
    std::fs::write(&file, content)
        .map_err(|e| format!("写入最近文件记录失败 ({}): {e}", file.display()))?;

    Ok(())
}

/// 读取最近文件列表（新的在前）
#[tauri::command]
pub fn list_recent_files(app: AppHandle) -> Vec<String> {
    let Some(file) = recent_file_path(&app) else {
        return Vec::new();
    };
    std::fs::read_to_string(&file)
        .unwrap_or_default()
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect()
}

/// 清空最近文件列表
#[tauri::command]
pub fn clear_recent_files(app: AppHandle) -> Result<(), String> {
    let Some(file) = recent_file_path(&app) else {
        return Ok(());
    };
    if file.exists() {
        std::fs::remove_file(&file).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 确保数据目录存在（应用启动时调用一次）
pub fn ensure_data_dir(app: &AppHandle) {
    if let Some(dir) = data_dir(app) {
        let _ = std::fs::create_dir_all(dir);
    }
}

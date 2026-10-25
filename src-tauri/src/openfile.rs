//! macOS：从 Finder / 命令行打开文件时通知前端。
//!
//! ## 为什么单独一个模块
//!
//! `tauri::RunEvent::Opened` 这个变体只在 macOS / iOS / Android 上**存在**
//! （tauri-2.12.4 `src/app.rs:261` 的 cfg 门控）。
//! 别的平台上引用它，编译直接失败：
//!
//! ```text
//! error[E0599]: no variant named `Opened` found for enum `tauri::RunEvent`
//! ```
//!
//! 本地 macOS 永远发现不了这件事——只有 CI 在 Linux 上编译时才炸。
//! （M5-5 三平台 CI 第一次实跑就撞上了。）
//!
//! 所以：**整个实现按平台分两份**，而不是在调用点打补丁。
//! 放在独立模块里，是因为它要用的 `Emitter` / `Manager` 两个 trait import
//! 与那个事件常量，在这三个平台之外全是未用的——
//! clippy 的 `-D warnings` 会把它们当错误报出来。

use tauri::AppHandle;

/// 前端监听的事件名：从 Finder / 命令行打开文件时通知前端
///
/// 同样按平台门控：别的平台上没人用它，
/// `dead_code` 警告会被 clippy 的 `-D warnings` 当成错误。
#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
const OPEN_FILE_EVENT: &str = "document://open";

/// 处理「用本应用打开某个文件」事件
#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
pub fn handle(app: &AppHandle, event: &tauri::RunEvent) {
    use tauri::{Emitter, Manager};

    let tauri::RunEvent::Opened { urls } = event else {
        return;
    };

    // macOS：从 Finder 双击打开，或用 `open -a Inkstone file.md` 启动
    for url in urls {
        if url.scheme() != "file" {
            continue;
        }
        let Some(path) = url.to_file_path().ok() else {
            continue;
        };
        if let Err(err) = crate::recent::record(app, &path) {
            eprintln!("记录最近文件失败: {err}");
        }
        if let Err(err) = app.emit(OPEN_FILE_EVENT, path.to_string_lossy().to_string()) {
            eprintln!("转发打开文件事件失败: {err}");
        }
    }

    // 唤醒窗口，避免应用在后台启动时用户看不到任何反馈
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// 其它平台没有这个事件（Windows / Linux 的文件关联走命令行参数，不走这里）
#[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "android")))]
pub fn handle(_app: &AppHandle, _event: &tauri::RunEvent) {}

mod ai;
mod asset;
mod document;
mod fs;
mod menu;
mod pandoc;
mod print;
mod recent;
mod search;
mod watch;

use tauri::{Emitter, Manager, RunEvent};

/// 前端监听的事件名：从 Finder / 命令行打开文件时通知前端
const OPEN_FILE_EVENT: &str = "document://open";

/// 应用入口
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // 安装应用菜单（macOS 上作为系统应用菜单显示）
            menu::install(app.handle())?;
            recent::ensure_data_dir(app.handle());
            // 启动文件监听轮询线程（检测当前文档在外部被修改）
            watch::spawn(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            document::open_document,
            document::save_document,
            document::save_document_as,
            document::set_document_title,
            document::read_document,
            document::write_export_file,
            pandoc::detect_pandoc,
            pandoc::pick_pandoc_output,
            pandoc::convert_with_pandoc,
            print::print_document,
            print::open_path,
            watch::watch_document,
            watch::unwatch_document,
            asset::save_image,
            asset::read_image_data_url,
            recent::list_recent_files,
            recent::clear_recent_files,
            fs::list_directory,
            fs::parent_of,
            search::search_files,
            search::list_all_files,
            ai::secrets::ai_secret_status,
            ai::secrets::ai_set_secret,
            ai::secrets::ai_delete_secret,
            ai::http::ai_stream_chat,
            ai::http::ai_cancel_stream,
        ])
        .build(tauri::generate_context!())
        .expect("构建 Inkstone 失败");

    app.run(|app, event| {
        if let RunEvent::Opened { urls } = event {
            // macOS：从 Finder 双击打开，或用 `open -a Inkstone file.md` 启动
            for url in urls {
                if url.scheme() == "file" {
                    let path = url.to_file_path().ok();
                    if let Some(path) = path {
                        if let Err(err) = recent::record(app, &path) {
                            eprintln!("记录最近文件失败: {err}");
                        }
                        if let Err(err) =
                            app.emit(OPEN_FILE_EVENT, path.to_string_lossy().to_string())
                        {
                            eprintln!("转发打开文件事件失败: {err}");
                        }
                    }
                }
            }
            // 唤醒窗口，避免应用在后台启动时用户看不到任何反馈
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }
    });
}

mod ai;
mod asset;
mod document;
mod fs;
mod i18n;
mod menu;
mod openfile;
mod pandoc;
mod print;
mod recent;
mod search;
mod shortcuts;
mod update;
mod watch;

use tauri::AppHandle;

/// 设置界面语言，并重建原生菜单
///
/// 原生菜单画在 AppKit / GTK / Win32 上，前端那套 `t()` 管不到它，
/// 所以语言变了要由前端通知 Rust 一次（见 `src/i18n/index.ts`）。
#[tauri::command]
fn set_locale(app: AppHandle, locale: String) -> Result<(), String> {
    i18n::set_locale(&locale);
    menu::rebuild(&app).map_err(|err| err.to_string())
}

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
            set_locale,
            menu::set_sidebar_checked,
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
            ai::http::ai_list_models,
            ai::http::ai_probe_endpoint,
            update::latest_release,
        ])
        .build(tauri::generate_context!())
        .expect("构建 Inkstone 失败");

    app.run(|app, event| {
        // 「用本应用打开某个文件」只有 macOS / iOS / Android 会上报，
        // 平台差异全在 openfile 模块里（见那里的说明）。
        openfile::handle(app, &event);
    });
}

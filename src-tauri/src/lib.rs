mod document;
mod menu;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // 安装应用菜单（macOS 上作为系统应用菜单显示）
            menu::install(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            document::open_document,
            document::save_document,
            document::save_document_as,
            document::set_document_title,
        ])
        .run(tauri::generate_context!())
        .expect("启动 Inkstone 失败");
}

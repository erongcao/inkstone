//! macOS / 跨平台应用菜单。
//!
//! macOS 上第一项必须是应用菜单（关于/偏好设置/隐藏/退出），否则系统菜单行为异常。
//! 菜单项通过 emit 事件把动作交给前端处理，前端决定具体行为。
//!
//! API 说明：Tauri 2.12 的菜单以 Builder 风格提供
//! （`MenuBuilder` / `SubmenuBuilder` / `MenuItemBuilder`），
//! `Submenu::with_items` 在该版本需要额外的 `enabled` 参数，且 items 为 `&[&dyn IsMenuItem]`。
//!
//! ## 加速键不写在这里
//!
//! 菜单项的加速键全部来自 `shortcuts::accelerator(id)`——
//! 那份清单由 `scripts/gen-shortcuts.ts` 从前端的快捷键注册表生成。
//!
//! 之前加速键直接写在本文件里，于是同一批键位有两份真相源，
//! 而且永远不会互相提醒：⌘E 同时给了菜单和 CM6，NSApp 先吃按键，
//! CM6 那个功能**静默失灵**；「放大」写的 `CmdOrCtrl+Plus` 更是解析不了，
//! Tauri 的 `.parse().ok()` 把错误吞掉，菜单项直接没有快捷键。
//!
//! 现在：**本文件里一个加速键字符串都没有**，只有一个动作 id。

use tauri::menu::{
    AboutMetadata, CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder,
};
use tauri::{AppHandle, Emitter};

use crate::shortcuts;

/// 菜单动作 → 前端事件名
///
/// Tauri v2 的菜单事件不会自动派发到前端，需要在 Rust 侧注册 `on_menu_event`
/// 回调，再由我们主动 emit。约定：事件名就是菜单项的 id（如 "save-document"），
/// 前端直接 `listen("save-document", ...)` 即可。
///
/// 安装应用菜单，并把菜单点击事件转发给前端
pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let app_menu = build_app_menu(app)?;
    let file_menu = build_file_menu(app)?;
    let edit_menu = build_edit_menu(app)?;
    let view_menu = build_view_menu(app)?;
    let window_menu = build_window_menu(app)?;
    let help_menu = build_help_menu(app)?;

    let menu = MenuBuilder::new(app)
        .items(&[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ])
        .build()?;

    // macOS 上必须调用 set_as_app_menu 才会显示为系统应用菜单
    menu.set_as_app_menu()?;

    // 菜单点击 → 转发给前端
    app.on_menu_event(|app, event| {
        let id = event.id().0.clone();
        if let Err(err) = app.emit(&id, ()) {
            eprintln!("转发菜单事件失败 ({id}): {err}");
        }
    });

    Ok(())
}

/// 创建一个会向前端发事件的菜单项
///
/// 加速键从 `shortcuts::accelerator(id)` 取——**不在这里写死**。
/// 清单里没有的菜单项（比如「Markdown 语法参考」）就没有加速键。
fn action(
    app: &AppHandle,
    id: &str,
    text: &str,
) -> tauri::Result<tauri::menu::MenuItem<tauri::Wry>> {
    let mut builder = MenuItemBuilder::with_id(id, text);
    if let Some(accelerator) = shortcuts::accelerator(id) {
        builder = builder.accelerator(accelerator);
    } else if !shortcuts::is_known_action(id) {
        // 菜单项 id 没登记在快捷键清单里
        // → 前端的 initMenuBridge 不会监听它 → 点了没有任何反应，
        // 而且不会有任何报错能指到这里。启动时就说清楚。
        eprintln!("菜单项 \"{id}\" 不在 shortcuts.json 里，前端收不到它的动作");
    }
    builder.build(app)
}

fn build_app_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Submenu<tauri::Wry>> {
    let settings = action(app, "preferences", "偏好设置…")?;

    SubmenuBuilder::new(app, "Inkstone")
        .about_with_text(
            "关于 Inkstone",
            Some(AboutMetadata {
                name: Some("Inkstone".into()),
                version: Some(env!("CARGO_PKG_VERSION").into()),
                comments: Some("开源 Markdown 编辑器 —— 类 Typora 的 Live Preview 体验".into()),
                ..Default::default()
            }),
        )
        .separator()
        .item(&settings)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .separator()
        .quit()
        .build()
}

fn build_file_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Submenu<tauri::Wry>> {
    let new_doc = action(app, "new-document", "新建文档")?;
    let open = action(app, "open-document", "打开…")?;
    let save = action(app, "save-document", "保存")?;
    let save_as = action(app, "save-document-as", "另存为…")?;
    let export_doc = action(app, "export-document", "导出…")?;

    SubmenuBuilder::new(app, "文件")
        .item(&new_doc)
        .item(&open)
        .separator()
        .item(&save)
        .item(&save_as)
        .separator()
        .item(&export_doc)
        .separator()
        .close_window()
        .build()
}

fn build_edit_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Submenu<tauri::Wry>> {
    let find = action(app, "find", "查找…")?;
    let replace = action(app, "replace", "替换…")?;
    let copy_as_md = action(app, "copy-as-markdown", "复制为 Markdown 源码")?;
    let copy_as_html = action(app, "copy-as-html", "复制为 HTML")?;
    let paste_as_plain_text = action(app, "paste-as-plain-text", "粘贴为纯文本")?;

    SubmenuBuilder::new(app, "编辑")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        .item(&find)
        .item(&replace)
        .separator()
        .item(&copy_as_md)
        .item(&copy_as_html)
        .item(&paste_as_plain_text)
        .build()
}

fn build_view_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Submenu<tauri::Wry>> {
    let sidebar = action(app, "toggle-sidebar", "显示/隐藏侧边栏")?;
    let source_mode = action(app, "toggle-source-mode", "源码模式")?;
    let focus_mode = action(app, "toggle-focus-mode", "专注模式")?;
    let typewriter = action(app, "toggle-typewriter-mode", "打字机模式")?;
    let zoom_in = action(app, "zoom-in", "放大")?;
    let zoom_out = action(app, "zoom-out", "缩小")?;
    let zoom_reset = action(app, "zoom-reset", "实际大小")?;

    // 复选框菜单项：状态与前端设置双向同步（M2 起接通）
    let sidebar_check = CheckMenuItemBuilder::with_id("check-sidebar", "显示侧边栏")
        .checked(true)
        .build(app)?;

    SubmenuBuilder::new(app, "视图")
        .item(&sidebar)
        .item(&sidebar_check)
        .separator()
        .item(&source_mode)
        .item(&focus_mode)
        .item(&typewriter)
        .separator()
        .item(&zoom_in)
        .item(&zoom_out)
        .item(&zoom_reset)
        .separator()
        .fullscreen()
        .build()
}

fn build_window_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Submenu<tauri::Wry>> {
    SubmenuBuilder::new(app, "窗口")
        .minimize()
        .maximize()
        .separator()
        .fullscreen()
        .separator()
        .close_window()
        .build()
}

fn build_help_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Submenu<tauri::Wry>> {
    let markdown_ref = action(app, "markdown-reference", "Markdown 语法参考")?;
    let shortcuts = action(app, "shortcuts", "快捷键一览")?;
    let homepage = action(app, "open-homepage", "项目主页")?;

    SubmenuBuilder::new(app, "帮助")
        .item(&markdown_ref)
        .item(&shortcuts)
        .separator()
        .item(&homepage)
        .build()
}

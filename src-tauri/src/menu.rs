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
//!
//! ## 文案也不写在这里
//!
//! 菜单文字由 `i18n::label(id)` 取——原生菜单画在 AppKit / GTK / Win32 上，
//! 前端那套 `t()` 管不到它。语言变了要重建菜单（见 `rebuild`）。

use tauri::menu::{
    AboutMetadata, CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder,
};
use tauri::{AppHandle, Emitter};

use crate::i18n;
use crate::shortcuts;

/// 菜单动作 → 前端事件名
///
/// Tauri v2 的菜单事件不会自动派发到前端，需要在 Rust 侧注册 `on_menu_event`
/// 回调，再由我们主动 emit。约定：事件名就是菜单项的 id（如 "save-document"），
/// 前端直接 `listen("save-document", ...)` 即可。
///
/// 安装应用菜单，并把菜单点击事件转发给前端
pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let menu = build(app)?;
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

/// 按当前语言重建菜单
///
/// 语言变了要重建：菜单项的文案是在**建菜单那一刻**定下的。
pub fn rebuild(app: &AppHandle) -> tauri::Result<()> {
    let menu = build(app)?;
    app.set_menu(menu)?;
    Ok(())
}

/// 「显示侧边栏」复选项的 id
///
/// 单独提成常量：建菜单的地方与同步状态的地方都要用它，
/// 写两遍字面量就有「改了这边忘了那边」的机会。
pub const SIDEBAR_CHECK_ID: &str = "check-sidebar";

/// 「视图」子菜单的 id
///
/// **为什么必须给它一个稳定的 id**：
/// `Menu::get` 只在**顶层**找菜单项，不递归进子菜单——
/// 而「显示侧边栏」复选项在「视图」子菜单里面。
/// 子菜单的 id 默认是 muda 随机生成的，每次重建菜单都不一样，
/// 于是按 id 找根本找不到。
pub const VIEW_MENU_ID: &str = "view-menu";

/// 把「显示侧边栏」复选项的勾选状态同步成前端的状态
///
/// ## 为什么需要这个函数
///
/// 侧边栏的可见性可以从**三个**地方变：
/// 原生菜单的「显示/隐藏侧边栏」、复选项本身、以及面板上的折叠按钮。
/// 而复选项只有「勾 / 不勾」两个状态可显示——
/// 一个不反映实际状态的勾选框，比没有这个勾选框更糟：
/// 用户会以为侧边栏已经收起来了。
///
/// ## 两条方向
///
/// - **Rust → 前端**：用户点了复选项，菜单系统发一个菜单事件过来；
///   前端收到后切换自己的状态。
/// - **前端 → Rust**：前端的侧边栏状态变了（快捷键、面板折叠），
///   通过 `set_sidebar_checked` 命令把真实状态推回来。
///
/// 第二个方向是**权威的**：复选项最终显示什么，一律以前端的状态为准。
/// 各平台对「点了复选项要不要自己翻转勾选」的处理并不一致
/// （GTK 会自动翻转，AppKit 不会），
/// 与其依赖平台行为，不如让前端把真实状态推回去——两条方向合起来，
/// 复选项才是**状态的显示**，而不是一个摆设。
pub fn sync_sidebar_checked(app: &AppHandle, checked: bool) -> tauri::Result<()> {
    let Some(menu) = app.menu() else {
        // 菜单还没装上（前端比菜单先启动）——不是错误
        return Ok(());
    };
    // 复选项在「视图」子菜单里，而 get() 不递归，所以要分两步找
    let Some(tauri::menu::MenuItemKind::Submenu(view)) = menu.get(VIEW_MENU_ID) else {
        return Ok(());
    };
    let Some(tauri::menu::MenuItemKind::Check(check)) = view.get(SIDEBAR_CHECK_ID) else {
        return Ok(());
    };
    check.set_checked(checked)?;
    Ok(())
}

/// 前端 → 原生：同步「显示侧边栏」复选项的勾选状态
#[tauri::command]
pub fn set_sidebar_checked(app: AppHandle, checked: bool) -> tauri::Result<()> {
    sync_sidebar_checked(&app, checked)
}

/// 建出整棵菜单
fn build(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
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
    Ok(menu)
}

/// 创建一个会向前端发事件的菜单项
///
/// 文案从 `i18n::label(id)` 取，加速键从 `shortcuts::accelerator(id)` 取——
/// **都不在这里写死**。
fn action(app: &AppHandle, id: &str) -> tauri::Result<tauri::menu::MenuItem<tauri::Wry>> {
    let mut builder = MenuItemBuilder::with_id(id, i18n::label(id));
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
    let settings = action(app, "preferences")?;

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
    let new_doc = action(app, "new-document")?;
    let open = action(app, "open-document")?;
    let save = action(app, "save-document")?;
    let save_as = action(app, "save-document-as")?;
    let export_doc = action(app, "export-document")?;

    SubmenuBuilder::new(app, i18n::menu_title("file"))
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
    let find = action(app, "find")?;
    let replace = action(app, "replace")?;
    let copy_as_md = action(app, "copy-as-markdown")?;
    let copy_as_html = action(app, "copy-as-html")?;
    let paste_as_plain_text = action(app, "paste-as-plain-text")?;

    SubmenuBuilder::new(app, i18n::menu_title("edit"))
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
    let sidebar = action(app, "toggle-sidebar")?;
    let source_mode = action(app, "toggle-source-mode")?;
    let focus_mode = action(app, "toggle-focus-mode")?;
    let typewriter = action(app, "toggle-typewriter-mode")?;
    let zoom_in = action(app, "zoom-in")?;
    let zoom_out = action(app, "zoom-out")?;
    let zoom_reset = action(app, "zoom-reset")?;

    // 复选框菜单项：勾选状态与前端的侧边栏可见性双向同步
    // （Rust → 前端走菜单事件，前端 → Rust 走 set_sidebar_checked 命令）
    let sidebar_check =
        CheckMenuItemBuilder::with_id(SIDEBAR_CHECK_ID, i18n::label("check-sidebar"))
            .checked(true)
            .build(app)?;

    // 用 with_id 而不是 new：菜单重建后要还能按 id 找到这个子菜单
    // （`Menu::get` 不递归，复选项在子菜单里）
    SubmenuBuilder::with_id(app, VIEW_MENU_ID, i18n::menu_title("view"))
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
    SubmenuBuilder::new(app, i18n::menu_title("window"))
        .minimize()
        .maximize()
        .separator()
        .fullscreen()
        .separator()
        .close_window()
        .build()
}

fn build_help_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Submenu<tauri::Wry>> {
    let markdown_ref = action(app, "markdown-reference")?;
    let shortcuts = action(app, "shortcuts")?;
    let homepage = action(app, "open-homepage")?;
    let check_update = action(app, "check-update")?;

    SubmenuBuilder::new(app, i18n::menu_title("help"))
        .item(&markdown_ref)
        .item(&shortcuts)
        .separator()
        .item(&check_update)
        .item(&homepage)
        .build()
}

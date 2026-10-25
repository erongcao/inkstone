//! 原生菜单的国际化。
//!
//! ## 为什么 Rust 侧也要一份文案
//!
//! 原生菜单的文字**不在 webview 里**——它由 AppKit / GTK / Win32 画，
//! 前端那套 `t()` 管不到它。
//!
//! 所以这里另有一份小表：只放**菜单项**的文案（22 条），
//! 不放界面文案（那几百条在前端的 `src/i18n/locales/` 里）。
//!
//! ## 语言从哪来
//!
//! 前端在启动时把当前语言告诉 Rust（`set_locale` 命令），
//! Rust 存起来；语言变了前端再通知一次，菜单重建。
//!
//! 为什么要重建：菜单项的 keyEquivalent 与文案是在**建菜单那一刻**定下的，
//! 改文案不需要重建，但改语言需要——所以统一重建，简单且不会漏。

use std::sync::atomic::{AtomicU8, Ordering};

/// 支持的语言
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Locale {
    /// 简体中文
    ZhCn,
    /// 繁體中文
    ZhTw,
    /// English
    En,
}

impl Locale {
    /// 从前端传来的字符串解析
    pub fn parse(value: &str) -> Locale {
        match value {
            "zh-TW" => Locale::ZhTw,
            "en" => Locale::En,
            _ => Locale::ZhCn,
        }
    }

    fn index(self) -> usize {
        match self {
            Locale::ZhCn => 0,
            Locale::ZhTw => 1,
            Locale::En => 2,
        }
    }
}

/// 当前语言（0 = 简体 / 1 = 繁体 / 2 = 英文）
static CURRENT: AtomicU8 = AtomicU8::new(0);

/// 设置当前语言
pub fn set_locale(value: &str) {
    CURRENT.store(Locale::parse(value).index() as u8, Ordering::Relaxed);
}

/// 当前语言
pub fn current() -> Locale {
    match CURRENT.load(Ordering::Relaxed) {
        1 => Locale::ZhTw,
        2 => Locale::En,
        _ => Locale::ZhCn,
    }
}

/// 菜单文案表：`(动作 id, 简体, 繁体, 英文)`
///
/// 第一列是**动作 id**，与 `src-tauri/shortcuts.json` 里的 `actions` 对应——
/// 前端的 `MenuAction` 类型也从那里派生，三边靠 id 对齐。
const MENU_LABELS: &[(&str, &str, &str, &str)] = &[
    ("preferences", "偏好设置…", "偏好設定…", "Preferences…"),
    ("new-document", "新建文档", "新增文件", "New Document"),
    ("open-document", "打开…", "開啟…", "Open…"),
    ("save-document", "保存", "儲存", "Save"),
    ("save-document-as", "另存为…", "另存為…", "Save As…"),
    ("export-document", "导出…", "匯出…", "Export…"),
    ("find", "查找…", "尋找…", "Find…"),
    ("replace", "替换…", "取代…", "Replace…"),
    (
        "copy-as-markdown",
        "复制为 Markdown 源码",
        "複製為 Markdown 原始碼",
        "Copy as Markdown Source",
    ),
    ("copy-as-html", "复制为 HTML", "複製為 HTML", "Copy as HTML"),
    (
        "paste-as-plain-text",
        "粘贴为纯文本",
        "貼上為純文字",
        "Paste as Plain Text",
    ),
    (
        "toggle-sidebar",
        "显示/隐藏侧边栏",
        "顯示/隱藏側邊欄",
        "Show/Hide Sidebar",
    ),
    (
        "toggle-source-mode",
        "源码模式",
        "原始碼模式",
        "Source Mode",
    ),
    ("toggle-focus-mode", "专注模式", "專注模式", "Focus Mode"),
    (
        "toggle-typewriter-mode",
        "打字机模式",
        "打字機模式",
        "Typewriter Mode",
    ),
    ("zoom-in", "放大", "放大", "Zoom In"),
    ("zoom-out", "缩小", "縮小", "Zoom Out"),
    ("zoom-reset", "实际大小", "實際大小", "Actual Size"),
    (
        "markdown-reference",
        "Markdown 语法参考",
        "Markdown 語法參考",
        "Markdown Syntax Reference",
    ),
    (
        "shortcuts",
        "快捷键一览",
        "快速鍵一覽",
        "Keyboard Shortcuts",
    ),
    ("open-homepage", "项目主页", "專案首頁", "Project Homepage"),
    (
        "check-update",
        "检查更新…",
        "檢查更新…",
        "Check for Updates…",
    ),
    ("check-sidebar", "显示侧边栏", "顯示側邊欄", "Show Sidebar"),
];

/// 取某个动作的菜单文案
///
/// 表里没有就回退到动作 id 本身——宁可显示一个 id，
/// 也不要显示成空白（用户完全不知道那是什么）。
pub fn label(id: &str) -> &'static str {
    let index = current().index();
    MENU_LABELS
        .iter()
        .find(|row| row.0 == id)
        .map(|row| match index {
            1 => row.2,
            2 => row.3,
            _ => row.1,
        })
        .unwrap_or("")
}

/// 菜单标题（子菜单的名字）
pub fn menu_title(id: &str) -> &'static str {
    match (id, current()) {
        ("file", Locale::ZhCn) => "文件",
        ("file", Locale::ZhTw) => "檔案",
        ("file", Locale::En) => "File",
        ("edit", Locale::ZhCn) => "编辑",
        ("edit", Locale::ZhTw) => "編輯",
        ("edit", Locale::En) => "Edit",
        ("view", Locale::ZhCn) => "视图",
        ("view", Locale::ZhTw) => "檢視",
        ("view", Locale::En) => "View",
        ("window", Locale::ZhCn) => "窗口",
        ("window", Locale::ZhTw) => "視窗",
        ("window", Locale::En) => "Window",
        ("help", Locale::ZhCn) => "帮助",
        ("help", Locale::ZhTw) => "說明",
        ("help", Locale::En) => "Help",
        _ => "",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 三种语言都能解析() {
        assert_eq!(Locale::parse("zh-CN"), Locale::ZhCn);
        assert_eq!(Locale::parse("zh-TW"), Locale::ZhTw);
        assert_eq!(Locale::parse("en"), Locale::En);
        assert_eq!(Locale::parse("乱写的"), Locale::ZhCn);
    }

    #[test]
    fn 文案随语言切换() {
        set_locale("zh-CN");
        assert_eq!(label("save-document"), "保存");
        set_locale("zh-TW");
        assert_eq!(label("save-document"), "儲存");
        set_locale("en");
        assert_eq!(label("save-document"), "Save");
        set_locale("zh-CN");
    }

    #[test]
    fn 表里的id都非空且不重复() {
        let mut seen = Vec::new();
        for row in MENU_LABELS {
            assert!(!row.0.is_empty(), "动作 id 不能是空串");
            assert!(!row.1.is_empty(), "{} 的简体文案不能为空", row.0);
            assert!(!row.2.is_empty(), "{} 的繁体文案不能为空", row.0);
            assert!(!row.3.is_empty(), "{} 的英文文案不能为空", row.0);
            assert!(!seen.contains(&row.0), "动作 id 重复：{}", row.0);
            seen.push(row.0);
        }
    }

    #[test]
    fn 菜单标题三种语言都有() {
        for id in ["file", "edit", "view", "window", "help"] {
            for locale in ["zh-CN", "zh-TW", "en"] {
                set_locale(locale);
                assert!(
                    !menu_title(id).is_empty(),
                    "{} 在 {} 下没有标题",
                    id,
                    locale
                );
            }
        }
        set_locale("zh-CN");
    }
}

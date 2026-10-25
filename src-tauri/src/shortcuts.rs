//! 原生菜单的加速键清单。
//!
//! ## 来源
//!
//! `shortcuts.json` 由 `scripts/gen-shortcuts.ts` 从前端的快捷键注册表
//! （`src/shortcuts.ts`）生成，**Rust 侧一个加速键字符串都不写死**。
//!
//! 之前加速键直接写在 `menu.rs` 里，于是同一批键位有两份真相源，
//! 而且永远不会互相提醒：
//!
//! - M4-6：⌘E 同时给了原生菜单和 CM6，NSApp 先吃按键，CM6 那个功能静默失灵
//! - 「放大」写的是 `CmdOrCtrl+Plus`，而 muda 的物理键表里没有 Plus——
//!   Tauri 建菜单时用 `.parse().ok()`，解析失败被静默吞掉，菜单项直接没快捷键
//!
//! ## 为什么在 Rust 侧还要再验一遍
//!
//! `shortcuts.json` 里的字符串最终要交给 muda 解析。
//! muda 解析不了时**不报错，只是没有加速键**——那种 bug 极难发现，
//! 所以这里用 muda 自己的解析器逐条验（见下面的测试）。

use serde::Deserialize;
use std::collections::HashMap;
use std::sync::OnceLock;

/// 清单文件（编译期内嵌，运行时零 IO）
const SHORTCUTS_JSON: &str = include_str!("../shortcuts.json");

/// 清单文件的结构
#[derive(Debug, Deserialize)]
struct ShortcutsFile {
    /// 原生菜单的全部动作 id
    actions: Vec<String>,
    /// 动作 id → Tauri 加速键
    accelerators: HashMap<String, String>,
}

/// 解析后的清单（懒加载 + 只解析一次）
fn file() -> &'static ShortcutsFile {
    static PARSED: OnceLock<ShortcutsFile> = OnceLock::new();
    PARSED.get_or_init(|| {
        serde_json::from_str(SHORTCUTS_JSON)
            .expect("src-tauri/shortcuts.json 格式不对——请运行 pnpm gen:shortcuts 重新生成")
    })
}

/// 取某个动作的加速键；没有加速键返回 `None`
pub fn accelerator(action_id: &str) -> Option<&'static str> {
    file()
        .accelerators
        .get(action_id)
        .map(|value| value.as_str())
}

/// 清单里的全部动作 id
pub fn actions() -> &'static [String] {
    &file().actions
}

/// 这个动作 id 有没有登记
///
/// 菜单里建出来的每个 id 都应该在清单里：
/// 没登记 = 前端 `initMenuBridge` 不会监听它 = 点了没反应。
pub fn is_known_action(action_id: &str) -> bool {
    actions().iter().any(|id| id == action_id)
}

/// 清单里的全部加速键
#[cfg(test)]
pub fn accelerators() -> &'static HashMap<String, String> {
    &file().accelerators
}

#[cfg(test)]
mod tests {
    use super::*;
    use muda::accelerator::Accelerator;
    use std::collections::HashSet;
    use std::str::FromStr;

    /// 菜单里建出来的**每一个**菜单项 id。
    ///
    /// 这份清单与 `menu.rs` 里实际建出来的菜单项一一对应。
    /// 少写一个 id = 那个菜单项的前端通道没人知道；
    /// 多写一个 id = 清单里有个不存在的动作。
    const MENU_ITEM_IDS: &[&str] = &[
        "preferences",
        "new-document",
        "open-document",
        "save-document",
        "save-document-as",
        "export-document",
        "find",
        "replace",
        "copy-as-markdown",
        "copy-as-html",
        "paste-as-plain-text",
        "toggle-sidebar",
        "toggle-source-mode",
        "toggle-focus-mode",
        "toggle-typewriter-mode",
        "zoom-in",
        "zoom-out",
        "zoom-reset",
        "markdown-reference",
        "shortcuts",
        "open-homepage",
        "check-sidebar",
    ];

    #[test]
    fn 清单能被解析() {
        let parsed = file();
        assert!(!parsed.actions.is_empty(), "动作清单不该是空的");
        assert!(!parsed.accelerators.is_empty(), "加速键清单不该是空的");
    }

    #[test]
    fn 每个菜单项的id都在清单里() {
        let known: HashSet<&str> = actions().iter().map(|s| s.as_str()).collect();
        for id in MENU_ITEM_IDS {
            assert!(
                known.contains(id),
                "菜单项 id \"{id}\" 不在 shortcuts.json 的 actions 里——前端永远收不到它"
            );
        }
    }

    #[test]
    fn 清单里的动作都有菜单项() {
        // 反向：清单里不该有菜单根本没建的动作
        let built: HashSet<&str> = MENU_ITEM_IDS.iter().copied().collect();
        for action in actions() {
            assert!(
                built.contains(action.as_str()),
                "清单里的动作 \"{action}\" 在菜单里没有对应的菜单项"
            );
        }
    }

    #[test]
    fn 每个加速键都能被muda解析() {
        // 这一条是整个模块存在的理由：
        // muda 解析不了时**不报错，只是菜单项没有快捷键**。
        // 「放大」写 `CmdOrCtrl+Plus` 就是这么静默失效的。
        for (action, accelerator) in accelerators() {
            assert!(
                Accelerator::from_str(accelerator).is_ok(),
                "动作 \"{action}\" 的加速键 \"{accelerator}\" 解析失败——菜单项会没有快捷键且不报错"
            );
        }
    }

    #[test]
    fn 加速键互不重复() {
        let mut seen: HashMap<&str, &str> = HashMap::new();
        for (action, accelerator) in accelerators() {
            if let Some(prev) = seen.insert(accelerator.as_str(), action.as_str()) {
                panic!("加速键 \"{accelerator}\" 被 \"{prev}\" 和 \"{action}\" 同时占用");
            }
        }
    }

    #[test]
    fn 有加速键的动作都在动作清单里() {
        let known: HashSet<&str> = actions().iter().map(|s| s.as_str()).collect();
        for action in accelerators().keys() {
            assert!(
                known.contains(action.as_str()),
                "动作 \"{action}\" 有加速键但不在 actions 清单里"
            );
        }
    }

    #[test]
    fn muda的物理键表里没有加号键() {
        // 「放大」为什么用 `Equal` 而不是 `Plus`——这条测试把原因钉住：
        //
        // muda 的物理键表（Code）里**没有 Plus**（只有 NumpadAdd），
        // 所以 `CmdOrCtrl+Plus` 解析必然失败；
        // 而 Tauri 建菜单时用的是 `.parse().ok()`——
        // **解析失败被静默吞掉，菜单项直接没有快捷键，连报错都没有**。
        //
        // 旧代码里「放大」正是这么写的：菜单显示得好好的，
        // 按 ⌘+ 什么都不会发生，而且没有任何报错能指到这里。
        assert!(
            Accelerator::from_str("CmdOrCtrl+Plus").is_err(),
            "如果 muda 以后支持 Plus 了，这条测试会提醒我们把「放大」换回更准确的写法"
        );
        assert!(
            Accelerator::from_str("CmdOrCtrl+Equal").is_ok(),
            "Equal 必须能解析——「放大」的加速键依赖它"
        );
    }
}

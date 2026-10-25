/**
 * 快捷键注册表：完整性、平台感知显示、Tauri 加速键转换。
 *
 * 这一层是**唯一真相源**，所以它的测试要守住两件事：
 *
 * 1. **注册表本身不能自相矛盾**——两个功能共用一个键、动作 id 漏登记、
 *    actionId 重复。这类问题一旦发生，撞车的那个功能会**静默失灵**
 *    （M4-6 的 ⌘E 就是这么坏的：不报错，按下去没反应）。
 *
 * 2. **跨平台显示要正确**——Windows 上不能给用户显示 ⌘，
 *    那个键在 Windows 上根本不存在。
 *
 * 另外，「每个加速键都能被 muda 解析」这条只能在 Rust 侧验
 * （见 `src-tauri/src/shortcuts.rs`），因为只有那边有解析器。
 */

import { describe, expect, it } from "vitest";
import {
  KEYS,
  MENU_ACTION_IDS,
  MENU_CHROME,
  SHORTCUTS,
  findShortcut,
  formatShortcut,
  shortcutRegistryConflicts,
  takenShortcutKeys,
  toAccelerator,
} from "@/shortcuts";
import { RESERVED_SHORTCUTS } from "@/export/items";

describe("注册表完整性", () => {
  it("没有两个不同功能共用同一个键", () => {
    expect(shortcutRegistryConflicts()).toEqual([]);
  });

  it("actionId 不重复", () => {
    const ids = SHORTCUTS.map((item) => item.actionId).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("带 actionId 的条目都在动作清单里", () => {
    for (const item of SHORTCUTS) {
      if (!item.actionId) continue;
      expect(MENU_ACTION_IDS).toContain(item.actionId);
    }
    for (const item of MENU_CHROME) {
      expect(MENU_ACTION_IDS).toContain(item.actionId);
    }
  });

  it("注册表里的键都唯一（不含菜单系统件）", () => {
    const keys = SHORTCUTS.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("每个条目都有标签和分组", () => {
    for (const item of [...SHORTCUTS, ...MENU_CHROME]) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.group.length).toBeGreaterThan(0);
    }
  });
});

describe("查找与占用键", () => {
  it("按规范形式能查到", () => {
    expect(findShortcut(KEYS.bold)?.label).toBe("加粗");
    expect(findShortcut("Mod-不存在的键")).toBeUndefined();
  });

  it("占用键包含注册表与菜单系统件", () => {
    const taken = takenShortcutKeys();
    expect(taken).toContain(KEYS.save);
    expect(taken).toContain("Mod-Equal");
    expect(new Set(taken).size).toBe(taken.length);
  });

  it("导出项的保留键表从注册表派生，不是手抄的", () => {
    expect(RESERVED_SHORTCUTS.length).toBe(SHORTCUTS.length + MENU_CHROME.length);
    expect(RESERVED_SHORTCUTS.map((item) => item.key)).toEqual(takenShortcutKeys());
  });
});

describe("平台感知显示", () => {
  it("macOS 用符号，顺序按苹果惯例 ⌃⌥⇧⌘", () => {
    expect(formatShortcut("Mod-Shift-1", "mac")).toBe("⇧⌘1");
    expect(formatShortcut("Mod-a", "mac")).toBe("⌘A");
    expect(formatShortcut("Mod-Alt-c", "mac")).toBe("⌥⌘C");
    expect(formatShortcut("Alt-Ctrl-k", "mac")).toBe("⌃⌥K");
  });

  it("Windows / Linux 用单词", () => {
    expect(formatShortcut("Mod-Shift-1", "windows")).toBe("Ctrl+Shift+1");
    expect(formatShortcut("Mod-Alt-c", "windows")).toBe("Ctrl+Alt+C");
    expect(formatShortcut("Alt-Ctrl-k", "linux")).toBe("Alt+Ctrl+K");
  });

  it("非 mac 上 Mod 与 Ctrl 不显示成两个 Ctrl", () => {
    // Mod 在非 mac 上本身就是 Ctrl，两个都写会变成「Ctrl+Ctrl+K」
    expect(formatShortcut("Mod-Ctrl-k", "windows")).toBe("Ctrl+K");
    expect(formatShortcut("Mod-Ctrl-k", "mac")).toBe("⌃⌘K");
  });

  it("减号显示成 - 而不是 Minus", () => {
    expect(formatShortcut("Mod-Minus", "mac")).toBe("⌘-");
    expect(formatShortcut("Mod-Minus", "windows")).toBe("Ctrl+-");
  });

  it("放大显示成 = 而不是物理键名 Equal", () => {
    // `Equal` 是键的**物理名**，用户按的是键盘上印着 `=` 的那个键。
    // 显示成「⌘Equal」等于告诉用户去按一个不存在的键——
    // 这种速查表比没有更糟（M5-5 做「快捷键一览」时被逮住）。
    //
    // 但**加速键**必须还是 Equal：muda 的物理键表里没有 Plus，
    // `CmdOrCtrl+Plus` 解析失败，而 Tauri 用 `.parse().ok()` 静默吞掉失败。
    expect(formatShortcut("Mod-Equal", "mac")).toBe("⌘=");
    expect(formatShortcut("Mod-Equal", "windows")).toBe("Ctrl+=");
    expect(toAccelerator("Mod-Equal")).toBe("CmdOrCtrl+Equal");
  });

  it("空串是空串", () => {
    expect(formatShortcut("", "mac")).toBe("");
    expect(formatShortcut("", "windows")).toBe("");
  });
});

describe("Tauri 加速键转换", () => {
  it("Mod 转成 CmdOrCtrl", () => {
    expect(toAccelerator(KEYS.newDocument)).toBe("CmdOrCtrl+N");
    expect(toAccelerator(KEYS.exportDocument)).toBe("CmdOrCtrl+Shift+E");
    expect(toAccelerator(KEYS.preferences)).toBe("CmdOrCtrl+,");
    expect(toAccelerator(KEYS.toggleSourceMode)).toBe("CmdOrCtrl+/");
  });

  it("替换是 Ctrl+H 而不是 CmdOrCtrl+H", () => {
    // CmdOrCtrl+H 在 mac 上是 ⌘H，与系统菜单里的「隐藏」撞车——
    // AppKit 取菜单树里靠前的那项，于是「隐藏」赢，替换从来没生效过。
    expect(toAccelerator(KEYS.replace)).toBe("Ctrl+H");
    expect(toAccelerator(KEYS.replace)).not.toBe("CmdOrCtrl+H");
  });

  it("放大用 Equal 而不是 Plus", () => {
    // muda 的物理键表里没有 Plus，`CmdOrCtrl+Plus` 解析失败，
    // 而 Tauri 用 `.parse().ok()` 把失败静默吞掉 → 菜单项没有快捷键。
    expect(toAccelerator("Mod-Equal")).toBe("CmdOrCtrl+Equal");
    expect(toAccelerator("Mod-Minus")).toBe("CmdOrCtrl+Minus");
    expect(toAccelerator("Mod-0")).toBe("CmdOrCtrl+0");
  });

  it("空串是空串", () => {
    expect(toAccelerator("")).toBe("");
  });
});

/**
 * 快捷键的**单一注册表**。
 *
 * ## 为什么要有这一层
 *
 * 快捷键原本散在五个地方：
 *
 * | 位置 | 形式 | 谁在用 |
 * |---|---|---|
 * | `src/editor/MarkdownEditor.ts` 的 keymap | `Mod-Shift-e` | 编辑器内（CM6） |
 * | `src-tauri/src/menu.rs` | `CmdOrCtrl+Shift+E` | 原生菜单（全局） |
 * | `src/export/items.ts` 的 `RESERVED_SHORTCUTS` | `Mod-Shift-e` | 冲突检查 |
 * | `src/editor/commands/builtin.ts` 的 `shortcut` | `⌘⇧E` | 命令面板显示 |
 * | `src/ipc/menu.ts` 的 `MenuAction` | action id | 菜单事件桥接 |
 *
 * 五处手抄同一批键位，于是 M4-6 出了那个 bug：
 * **⌘E 被原生菜单和 CM6 同时占用，NSApp 先吃掉按键，CM6 那个功能彻底失效**——
 * 不是两个功能一起触发，是后绑的那个**静默失灵**。
 *
 * 现在：注册表是唯一真相源。
 *   - CM6 keymap 用 `KEYS` 常量（与注册表同源）
 *   - 冲突检查从注册表派生（不再手抄）
 *   - 命令面板的显示从注册表派生（不再手抄 mac 符号）
 *   - 原生菜单的加速键由 `scripts/gen-shortcuts.ts` 从注册表生成到
 *     `src-tauri/shortcuts.json`，Rust 侧读那个文件；CI 检查它没过期
 *
 * ## 三类作用域，别混
 *
 * | scope | 谁处理按键 | 冲突后果 |
 * |---|---|---|
 * | `editor` | CM6（编辑器有焦点时） | 同一键绑两个功能 → 前面的赢 |
 * | `app` | 原生菜单（全局） | 同上，但 **NSApp 先吃**，webview 收不到 |
 * | `both` | 两边都绑（同一个功能） | 不是冲突——是同一个功能的两个入口 |
 *
 * `app` 的键会**吃掉** `editor` 的同名键——所以冲突检查要把三类放在一起看，
 * 不能各查各的。
 *
 * ## 规范形式的约定
 *
 * 修饰符：`Mod`（mac 上是 ⌘、其它平台是 Ctrl）、`Shift`、`Alt`、`Ctrl`。
 * 用 `Mod` 而不是 `Meta`：同一份注册表在三个平台上都成立。
 *
 * 键名用**物理键**（muda 的 `Code` 表能解析的那些），
 * 这样 `toAccelerator()` 产出的字符串一定能被 Tauri 解析——
 * 这一点很重要，见 `KEY_ALIASES` 的注释。
 */

/** 运行平台 */
export type Platform = "mac" | "windows" | "linux";

/**
 * 当前平台。
 *
 * 用 `navigator.userAgent` 而不引 `@tauri-apps/plugin-os`：
 * 一个依赖都不加就能覆盖三种平台，而 OS 插件是整个项目里唯一的依赖增量。
 */
export function currentPlatform(): Platform {
  if (typeof navigator === "undefined") return "mac";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("mac")) return "mac";
  if (ua.includes("win")) return "windows";
  return "linux";
}

/** 快捷键的作用域 */
export type ShortcutScope = "app" | "editor" | "both";

/** 一条快捷键的定义 */
export interface ShortcutDef {
  /**
   * 规范形式。
   *
   * 修饰符：`Mod`（mac 上是 ⌘、其它平台是 Ctrl）、`Shift`、`Alt`、`Ctrl`。
   * 用 `Mod` 而不是 `Meta`：同一份注册表在三个平台上都成立。
   */
  key: string;
  /** 功能名——冲突提示与菜单提示都用它 */
  label: string;
  /** 归属分组 */
  group: string;
  /** 作用域：全局（原生菜单）/ 编辑器内 / 两边都有 */
  scope: ShortcutScope;
  /**
   * 原生菜单动作 id。
   *
   * 有这个字段的条目**会出现在原生菜单里**，加速键由注册表生成。
   * 没有的只在编辑器内生效（命令面板、查找面板等）。
   */
  actionId?: string;
}

/**
 * 具名键：显示文本与 Tauri 加速键名**不一致**的，只有这一个。
 *
 * 为什么需要它：`-` 既是分隔符又是键名，而分隔符优先级更高，
 * 所以减号没法直接写进规范形式，只能用别名。
 *
 * 另一个坑在 `Equal`：muda 的物理键表里**没有 `Plus`**——
 * `CmdOrCtrl+Plus` 解析失败，而 Tauri 建菜单时用的是 `.parse().ok()`，
 * **解析失败会被静默吞掉**，菜单项直接没有快捷键还不报错。
 * （现有代码里「放大」就是踩了这个坑。）
 * 所以放大用的是 `Equal` 键（`⌘=`），它是能解析的那一个。
 */
const KEY_ALIASES: Record<string, { display: string; accel: string }> = {
  Minus: { display: "-", accel: "Minus" },
};

/**
 * 规范形式的键名常量。
 *
 * keymap 与注册表**共用**这一份常量——不是「注册表引用常量」，
 * 而是两边都引用它，这样连改键名都只有一个地方要动。
 */
export const KEYS = {
  // 文件
  newDocument: "Mod-n",
  openDocument: "Mod-o",
  save: "Mod-s",
  saveAs: "Mod-Shift-s",
  exportDocument: "Mod-Shift-e",
  // 编辑
  find: "Mod-f",
  /**
   * 替换用 `Ctrl` 而不是 `Mod`，是 macOS 特有的坑：
   * `Mod-h` 在 mac 上是 ⌘H，而系统应用菜单里的「隐藏 Inkstone」也是 ⌘H，
   * 两项撞车时 AppKit 取**菜单树里靠前**的那个——应用菜单在前，
   * 于是「隐藏」赢了，「替换」的 ⌘H **从来没生效过**。
   *
   * 换成 `Ctrl-h`：mac 上是 ⌃H（与 macOS 文本编辑器的「替换全部」一致，
   * 且不与系统菜单撞车），Windows / Linux 上仍是 Ctrl+H（与原来相同）。
   */
  replace: "Ctrl-h",
  copyAsMarkdown: "Mod-Shift-c",
  copyAsHtml: "Mod-Alt-c",
  pasteAsPlainText: "Mod-Shift-v",
  // 格式（只在编辑器内）
  bold: "Mod-b",
  italic: "Mod-i",
  inlineCode: "Mod-e",
  // 导航（只在编辑器内）
  palette: "Mod-k",
  quickOpen: "Mod-p",
  // 视图
  toggleSidebar: "Mod-Alt-b",
  toggleSourceMode: "Mod-/",
  focusMode: "Mod-Shift-f",
  typewriterMode: "Mod-Shift-t",
  // 其它
  preferences: "Mod-,",
} as const;

/**
 * 全部内置快捷键。
 *
 * 顺序即分组顺序：先文件、再编辑、再视图、最后杂项。
 */
export const SHORTCUTS: ShortcutDef[] = [
  /* ── 文件（全局：原生菜单） ── */
  {
    key: KEYS.newDocument,
    label: "新建文档",
    group: "文件",
    scope: "app",
    actionId: "new-document",
  },
  {
    key: KEYS.openDocument,
    label: "打开…",
    group: "文件",
    scope: "app",
    actionId: "open-document",
  },
  {
    key: KEYS.save,
    label: "保存",
    group: "文件",
    scope: "app",
    actionId: "save-document",
  },
  {
    key: KEYS.saveAs,
    label: "另存为…",
    group: "文件",
    scope: "app",
    actionId: "save-document-as",
  },
  {
    key: KEYS.exportDocument,
    label: "导出…",
    group: "文件",
    scope: "app",
    actionId: "export-document",
  },

  /* ── 编辑 ── */
  {
    key: KEYS.find,
    label: "查找",
    group: "编辑",
    scope: "both",
    actionId: "find",
  },
  {
    key: KEYS.replace,
    label: "替换",
    group: "编辑",
    scope: "app",
    actionId: "replace",
  },
  {
    key: KEYS.copyAsMarkdown,
    label: "复制为 Markdown 源码",
    group: "编辑",
    scope: "app",
    actionId: "copy-as-markdown",
  },
  {
    key: KEYS.copyAsHtml,
    label: "复制为 HTML",
    group: "编辑",
    scope: "both",
    actionId: "copy-as-html",
  },
  {
    key: KEYS.pasteAsPlainText,
    label: "粘贴为纯文本",
    group: "编辑",
    scope: "both",
    actionId: "paste-as-plain-text",
  },

  /* ── 格式（编辑器内） ── */
  { key: KEYS.bold, label: "加粗", group: "格式", scope: "editor" },
  { key: KEYS.italic, label: "斜体", group: "格式", scope: "editor" },
  { key: KEYS.inlineCode, label: "行内代码", group: "格式", scope: "editor" },

  /* ── 导航（编辑器内） ── */
  { key: KEYS.palette, label: "命令面板", group: "导航", scope: "editor" },
  { key: KEYS.quickOpen, label: "快速打开", group: "导航", scope: "editor" },

  /* ── 视图 ── */
  {
    key: KEYS.toggleSidebar,
    label: "显示/隐藏侧边栏",
    group: "视图",
    scope: "app",
    actionId: "toggle-sidebar",
  },
  {
    key: KEYS.toggleSourceMode,
    label: "源码模式",
    group: "视图",
    scope: "app",
    actionId: "toggle-source-mode",
  },
  {
    key: KEYS.focusMode,
    label: "专注模式",
    group: "视图",
    scope: "app",
    actionId: "toggle-focus-mode",
  },
  {
    key: KEYS.typewriterMode,
    label: "打字机模式",
    group: "视图",
    scope: "app",
    actionId: "toggle-typewriter-mode",
  },

  /* ── 其它（全局） ── */
  {
    key: KEYS.preferences,
    label: "偏好设置…",
    group: "其它",
    scope: "app",
    actionId: "preferences",
  },
];

/**
 * 菜单系统件：不是本应用的功能，但它们**也占加速键**，所以一并登记。
 *
 * 单独一张表而不是混进 `SHORTCUTS`，是因为它们：
 *   - 没有对应的编辑器内命令
 *   - 按键跟着系统约定走（⌘+ / ⌘- / ⌘0），不跟着本应用的功能走
 *
 * 之所以**必须**登记：加速键撞车的后果是「后绑的那个静默失灵」，
 * 系统件不在里面，就等于没登记。
 */
export const MENU_CHROME: {
  actionId: string;
  key: string;
  label: string;
  group: string;
}[] = [
  // 「放大」用 Equal 键（⌘=）而不是 Plus：muda 的物理键表里没有 Plus，
  // `CmdOrCtrl+Plus` 会被 Tauri 的 `.parse().ok()` 静默丢弃 —— 菜单项直接没有快捷键。
  { actionId: "zoom-in", key: "Mod-Equal", label: "放大", group: "视图" },
  { actionId: "zoom-out", key: "Mod-Minus", label: "缩小", group: "视图" },
  { actionId: "zoom-reset", key: "Mod-0", label: "实际大小", group: "视图" },
];

/**
 * 原生菜单的全部动作 id。
 *
 * 前端 `MenuAction` 类型从这里派生（`src/ipc/menu.ts`）——
 * 之前那个文件里**同一个列表写了两遍**（联合类型 + 数组），加一个动作要改两处。
 *
 * 凡是 `src-tauri/src/menu.rs` 里建出来的菜单项都该在这张表里：
 * 少一条 = 前端永远收不到那个菜单动作（Rust 侧有测试守着）。
 */
export const MENU_ACTION_IDS = [
  "new-document",
  "open-document",
  "save-document",
  "save-document-as",
  "export-document",
  "preferences",
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
  "check-update",
  // 「显示侧边栏」复选项：Rust 侧建了，前端目前还没接状态同步，
  // 但 id 必须登记——否则 Rust 侧的「菜单 id 都在清单里」测试会红。
  "check-sidebar",
] as const;

/** 原生菜单动作 id 的类型 */
export type MenuAction = (typeof MENU_ACTION_IDS)[number];

/** 按规范形式查注册表 */
export function findShortcut(key: string): ShortcutDef | undefined {
  return SHORTCUTS.find((item) => item.key === key);
}

/**
 * 已占用的键（用于冲突检查）。
 *
 * **三类作用域放在一起**：`app` 的键会吃掉 `editor` 的同名键，
 * 所以冲突检查必须跨作用域——M4-6 就是漏了这一步。
 */
export function takenShortcutKeys(): string[] {
  return [...SHORTCUTS.map((item) => item.key), ...MENU_CHROME.map((item) => item.key)];
}

/**
 * 注册表内部的自查：同一个键被两个**不同功能**占用 → 冲突。
 *
 * 同一个功能在两层各绑一次（scope `both`）不算冲突——
 * 那是「同一个功能的两个入口」，不是两个功能抢一个键。
 */
export function shortcutRegistryConflicts(): { key: string; a: string; b: string }[] {
  const all: { key: string; label: string }[] = [
    ...SHORTCUTS.map((item) => ({ key: item.key, label: item.label })),
    ...MENU_CHROME.map((item) => ({ key: item.key, label: item.label })),
  ];
  const conflicts: { key: string; a: string; b: string }[] = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      if (all[i].key !== all[j].key) continue;
      if (all[i].label === all[j].label) continue;
      conflicts.push({ key: all[i].key, a: all[i].label, b: all[j].label });
    }
  }
  return conflicts;
}

/**
 * 把规范形式转成给人看的标签（**平台感知**）。
 *
 * macOS 用符号（⌃⌥⇧⌘），Windows / Linux 用单词（Ctrl+Shift+Alt）。
 * 之前只有 macOS 一种，于是 Windows 上会把 ⌘ 显示给用户——
 * 那是个不存在的键。
 *
 * 符号顺序按 macOS 惯例：⌃⌥⇧⌘。
 */
export function formatShortcut(
  key: string,
  platform: Platform = currentPlatform(),
): string {
  if (!key) return "";
  const parts = key.split("-");
  const rawKey = parts.pop() ?? "";
  const mods = new Set(parts);
  const isMac = platform === "mac";

  const alias = KEY_ALIASES[rawKey];
  const displayKey = alias
    ? alias.display
    : rawKey.length === 1
      ? rawKey.toUpperCase()
      : rawKey;

  const labels: string[] = [];
  if (isMac) {
    if (mods.has("Ctrl")) labels.push("⌃");
    if (mods.has("Alt")) labels.push("⌥");
    if (mods.has("Shift")) labels.push("⇧");
    if (mods.has("Mod")) labels.push("⌘");
  } else {
    if (mods.has("Mod")) labels.push("Ctrl");
    if (mods.has("Shift")) labels.push("Shift");
    if (mods.has("Alt")) labels.push("Alt");
    // 非 mac 上 Mod 本身就是 Ctrl，两个都写会显示成「Ctrl+Ctrl」
    if (mods.has("Ctrl") && !mods.has("Mod")) labels.push("Ctrl");
  }

  return [...labels, displayKey].join(isMac ? "" : "+");
}

/**
 * 规范形式 → Tauri 加速键格式。
 *
 * `Mod-Shift-e` → `CmdOrCtrl+Shift+E`
 *
 * `CmdOrCtrl` 是 Tauri 的写法：mac 上是 ⌘，其它平台是 Ctrl。
 *
 * 产出的字符串**一定能被 muda 解析**——键名只取物理键表里有的那些。
 */
export function toAccelerator(key: string): string {
  if (!key) return "";
  const parts = key.split("-");
  const rawKey = parts.pop() ?? "";
  const mods = new Set(parts);

  const alias = KEY_ALIASES[rawKey];
  const accelKey = alias
    ? alias.accel
    : rawKey.length === 1
      ? rawKey.toUpperCase()
      : rawKey;

  const out: string[] = [];
  if (mods.has("Mod")) out.push("CmdOrCtrl");
  if (mods.has("Shift")) out.push("Shift");
  if (mods.has("Alt")) out.push("Alt");
  if (mods.has("Ctrl")) out.push("Ctrl");
  out.push(accelKey);
  return out.join("+");
}

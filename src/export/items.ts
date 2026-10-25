/**
 * 导出项的用户自定义：解析、增删、重排、重命名、快捷键。
 *
 * ## 分层：格式 / 设置 / 解析结果
 *
 * - **格式**（`registry.ts`）：应用认识的全部输出格式。
 *   内置 9 种 + 可额外添加的 pandoc 格式 12 种。
 * - **设置**（`settings/schema.ts` 的 `ExportItemSetting[]`）：用户填的，
 *   可能是空的，可能是半个。
 * - **解析结果**（本文件的 `ResolvedExportItem`）：一定能用的——
 *   有格式、有显示名、有快捷键。
 *
 * 上层（导出面板、设置面板、导出服务）**只认解析结果**，不直接读设置——
 * 否则「设置里写了什么」和「实际能用什么」会分叉。
 *
 * ## 解析规则
 *
 * 设置列表为**空** → 用内置默认（内置项按注册表顺序，全部可见）。
 *
 * 设置列表**非空** → 它是权威的有序列表：
 *   - 顺序 = 面板里的显示顺序
 *   - `visible === false` = 被移除（条目仍留在列表里，设置面板能把它列进
 *     「已移除」一栏，用户想恢复时找得到）
 *   - 没被提及的**内置项**按默认补在末尾——这样以后版本新增内置格式时，
 *     老用户不会莫名其妙少一种格式
 *   - 指向不存在格式的 id 被跳过（设置文件可能来自旧版本）
 *
 * ## 为什么「移除」是 visible:false 而不是从列表里删掉
 *
 * 删掉的话，用户就再也看不到「我原来有这一项」，
 * 也没法把它挪回原来的位置——只能整个恢复默认，把其他自定义一起冲掉。
 * 留着条目、只标记不可见，信息不丢。
 */

import {
  ALL_EXPORT_FORMATS,
  BUILTIN_EXPORT_FORMATS,
  EXTRA_PANDOC_FORMATS,
  findExportFormat,
  type ExportFormat,
} from "./registry";
import type { ExportItemSetting } from "@/settings/schema";

/** 解析后的导出项：一定能用 */
export interface ResolvedExportItem {
  /** 格式本身 */
  format: ExportFormat;
  /** 面板里显示的名字（用户改名优先） */
  label: string;
  /** 绑定的快捷键（CM6 语法，如 `Mod-Shift-1`）；空串 = 不绑定 */
  shortcut: string;
  /** 是否在导出面板里显示 */
  visible: boolean;
  /** 是否是用户额外添加的格式（不在内置清单里） */
  added: boolean;
}

/**
 * 解析用户设置，得到最终的导出项列表。
 *
 * @param settings 设置里的 `export.items`；空/未定义 = 用内置默认
 */
export function resolveExportItems(settings?: ExportItemSetting[]): ResolvedExportItem[] {
  const entries = settings ?? [];
  if (entries.length === 0) {
    return BUILTIN_EXPORT_FORMATS.map((format) => ({
      format,
      label: format.label,
      shortcut: "",
      visible: true,
      added: false,
    }));
  }

  const seen = new Set<string>();
  const resolved: ResolvedExportItem[] = [];

  for (const entry of entries) {
    const format = findExportFormat(entry.id);
    // 未知 id：跳过而不是抛错——设置文件可能来自旧版本，
    // 不能因为一个失效的 id 让整个应用起不来
    if (!format) continue;
    // 同一个 id 出现两次：取第一个，后面的忽略（否则面板里会重复）
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    resolved.push({
      format,
      label: entry.label?.trim() || format.label,
      shortcut: entry.shortcut?.trim() ?? "",
      visible: entry.visible !== false,
      added: !format.builtin,
    });
  }

  // 没被提及的内置项补在末尾（详见文件头的解析规则）
  for (const format of BUILTIN_EXPORT_FORMATS) {
    if (seen.has(format.id)) continue;
    resolved.push({
      format,
      label: format.label,
      shortcut: "",
      visible: true,
      added: false,
    });
  }

  return resolved;
}

/**
 * 把解析结果转成「完整的设置列表」。
 *
 * 设置面板首次自定义时用它打底：写入的列表必须**完整**，
 * 否则用户只是改了个名字，设置文件里也会多出一堆无关条目。
 *
 * @param settings 当前的设置
 * @returns 覆盖全部内置项 + 用户已添加的项的有序列表
 */
export function materializeExportItems(
  settings?: ExportItemSetting[],
): ExportItemSetting[] {
  return resolveExportItems(settings).map((item) => {
    const entry: ExportItemSetting = { id: item.format.id };
    if (item.label !== item.format.label) entry.label = item.label;
    if (item.shortcut) entry.shortcut = item.shortcut;
    if (!item.visible) entry.visible = false;
    return entry;
  });
}

/** 找某个 id 的解析结果 */
export function findResolvedExportItem(
  id: string,
  settings?: ExportItemSetting[],
): ResolvedExportItem | undefined {
  return resolveExportItems(settings).find((item) => item.format.id === id);
}

/** 还没被用户添加的额外格式（设置面板的「添加」列表用） */
export function availableExtraFormats(settings?: ExportItemSetting[]): ExportFormat[] {
  const used = new Set(resolveExportItems(settings).map((item) => item.format.id));
  return EXTRA_PANDOC_FORMATS.filter((format) => !used.has(format.id));
}

/* ── 快捷键 ── */

/**
 * 应用自己占用的快捷键。
 *
 * 用来在设置面板里提示「这个键已经被占用了」。
 * 只列**本应用显式绑定**的那些，不列 CM6 的全部默认键位——
 * 列全了会有几十条，看着吓人，而且大部分是用户不会去按的。
 *
 * `Mod` 在 macOS 上是 ⌘，在其它平台是 Ctrl。
 *
 * 原生菜单的加速键也在表里：那些键由 NSApp 处理，
 * webview 根本收不到——绑上去也不会生效，所以要提前挡掉。
 */
export const RESERVED_SHORTCUTS: { key: string; label: string }[] = [
  // 编辑器内（CM6 键位表）
  { key: "Mod-b", label: "加粗" },
  { key: "Mod-i", label: "斜体" },
  { key: "Mod-e", label: "行内代码" },
  { key: "Mod-k", label: "命令面板" },
  { key: "Mod-p", label: "快速打开" },
  { key: "Mod-f", label: "查找" },
  { key: "Mod-Alt-c", label: "复制为 HTML" },
  { key: "Mod-Shift-v", label: "粘贴为纯文本" },
  // 原生菜单（NSApp 吃掉，webview 收不到）
  { key: "Mod-n", label: "新建文档" },
  { key: "Mod-o", label: "打开…" },
  { key: "Mod-s", label: "保存" },
  { key: "Mod-Shift-s", label: "另存为…" },
  { key: "Mod-Shift-e", label: "导出…" },
  { key: "Mod-Shift-c", label: "复制为 Markdown 源码" },
  { key: "Mod-Alt-b", label: "显示/隐藏侧边栏" },
  { key: "Mod-h", label: "替换…" },
  { key: "Mod-,", label: "偏好设置…" },
  { key: "Mod-/", label: "源码模式" },
  { key: "Mod-Shift-f", label: "专注模式" },
  { key: "Mod-Shift-t", label: "打字机模式" },
];

/** 修饰符的别名 → 规范名 */
const MODIFIER_ALIASES: Record<string, string> = {
  "⌘": "Mod",
  cmd: "Mod",
  command: "Mod",
  meta: "Mod",
  mod: "Mod",
  super: "Mod",
  "⇧": "Shift",
  shift: "Shift",
  "⌥": "Alt",
  alt: "Alt",
  option: "Alt",
  "⌃": "Ctrl",
  ctrl: "Ctrl",
  control: "Ctrl",
};

/**
 * 修饰符的规范顺序（用于生成规范形式，保证同一组键只有一个写法）。
 *
 * 顺序按「读起来像快捷键」来：`Mod-Shift-Alt-…`。
 * CM6 自己会重新规范化（修饰符顺序对它无所谓），
 * 但**我们**要用字符串比较来判断冲突，顺序必须固定。
 */
const MODIFIER_ORDER = ["Mod", "Shift", "Alt", "Ctrl"] as const;

/** 可以单独当键用的具名键 */
const NAMED_KEYS = new Set([
  "Enter",
  "Escape",
  "Tab",
  "Space",
  "Backspace",
  "Delete",
  "Insert",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Up",
  "Down",
  "Left",
  "Right",
]);

/**
 * 符号形式的修饰符 → 单词形式。
 *
 * 替换时带上分隔符：`⌘⇧1` → `Mod+Shift+1`，
 * 这样后面的「按分隔符切分」就能把它拆成三段。
 */
const SYMBOL_MODIFIERS: [string, string][] = [
  ["⌘", "Mod"],
  ["⇧", "Shift"],
  ["⌥", "Alt"],
  ["⌃", "Ctrl"],
];

/**
 * 把用户输入的快捷键解析成 CM6 的规范形式。
 *
 * 接受三种写法：
 *   - CM6 原生：`Mod-Shift-1`
 *   - 人类写法：`⌘⇧1`、`Cmd+Shift+1`、`cmd shift 1`
 *   - 单个键：`F5`、`Escape`
 *
 * 返回规范形式（修饰符按固定顺序 + 小写字母键），空串表示**解析失败**。
 *
 * 规范形式为什么用 `Mod` 而不是 `Meta`：
 * `Mod` 在 macOS 上是 ⌘、在其它平台是 Ctrl，跟着平台走，
 * 同一份设置文件在三个平台上都成立。
 *
 * 字母键为什么转小写：CM6 的键名对字母是小写（`w3c-keyname` 的约定），
 * 用户写「Cmd+Shift+A」要能匹配上，得转成 `Mod-Shift-a`。
 */
export function parseShortcut(input: string): string {
  let text = input.trim();
  if (!text) return "";

  // 符号修饰符先换成单词形式
  for (const [symbol, word] of SYMBOL_MODIFIERS) {
    if (text.includes(symbol)) text = text.split(symbol).join(`${word}+`);
  }

  // 分隔符：有人写 `+`（人类写法），有人写 `-`（CM6 原生），也有人用空格
  let parts: string[];
  if (text.includes("+")) parts = text.split("+");
  else if (text.includes("-")) parts = text.split("-");
  else parts = text.split(/\s+/);

  const key = parts.pop()?.trim() ?? "";
  if (!key) return "";

  const modifiers = new Set<string>();
  for (const raw of parts) {
    const token = raw.trim().toLowerCase();
    if (!token) continue;
    const modifier = MODIFIER_ALIASES[token];
    if (!modifier) return "";
    modifiers.add(modifier);
  }

  const normalizedKey = normalizeKey(key);
  if (!normalizedKey) return "";

  const ordered = MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier));
  return [...ordered, normalizedKey].join("-");
}

/** 键名规范化：小写字母、具名键原样、F 键大写 */
function normalizeKey(key: string): string {
  if (key.length === 1) {
    const code = key.codePointAt(0) ?? 0;
    // 字母转小写；数字与符号原样
    if (code >= 65 && code <= 90) return key.toLowerCase();
    return key;
  }
  if (/^f\d{1,2}$/i.test(key)) return key.toUpperCase();
  if (NAMED_KEYS.has(key)) return key;
  return "";
}

/**
 * 把规范形式转成给人看的标签。
 *
 * 一律用 macOS 的符号（⌘⇧⌥⌃）——本项目 macOS 优先，
 * 而命令面板里已有的快捷键标签也是这个风格（`⌘S` / `⌘F`）。
 *
 * 符号顺序按 macOS 惯例：⌃⌥⇧⌘（与存储顺序无关）。
 */
export function formatShortcutLabel(shortcut: string): string {
  if (!shortcut) return "";
  const parts = shortcut.split("-");
  const key = parts.pop() ?? "";
  const modifiers = new Set(parts);
  const symbols: [string, string][] = [
    ["Ctrl", "⌃"],
    ["Alt", "⌥"],
    ["Shift", "⇧"],
    ["Mod", "⌘"],
  ];
  const prefix = symbols
    .filter(([name]) => modifiers.has(name))
    .map(([, symbol]) => symbol)
    .join("");
  // 单个字母统一大写显示（⌘A 而不是 ⌘a）——macOS 菜单里就是这么写的
  const displayKey = key.length === 1 ? key.toUpperCase() : key;
  return `${prefix}${displayKey}`;
}

/**
 * 检查一个快捷键是否与已有占用冲突。
 *
 * @param shortcut 要检查的规范形式
 * @param taken 已经被占用的规范形式集合
 * @returns 冲突说明（占用它的功能名），没冲突返回 null
 */
export function shortcutConflict(
  shortcut: string,
  taken: Iterable<string>,
): string | null {
  if (!shortcut) return null;
  for (const key of taken) {
    if (key === shortcut) return "已被其他导出项占用";
  }
  const reserved = RESERVED_SHORTCUTS.find((item) => item.key === shortcut);
  if (reserved) return `已被「${reserved.label}」占用`;
  return null;
}

/** 全部已知格式（供设置面板展示「可添加」清单时排除已用项） */
export { ALL_EXPORT_FORMATS };

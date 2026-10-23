/**
 * 命令注册表。
 *
 * 一份命令表，三个入口共用：
 *   - **命令面板**（⌘K）：全部命令，按分类分节
 *   - **斜杠菜单**（`/`）：只有 `surfaces` 含 `slash` 的那些
 *   - **原生菜单 / 快捷键**（未来）：直接 `runCommand(id)`
 *
 * ## 为什么用模块级注册表而不是 React context
 *
 * 命令要能在**编辑器扩展里**被调用（斜杠菜单的补全源是普通函数，拿不到 context），
 * 而面板又在 React 树里。注册表放在模块作用域，两个世界都能直接用，
 * 也和 `active-view.ts` / `settings/store.ts` 的既有写法一致。
 *
 * ## 为什么不把「视图切换 / 保存文件」也做成命令
 *
 * 它们要穿过编辑器走到 React（`EditorSurface` 的 handle、`App` 的文件操作）。
 * 命令表里放一个 `emitIntent("toggle-focus-mode")`，由 React 侧订阅并执行——
 * 命令表不持有任何 React 依赖，方向是单向的（命令 → 意图 → React）。
 */

import type { EditorView } from "@codemirror/view";
import { getActiveEditorView } from "./active-view";

/** 命令出现在哪些入口 */
export type CommandSurface = "palette" | "slash";

export interface InkstoneCommand {
  /** 唯一 id。快捷键、菜单、测试都用它，不随文案变化 */
  id: string;
  /** 显示名（中文） */
  label: string;
  /** 分类，面板按它分节 */
  category: string;
  /** 快捷键提示，仅展示（如 "⌘B"）。真实绑定见 MarkdownEditor 的 keymap */
  shortcut?: string;
  /**
   * 额外的可搜索词，空格分隔。
   *
   * 面板的模糊匹配会一并命中这些词。像「表格」这种，
   * 用户更可能搜 `table` 或 `biaoge`——但拼音不现实（见 matchCommands），
   * 所以只放英文原名与常见缩写。
   */
  keywords?: string;
  /** 出现在哪些入口；省略 = 两处都出现 */
  surfaces?: readonly CommandSurface[];
  /**
   * 当前是否可用。
   *
   * 不可用的命令**不列进面板**——CM6 的 `Completion` 没有 per-item 的 `disabled`
   * （只有整个弹层的 disabled，指的是「源还在查」），所以置灰得自己实现。
   * 与其做半吊子的置灰，不如不列。
   */
  enabled?: (view: EditorView) => boolean;
  /** 执行。返回 false 表示没做成（用于快捷键链继续往下传） */
  run: (view: EditorView) => boolean | void;
}

const registry = new Map<string, InkstoneCommand>();
const listeners = new Set<() => void>();

function emitChange(): void {
  for (const listener of listeners) listener();
}

/** 注册一批命令。重复 id 直接覆盖（热更新时会发生） */
export function registerCommands(commands: readonly InkstoneCommand[]): void {
  let changed = false;
  for (const command of commands) {
    if (registry.get(command.id) !== command) {
      registry.set(command.id, command);
      changed = true;
    }
  }
  if (changed) emitChange();
}

export function getCommand(id: string): InkstoneCommand | undefined {
  return registry.get(id);
}

/** 全部命令，按「分类 → 显示名」稳定排序（排序键用 id，避免同名歧义） */
export function allCommands(): InkstoneCommand[] {
  return [...registry.values()].sort(
    (a, b) =>
      a.category.localeCompare(b.category, "zh-Hans-CN") || a.id.localeCompare(b.id),
  );
}

/**
 * 指定入口的命令，`enabled` 为假的剔除。
 *
 * `view` 省略时回落到当前活动编辑器（与 `runCommand` 一致）：
 * 传 `null` 进来却**不**检查 `enabled`，等于让「不可用」的命令混进列表，
 * 那还不如不提供这个能力。
 */
export function commandsFor(
  surface: CommandSurface,
  view?: EditorView | null,
): InkstoneCommand[] {
  const target = view ?? getActiveEditorView();
  return allCommands().filter((command) => {
    if (command.surfaces && !command.surfaces.includes(surface)) return false;
    if (target && command.enabled && !command.enabled(target)) return false;
    return true;
  });
}

/** 订阅命令表变化（命令是热注册进来的，React 侧要能重渲染） */
export function onCommandsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 按 id 执行命令 */
export function runCommand(id: string, view: EditorView | null): boolean {
  const command = registry.get(id);
  if (!command) return false;
  const target = view ?? getActiveEditorView();
  if (!target) return false;
  if (command.enabled && !command.enabled(target)) return false;
  return command.run(target) !== false;
}

/* ═══════════════════════════════════════════════════════════
 * 模糊匹配
 * ═══════════════════════════════════════════════════════════ */

export interface ScoredCommand {
  command: InkstoneCommand;
  score: number;
  /** 命中字符在 label 里的下标，用于高亮 */
  matched: number[];
}

/** 分档：数字越小越靠前 */
const TIER = {
  labelPrefix: 0,
  labelWordPrefix: 1,
  labelSubstring: 2,
  keywordPrefix: 3,
  keywordSubstring: 4,
  subsequence: 5,
} as const;

function findSubsequence(haystack: string, needle: string): number[] | null {
  const positions: number[] = [];
  let index = 0;
  for (const char of needle) {
    const found = haystack.indexOf(char, index);
    if (found === -1) return null;
    positions.push(found);
    index = found + 1;
  }
  return positions;
}

/**
 * 面板查询 → 排好序的命令。
 *
 * 分档而不是一个连续分数：分档让「`表格` 命中 `插入表格`」这种前缀匹配
 * 永远压过「`表格` 只是 `导出为 HTML 表格` 里的一段」这种子串命中，
 * 而档内再按命中位置与长度微调。
 *
 * **不做拼音。** `:biaoge` 打出 `:表格` 需要一张两万字的汉字拼音表，
 * 而拼音首字母（`:bg`）又和英文缩写（`:bg` = bold）撞车——
 * 为此背上一个高误触的负担不划算。想要就靠 `keywords` 里手写英文名。
 */
export function matchCommands(
  commands: readonly InkstoneCommand[],
  query: string,
  limit = 60,
): ScoredCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return commands
      .slice(0, limit)
      .map((command) => ({ command, score: 0, matched: [] }));
  }

  const scored: ScoredCommand[] = [];
  for (const command of commands) {
    const label = command.label.toLowerCase();
    const hit = scoreOne(label, q);
    if (hit) {
      scored.push({ command, ...hit });
      continue;
    }
    // 再拿 keywords 试一遍（英文原名 / 缩写）
    if (command.keywords) {
      let best: { score: number; matched: number[] } | null = null;
      for (const word of command.keywords.toLowerCase().split(/\s+/)) {
        const candidate = scoreOne(word, q);
        if (candidate && (!best || candidate.score < best.score)) best = candidate;
      }
      if (best) scored.push({ command, score: best.score + 100, matched: [] });
    }
  }

  scored.sort(
    (a, b) =>
      a.score - b.score ||
      a.command.label.length - b.command.label.length ||
      a.command.id.localeCompare(b.command.id),
  );
  return scored.slice(0, limit);
}

/**
 * 模糊匹配一个字符串。
 *
 * 抽出来是为了给「快速打开」复用——命令名和文件名要的是同一套匹配手感：
 * 前缀命中压过词首命中，词首压过子串，子串压过散落的子序列。
 * 两处各写一套，迟早会调成不一样的手感。
 *
 * 返回 `null` 表示没匹配上。
 */
export function fuzzyScore(
  text: string,
  q: string,
): { score: number; matched: number[] } | null {
  return scoreOne(text, q);
}

function scoreOne(text: string, q: string): { score: number; matched: number[] } | null {
  const range = (from: number, len: number): number[] =>
    Array.from({ length: len }, (_, i) => from + i);

  if (text.startsWith(q)) {
    return {
      score: TIER.labelPrefix * 1000 + (text.length - q.length),
      matched: range(0, q.length),
    };
  }
  // 「词首」= 前面是分隔符。中文没有词边界，所以这档主要服务英文名
  const wordBoundary = new RegExp(`(^|[\\s\\-（(])${escapeRegExp(q)}`);
  const wordMatch = wordBoundary.exec(text);
  if (wordMatch) {
    const at = wordMatch.index + wordMatch[1].length;
    return {
      score: TIER.labelWordPrefix * 1000 + (text.length - q.length),
      matched: range(at, q.length),
    };
  }
  const at = text.indexOf(q);
  if (at !== -1) {
    return { score: TIER.labelSubstring * 1000 + at, matched: range(at, q.length) };
  }
  const positions = findSubsequence(text, q);
  if (positions) {
    // 跨度越大越差：「插入表格」四个字符散落在 20 字里不该压过紧凑命中的
    const span = positions[positions.length - 1] - positions[0] + 1;
    return { score: TIER.subsequence * 1000 + span + text.length, matched: positions };
  }
  return null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

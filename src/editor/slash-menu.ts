/**
 * 斜杠菜单：行首打 `/` 弹出块级插入菜单。
 *
 * 复用 `commandsFor("slash", view)` 那一子集——命令表是唯一的真相源，
 * 面板和斜杠菜单看到的是同一批命令，只是入口不同。
 *
 * ## 为什么这个**是**补全源，而命令面板不是
 *
 * 斜杠菜单的查询词就躺在文档里（`/tab`），接受时要把那整段替换掉——
 * 这正好是 CM6 补全的模型：`from` 指向 `/`，`to` 指向光标，
 * `apply` 收到这两个位置。它自带的 ↑↓/Enter/Esc/定位/遮罩点击关闭全是白送的。
 *
 * 命令面板恰好相反（查询在面板里、文档不动），所以那个用 React 覆盖层。
 * 见 `views/CommandPalette.tsx` 顶上的对照表。
 *
 * ## `filter: false` 的原因同 emoji
 *
 * CM6 在 `filter !== false` 时会拿 `sliceDoc(from, to)`（即 `/tab`）
 * 模糊匹配 `option.label`（`表格`）——匹配不上就静默不弹层。
 * 检索和排序由 `matchCommands` 全包，所以一律关掉。
 */

import type {
  Completion,
  CompletionResult,
  CompletionContext,
} from "@codemirror/autocomplete";
import { commandsFor, matchCommands, runCommand, type InkstoneCommand } from "./commands";
import { getActiveEditorView } from "./active-view";
import { t } from "@/i18n";

/** 触发前缀 */
const TRIGGER = "/";

/** 前缀后允许的字符：中文、字母、数字、空格、连字符 */
const QUERY_BODY = /^[\p{L}\p{N}\s-]*$/u;

/**
 * 斜杠**之前**允许出现什么。
 *
 * 只有空白、单个列表符号、单个引用符号。正文中间（`1/2`、`a/b`、`and/or`）
 * 匹配不上——那是正常写法，在那里弹菜单等于干扰。
 * Markdown 的块级语法本来就只出现在行首。
 */
const HEAD_ALLOWED = /^\s*(?:[-*+]|\d+[.)]|>)?\s*$/u;

/** 前缀最长多少字符 */
const MAX_QUERY = 24;

/** 最多列多少条 */
const MAX_OPTIONS = 40;

/** 候选项的 type，同时用于 CSS 与将来接图标 */
export const SLASH_OPTION_TYPE = "slash";

/**
 * 识别 `/` 触发点。
 *
 * 只有在「行首」或「列表项开头」才触发：
 *  - 行首：`/`
 *  - 有序/无序列表项里：`- /`
 *  - 引用里：`> /`
 *
 * 为什么这么严：正文中间打 `1/2`、`a/b`、`and/or` 是**正常写法**，
 * 在那里弹菜单等于干扰。Markdown 的块级语法本来就只出现在行首。
 */
export function findSlashTrigger(
  context: CompletionContext,
): { from: number; query: string } | null {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);

  const slash = before.lastIndexOf(TRIGGER);
  if (slash === -1) return null;

  // ⚠️ 只校验斜杠**之前**那段。正则不接受 `/` 本身——
  // `before` 是含光标前所有字符的，斜杠就在里面，直接拿它去匹配必然失败。
  const head = before.slice(0, slash);
  if (!HEAD_ALLOWED.test(head)) return null;

  const query = before.slice(slash + 1);
  if (query.length > MAX_QUERY) return null;
  if (!QUERY_BODY.test(query)) return null;

  return { from: context.pos - query.length - 1, query: query.toLowerCase() };
}

/** 候选项：label 是显示名，detail 给分类 */
function toOptions(
  hits: readonly { command: InkstoneCommand; score: number; matched: number[] }[],
): Completion[] {
  return hits.map((hit) => ({
    label: t(hit.command.label),
    detail: t(hit.command.category),
    type: SLASH_OPTION_TYPE,
    apply: (view) => {
      runCommand(hit.command.id, view);
    },
  }));
}

/**
 * 斜杠菜单补全源。
 *
 * 显式触发（用户按了某个键）时也要求行首有 `/`：
 * 没前缀就弹一屏块级菜单没有意义。
 */
export function slashMenuCompletion(context: CompletionContext): CompletionResult | null {
  const trigger = findSlashTrigger(context);
  if (!trigger) return null;

  const commands = commandsFor("slash", context.view ?? getActiveEditorView());
  if (commands.length === 0) return null;

  const options = toOptions(matchCommands(commands, trigger.query, MAX_OPTIONS));
  if (options.length === 0) return null;

  return {
    from: trigger.from,
    to: context.pos,
    options,
    // 与 emoji 同理：filter 关了就不能给 validFor（上游文档明确禁止同时给），
    // 每敲一个字符重查一次。命令表只有几十条，重查成本可以忽略。
    filter: false,
  };
}

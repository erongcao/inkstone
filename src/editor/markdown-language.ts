/**
 * 编辑器使用的 Markdown 语法定义——**全应用唯一一份**。
 *
 * 背景（这是个真实踩过的坑）：
 *   - `live-preview/syntax.ts` 需要 GFM（表格、任务列表、删除线），所以它用
 *     `@lezer/markdown` 的 `parser.configure(GFM)`
 *   - 但 `markdown({ base })`（CM6 的语法高亮）有一道
 *     `parser instanceof MarkdownParser` 校验，而 pnpm 会装**两份** `@lezer/markdown`，
 *     外部配置的 parser 直接被拒（实测 `RangeError: Base parser provided to
 *     markdown should be a Markdown parser`）
 *
 *   结果是编辑器里**并存两棵语法树**：
 *     - `syntaxTree(state)` → CM6 的，**裸 parser**，不认 GFM
 *     - `getSyntaxTree(state)` → Live Preview 的，GFM
 *
 *   后果不是「颜色不好看」，而是**行为不一致**：
 *   靠 `syntaxTree()` 写的编辑逻辑会看不见任务列表（`- [x]` 没有 TaskMarker 节点）。
 *
 * 解法：拿 **CM6 自己的** parser 实例去 `.configure(GFM)`——
 * 类还是同一个类，`instanceof` 过得了；扩展对象本身也不带类身份。
 * 于是两处共用同一个 Language，问题从根上消失。
 */

import { Language } from "@codemirror/language";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { GFM, type MarkdownParser } from "@lezer/markdown";

/**
 * CM6 的 `markdownLanguage.parser` 在类型上只是 `Parser`，
 * 但运行时就是 CM6 自己的 `MarkdownParser` 实例——
 * `.configure()` 的返回值仍是同一个类，所以 `markdown({ base })`
 * 的 `instanceof` 校验才过得去。外部新建的 parser 过不了（pnpm 两份包）。
 */
const base = markdownLanguage.parser as MarkdownParser;

/**
 * 编辑器使用的 Markdown 语言（含 GFM）。
 *
 * 复用 CM6 自己的 `data` facet（里面是 markdown 语言的全部数据/指令），
 * 只把 parser 换成配了 GFM 的那个。
 */
export const gfmMarkdownLanguage: Language = new Language(
  markdownLanguage.data,
  base.configure(GFM),
);

/** 与 `gfmMarkdownLanguage` 配套的 parser，供需要裸 tree 的地方使用 */
export const gfmMarkdownParser = gfmMarkdownLanguage.parser;

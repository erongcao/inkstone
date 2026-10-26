/**
 * 编辑器使用的 Markdown 语法定义——**全应用唯一一份**。
 *
 * 背景（这是个真实踩过的坑）：
 *   - `live-preview/syntax.ts` 需要 GFM（表格、任务列表、删除线），所以它用
 *     `@lezer/markdown` 的 `parser.configure(GFM)`
 *   - 但 `markdown({ base })`（CM6 的语法高亮）有一道
 *     `parser instanceof MarkdownParser` 校验——
 *     如果外部配置的 parser 来自**另一份** `@lezer/markdown`（pnpm 装了两份
 *     同名不同路径的实体时就会这样），校验直接抛
 *     `RangeError: Base parser provided to markdown should be a Markdown parser`
 *
 *   结果是编辑器里**并存两棵语法树**：
 *     - `syntaxTree(state)` → CM6 的，**裸 parser**，不认 GFM
 *     - `getSyntaxTree(state)` → Live Preview 的，GFM
 *
 *   后果不是「颜色不好看」，而是**行为不一致**：
 *   靠 `syntaxTree()` 写的编辑逻辑会看不见任务列表（`- [x]` 没有 TaskMarker 节点）。
 *
 * 解法：拿 **CM6 自己的** parser 实例去 `.configure(...)`——
 * 类还是同一个类，`instanceof` 过得了；扩展对象本身也不带类身份。
 * 于是两处共用同一个 Language，问题从根上消失。
 *
 * （现在 pnpm 把 `@lezer/markdown` 去重成了一份实体，两边 resolve 到同一目录，
 * 但结论不变：**不要**自己去 new 一个 `@lezer/markdown` 的 parser 来传给
 * `markdown({base})`——万一哪天依赖树变了，那道 `instanceof` 会拦下来。）
 */

import { Language } from "@codemirror/language";
import { markdownLanguage } from "@codemirror/lang-markdown";
import type { MarkdownConfig, MarkdownParser } from "@lezer/markdown";
import { tags as t } from "@lezer/highlight";
import { DEFAULT_FEATURES, featuresKey, type MarkdownFeatures } from "@/parser/features";

/**
 * 标点字符判定。
 *
 * 与 `@lezer/markdown` 内部用的那一份**逐字一致**——
 * 它没从包入口导出（`index.ts` 只导出类型，不导出 `Punctuation` 这个值），
 * 所以这里复制一份。
 *
 * 规则必须一样：开标记后面是标点时，只有前面也是标点才算「能开」。
 * 两边判定不一致，编辑器与导出就会对同一段文字给出不同结论
 * ——那就是架构约束 C 被破坏的样子。
 */
let Punctuation = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~\xA1\u2010-\u2027]/;
try {
  Punctuation = new RegExp("[\\p{S}|\\p{P}]", "u");
} catch {
  // 旧引擎不支持 Unicode 属性转义，保留上面的 ASCII 版本
}

/** `==` 的分隔符描述：成对出现时合成一个 Highlight 节点 */
const HighlightDelim = { resolve: "Highlight", mark: "HighlightMark" };

/**
 * `==高亮==` 的行内解析扩展（Typora 同款，非 GFM）。
 *
 * 照抄 `@lezer/markdown` 自带的 GFM 删除线扩展（`Strikethrough`），
 * 只把标记从 `~~` 换成 `==`——包括 flanking 判定（开标记后不能是空白，
 * 闭标记前不能是空白），所以它和 remark 侧那份
 * （`micromark-extension-highlight-mark`，同样派生自 GFM 删除线模板）
 * 对同一段文字给出的结论一致。
 *
 * 一致性由 `tests/parser-agreement.test.ts` 在语料库上断言。
 */
export const Highlight: MarkdownConfig = {
  defineNodes: [
    { name: "Highlight", style: t.special(t.content) },
    { name: "HighlightMark", style: t.processingInstruction },
  ],
  parseInline: [
    {
      name: "Highlight",
      parse(cx, next, pos) {
        // `next` 不是 `=`、第二个字符不是 `=`、或者连着三个 `=`（那是别的意思）→ 不是高亮
        if (next != 61 /* '=' */ || cx.char(pos + 1) != 61 || cx.char(pos + 2) == 61)
          return -1;
        const before = cx.slice(pos - 1, pos);
        const after = cx.slice(pos + 2, pos + 3);
        const sBefore = /\s|^$/.test(before);
        const sAfter = /\s|^$/.test(after);
        const pBefore = Punctuation.test(before);
        const pAfter = Punctuation.test(after);
        return cx.addDelimiter(
          HighlightDelim,
          pos,
          pos + 2,
          !sAfter && (!pAfter || sBefore || pBefore),
          !sBefore && (!pBefore || sAfter || pAfter),
        );
      },
      after: "Emphasis",
    },
  ],
};

/**
 * CM6 的 `markdownLanguage.parser` 在类型上只是 `Parser`，
 * 但运行时就是 CM6 自己的 `MarkdownParser` 实例——
 * `.configure()` 的返回值仍是同一个类，所以 `markdown({ base })`
 * 的 `instanceof` 校验才过得去。外部新建的 parser 过不了（pnpm 两份包）。
 */
const base = markdownLanguage.parser as MarkdownParser;

/**
 * 按开关组装 lezer 的解析器。
 *
 * 与 remark 侧**一一对应**（架构约束 C）：
 *
 * | 扩展 | 开关 |
 * |---|---|
 * | `Table` | `features.tables` |
 * | `TaskList` | `features.taskLists` |
 * | `Highlight` | `features.highlight` |
 * | `Strikethrough` / `Autolink` | 始终开启（没有开关） |
 *
 * ## 关键：`base` **已经自带 GFM**，所以「关掉」要用 `remove`
 *
 * `base` 是 `@codemirror/lang-markdown` 的 `markdownLanguage.parser`，
 * 而它不是裸的 CommonMark——CM6 那边的定义是：
 *
 * ```js
 * const extended = commonmark.configure([GFM, Subscript, Superscript, Emoji, …])
 * const markdownLanguage = mkLang(extended)
 * ```
 *
 * 也就是说 `base` 里**已经有** Table / TaskList / Strikethrough / Autolink。
 *
 * 而 lezer 的 `configure` 是**加法**：它只会往解析器列表里**追加**，
 * 没有「替换掉已有解析器」的概念（同名的是**覆盖**，但只能覆盖成同一个）。
 * 所以「表格开关关掉」如果只是「不往里加 Table」，**根本关不掉**——
 * `base` 里那份还在，表格照样被解析。
 *
 * 真正能摘掉一个解析器的只有 `MarkdownConfig.remove`：
 * 它按**解析器名**把对应的 block/inline 解析器置空。
 *
 * 这也是为什么这里的写法是「**先摘、再加**」而不是「只加需要的」——
 * 后者对 `base` 里已有的东西完全无效。
 *
 * 不能改成「从裸 CommonMark 重新搭」：`base` 上还挂着 CM6 的
 * `headingProp`（标题折叠靠它）、`indentNodeProp`（缩进靠它）、
 * `languageDataProp`（注释 token 靠它）——那些定义在
 * `@codemirror/lang-markdown` 的模块作用域里，**没有导出**，拿不到。
 *
 * 顺带一提：`Subscript` / `Superscript` / `Emoji` 也一直在 `base` 里。
 * 它们**没有对应的设置开关**（下标/上标那个开关是许愿，见 features.ts），
 * 而且项目里也没有任何渲染器消费这两个节点——所以保持原样，不动。
 */
function buildParser(features: MarkdownFeatures): MarkdownParser {
  // 先摘掉要关掉的（解析器名 = 扩展里 `parseBlock` / `parseInline` 的 `name`）。
  const remove: string[] = [];
  if (!features.tables) remove.push("Table");
  if (!features.taskLists) remove.push("TaskList");

  // 再把「自己加的」那份挂上去——`Highlight` 不在 `base` 里，是 Inkstone 自己的扩展。
  const config: MarkdownConfig = { remove };
  if (features.highlight) {
    config.defineNodes = Highlight.defineNodes;
    config.parseInline = Highlight.parseInline;
  }
  return base.configure(config);
}

/**
 * 解析器缓存。
 *
 * 键是开关组合（`featuresKey`）——所以最多 2³ = 8 种（表格 / 任务列表 / 高亮），
 * 不会因为用户狂点设置而无限增长。
 */
const parserCache = new Map<string, MarkdownParser>();

/** 按开关取解析器（带缓存） */
export function getMarkdownParser(features: MarkdownFeatures): MarkdownParser {
  const key = featuresKey(features);
  let parser = parserCache.get(key);
  if (!parser) {
    parser = buildParser(features);
    parserCache.set(key, parser);
  }
  return parser;
}

/**
 * 编辑器使用的 Markdown 语言（含 GFM + `==高亮==`）。
 *
 * 复用 CM6 自己的 `data` facet（里面是 markdown 语言的全部数据/指令），
 * 只把 parser 换成配了扩展的那个。
 *
 * `configure` 接受数组（`MarkdownExtension = MarkdownConfig | readonly MarkdownExtension[]`），
 * 所以 GFM 的四项之外再挂一个 `Highlight` 就行。
 */
export const gfmMarkdownLanguage: Language = new Language(
  markdownLanguage.data,
  buildParser(DEFAULT_FEATURES),
);

/** 与 `gfmMarkdownLanguage` 配套的 parser，供需要裸 tree 的地方使用 */
export const gfmMarkdownParser = gfmMarkdownLanguage.parser;

/**
 * 按开关取一份完整的 Language（带缓存）。
 *
 * 换 Language 意味着换 parser——CM6 的 `language` facet 也要跟着换
 * （用 Compartment），否则源码模式的语法高亮与 Live Preview 会分叉。
 */
const languageCache = new Map<string, Language>();

export function getMarkdownLanguage(features: MarkdownFeatures): Language {
  const key = featuresKey(features);
  let language = languageCache.get(key);
  if (!language) {
    language = new Language(markdownLanguage.data, getMarkdownParser(features));
    languageCache.set(key, language);
  }
  return language;
}

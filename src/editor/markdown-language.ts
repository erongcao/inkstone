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
import { GFM, type MarkdownConfig, type MarkdownParser } from "@lezer/markdown";
import { tags as t } from "@lezer/highlight";

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
  base.configure([...GFM, Highlight]),
);

/** 与 `gfmMarkdownLanguage` 配套的 parser，供需要裸 tree 的地方使用 */
export const gfmMarkdownParser = gfmMarkdownLanguage.parser;

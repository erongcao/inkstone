/**
 * 下标 `~…~` 与上标 `^…^`（Pandoc 风格）。
 *
 * ## 为什么语义层这一半要自己写
 *
 * remark 生态里**没有**能用的现成扩展——查过的三个都不行：
 *
 * - `remark-sub@1.0.1`：正则写的是 `_` 而不是 `~`（名字与实现对不上），
 *   而且把命中的 text 节点整个改成 `html` 节点。往返（mdast → Markdown）
 *   必然丢原文。MIT，但不能用。
 * - `remark-supersub@1.0.0`：`split(/\^/)` 文本扫描，不判空白也不判成对闭合，
 *   规则跟 lezer 侧对不上（例如 `^a b^` 会被它当成上标）。
 * - `remark-sub-super@1.0.21`：remark 9 时代的老 API
 *   （`this.Parser.prototype.inlineTokenizers`），remark 11 早没了。
 *
 * 而 lezer 侧**有**现成的（`@lezer/markdown` 自带 `Subscript` / `Superscript`），
 * 只开一半会破「解析规则唯一」那条红线（见 `features.ts` 的说明）。
 * 所以这一半只能自己写。
 *
 * ## 规则：逐条对齐 lezer 的 `parseSubSuper`
 *
 * lezer 的判定在 `node_modules/@lezer/markdown/dist/index.js`：
 *
 * ```js
 * function parseSubSuper(ch, node, mark) {
 *   return (cx, next, pos) => {
 *     if (next != ch || cx.char(pos + 1) == ch) return -1;        // ①
 *     let elts = [cx.elt(mark, pos, pos + 1)];
 *     for (let i = pos + 1; i < cx.end; i++) {
 *       let next = cx.char(i);
 *       if (next == ch) return cx.addElement(...);                 // ②
 *       if (next == 92) elts.push(cx.elt("Escape", i, i++ + 2));   // ③
 *       if (space(next)) break;                                     // ④
 *     }
 *     return -1;
 *   };
 * }
 * ```
 *
 * 翻译成四条规则（本文件的 tokenizer 逐条实现）：
 *
 * | # | 规则 | 例子 |
 * |---|---|---|
 * | ① | 开标记后紧跟同一个标记 → 不认（那是删除线 `~~`） | `~~x~~` 是删除线 |
 * | ② | 必须有闭合标记，且在同一行内 | `~x` 不是下标 |
 * | ③ | `\` 后的字符被转义，不当作闭合标记 | `~\~x~` 的内容是 `~x` |
 * | ④ | 内容里不能有空白 | `~a b~` 不是下标 |
 *
 * 架构约束 C 要求「编辑器认的」与「导出认的」是同一套规则，
 * 所以这张表是两层共同的规格：改一处必须改另一处。
 * 断言在 `tests/subsup.test.ts`（对拍）与 `tests/parser-agreement.test.ts`。
 *
 * ## 内容不做嵌套解析
 *
 * lezer 的 `parseSubSuper` 是**字符级**的：内容原样进节点，不解析 emphasis。
 * 所以 `~a*b*c~` 在 lezer 眼里是一个 Subscript，内容 `a*b*c`。
 *
 * 本文件的 tokenizer 同样按字符消费，**不**走 micromark 的行内解析——
 * 否则两层对同一段文字会给出不同的树。
 * 也不挂 `insideSpan`（那是「自定义 construct 的内容区要再解析一遍」的机制，
 * 挂上会允许嵌套下标，与 lezer 不一致）。
 *
 * ## 一个副作用：`~` 与 `^` 会被转义
 *
 * `subSupToMarkdown` 把 `~` / `^` 标成了 `unsafe`（在 subscript / superscript
 * 构造内），所以内容里的 `~` 序列化成 `\~`。
 * 这跟 `mdast-util-highlight-mark` 把 `=` 标成 unsafe 是同一回事，
 * 也正是往返能对上的原因：`~\~x~` → mdast（内容 `~x`）→ `~\~x~`。
 */

import { markdownLineEnding } from "micromark-util-character";
import { codes } from "micromark-util-symbol";
import type {
  Code,
  Construct,
  Effects,
  Extension,
  State,
  Token,
  TokenizeContext,
} from "micromark-util-types";
import type {
  CompileContext,
  Extension as FromMarkdownExtension,
} from "mdast-util-from-markdown";
import type { Handle, Options as ToMarkdownOptions } from "mdast-util-to-markdown";
import type { Options } from "remark-rehype";
import type { Plugin } from "unified";
import type { Root } from "mdast";
import { mount, type ExtensionMounts } from "./extensions";

/** 两类标记 */
export type SubSupKind = "subscript" | "superscript";

/** 标记本身的 token 类型 */
type MarkType = "subscriptMark" | "superscriptMark";

/** 一类标记的全部参数 */
interface KindSpec {
  /** mdast 节点类型（同时也是 micromark 的容器 token 类型） */
  kind: SubSupKind;
  /** 标记字符 */
  marker: string;
  /** 标记字符的码点 */
  code: number;
  /** 标记本身的 token 类型（micromark 侧；mdast 侧不产出节点） */
  markType: MarkType;
}

/** 两类标记的参数表 */
const KINDS: Record<SubSupKind, KindSpec> = {
  subscript: {
    kind: "subscript",
    marker: "~",
    code: codes.tilde,
    markType: "subscriptMark",
  },
  superscript: {
    kind: "superscript",
    marker: "^",
    code: codes.caret,
    markType: "superscriptMark",
  },
};

/**
 * 空白判定——与 lezer 的 `space()` 逐字一致。
 *
 * lezer 的 `space(code)` 是 `code === 32 || code === 9`，
 * **不含**换行（行内解析本来就是逐行的，换行会结束这一行）。
 */
function isSpace(code: Code): boolean {
  return code === 32 || code === 9;
}

/**
 * 造一类标记的 micromark construct。
 *
 * 返回的对象里 `tokenize` 是闭包——它需要知道自己属于哪一类标记
 * （`~` 还是 `^`），所以两类各造一个，而不是共用一个再靠 `this` 猜。
 */
function createConstruct(spec: KindSpec): Construct {
  return {
    name: spec.kind,
    /**
     * 排在 GFM 删除线**之后**。
     *
     * micromark 合并扩展时，后挂的 construct 默认插到**前面**
     * （见 `micromark-util-combine-extensions` 的 `constructs()`），
     * `add: "after"` 才能追加到末尾。
     *
     * lezer 侧 `Strikethrough` 也是先注册的，所以这里跟它对齐。
     * 顺序其实不影响结果——两边的规则互斥（规则 ① 把 `~~` 挡在外面了），
     * 但保持一致省得以后有人来推演。
     */
    add: "after",
    tokenize: function tokenize(
      this: TokenizeContext,
      effects: Effects,
      ok: State,
      nok: State,
    ): State {
      return start;

      /** 开标记 */
      function start(code: Code): State | undefined {
        effects.enter(spec.kind);
        effects.enter(spec.markType);
        effects.consume(code);
        effects.exit(spec.markType);
        // 「开标记之后的第一个字符」要单独一个状态：
        // 它既要判规则 ①（不能是同一个标记），又不能当成闭合标记。
        return first;
      }

      /** 开标记之后的第一个字符 */
      function first(code: Code): State | undefined {
        // 规则 ①：开标记后紧跟同一个标记 → 不是下标/上标（那是删除线 `~~`）。
        if (code === spec.code) return nok(code);
        return between(code);
      }

      /** 标记之后、内容之前 */
      function between(code: Code): State | undefined {
        // 规则 ②：没有闭合标记（到行尾 / 文件尾了）→ 失败。
        if (code === null) return nok(code);

        // 闭合标记。
        if (code === spec.code) {
          effects.enter(spec.markType);
          effects.consume(code);
          effects.exit(spec.markType);
          effects.exit(spec.kind);
          return ok(code);
        }

        // 规则 ③：转义。`\` 后的字符被吃掉，不当作闭合标记。
        //
        // 这里自己处理转义（而不是交给 micromark 的 `characterEscape`），
        // 因为那是个**独立的 construct**：一旦交给它，
        // 我的 tokenizer 就得结束，「内容」也就断了。
        //
        // 产出的 token 名跟 micromark 官方的一致（`characterEscape` /
        // `escapeMarker` / `characterEscapeValue`），
        // 所以 mdast 侧不用写任何自定义 handler——
        // 反斜杠在往返时会被正确地还原成 `\`。
        if (code === codes.backslash) {
          effects.enter("characterEscape");
          effects.enter("escapeMarker");
          effects.consume(code);
          effects.exit("escapeMarker");
          return escapeValue;
        }

        // 规则 ④：内容里不能有空白。
        if (isSpace(code)) return nok(code);

        // 行尾也不能有——闭合标记必须在同一行内（规则 ②）。
        if (markdownLineEnding(code)) return nok(code);

        // 普通内容。用 micromark 标准的 `data` token，
        // mdast 侧就会得到一个 text 节点（`mdast-util-from-markdown` 的默认处理）。
        effects.enter("data");
        effects.consume(code);
        return data;
      }

      /** 内容之中 */
      function data(code: Code): State | undefined {
        if (
          code === null ||
          code === spec.code ||
          code === codes.backslash ||
          isSpace(code) ||
          markdownLineEnding(code)
        ) {
          effects.exit("data");
          return between(code);
        }
        effects.consume(code);
        return data;
      }

      /** 转义字符的值 */
      function escapeValue(code: Code): State | undefined {
        // 转义不能跨行（`\` + 换行是硬换行，不是转义）。
        if (code === null || markdownLineEnding(code)) return nok(code);
        effects.enter("characterEscapeValue");
        effects.consume(code);
        effects.exit("characterEscapeValue");
        effects.exit("characterEscape");
        return between;
      }
    },
  };
}

/**
 * micromark 扩展：让分词器认 `~…~` 与 `^…^`。
 *
 * 挂在 `text` 的码点表上——与 GFM 删除线（也挂 `~`）同一个位置，
 * 由 micromark 按顺序尝试。规则互斥，不会抢。
 */
export const subSup: Extension = {
  text: {
    [codes.tilde]: createConstruct(KINDS.subscript),
    [codes.caret]: createConstruct(KINDS.superscript),
  },
};

/* ═══════════════════════════════════════════════════════════ */

/**
 * mdast 侧的 enter handler：开一个容器节点。
 *
 * `token.type` 的类型是 `keyof TokenTypeMap`（micromark 的 token 名），
 * 比 mdast 的节点类型宽——这里收窄成 `SubSupKind`。
 * 收窄是安全的：handler 只挂在 `subscript` / `superscript` 两个 token 上。
 */
function enterNode(this: CompileContext, token: Token): void {
  this.enter({ type: token.type as SubSupKind, children: [] }, token);
}

/** mdast 侧的 exit handler：关掉容器节点 */
function exitNode(this: CompileContext, token: Token): void {
  this.exit(token);
}

/**
 * mdast 解析扩展：token → mdast 节点。
 *
 * 只处理**容器**（`subscript` / `superscript`）的开关；
 * 里面的内容由 micromark 标准的 `data` / `characterEscapeValue` token 负责，
 * `mdast-util-from-markdown` 的默认处理会把它们变成 text 节点。
 *
 * 标记本身（`subscriptMark` / `superscriptMark`）在 mdast 侧**不产出节点**——
 * 它是源码里的标记，不是语义（对比 `highlight` 的做法：
 * `mdast-util-highlight-mark` 也不产出 `HighlightMark` 节点）。
 */
export const subSupFromMarkdown: FromMarkdownExtension = {
  enter: {
    subscript: enterNode,
    superscript: enterNode,
  },
  exit: {
    subscript: exitNode,
    superscript: exitNode,
  },
};

/* ═══════════════════════════════════════════════════════════ */

/**
 * 序列化 handler：mdast 节点 → Markdown 源码。
 *
 * 跟 `mdast-util-highlight-mark` 的 `handleMark` 同一个写法：
 * `tracker.move` 负责「该转义的字符要转义」，
 * `containerPhrasing` 负责把子节点的内容写出来。
 */
function handleSubSup(marker: string, kind: SubSupKind): Handle {
  return (node, _parent, state, info) => {
    const tracker = state.createTracker(info);
    const exit = state.enter(kind);
    let value = tracker.move(marker);
    value += tracker.move(
      state.containerPhrasing(node, {
        before: value,
        after: marker,
        ...tracker.current(),
      }),
    );
    value += tracker.move(marker);
    exit();
    return value;
  };
}

/**
 * mdast 序列化扩展：mdast 节点 → Markdown 源码。
 *
 * `unsafe` 那两条是**往返能对上的关键**：
 * 内容里的 `~`（或 `^`）必须转义，否则 `~a~b~` 序列化回去会被解析成
 * 「下标 a」+「文本 b~」，结构就不等价了。
 */
export const subSupToMarkdown: ToMarkdownOptions = {
  unsafe: [
    { character: "~", inConstruct: "subscript" },
    { character: "^", inConstruct: "superscript" },
  ],
  handlers: {
    subscript: handleSubSup("~", "subscript"),
    superscript: handleSubSup("^", "superscript"),
  },
};

/* ═══════════════════════════════════════════════════════════ */

/**
 * remark 插件：让解析与序列化都认 `~…~` 与 `^…^`。
 *
 * 三样东西分别挂在三个不同的挂载点上：
 *   - micromarkExtensions：分词器，决定「哪里是标记」
 *   - fromMarkdownExtensions：token → mdast 节点
 *   - toMarkdownExtensions：mdast 节点 → Markdown 源码（round-trip 用）
 */
export const remarkSubSup: Plugin<[], Root> = function remarkSubSup() {
  const data = this.data() as unknown as ExtensionMounts;
  mount(data, "micromarkExtensions", subSup);
  mount(data, "fromMarkdownExtensions", subSupFromMarkdown);
  mount(data, "toMarkdownExtensions", subSupToMarkdown);
};

/**
 * `subscript` / `superscript` mdast 节点 → hast 的 `<sub>` / `<sup>`。
 *
 * 挂在 `remark-rehype` 的 `handlers` 选项上——
 * 那是 `mdast-util-to-hast` 唯一开放的扩展入口
 * （跟 `highlightHastHandlers` 同一个道理）。
 */
export const subSupHastHandlers: NonNullable<Options["handlers"]> = {
  subscript(state, node) {
    return {
      type: "element",
      tagName: "sub",
      properties: {},
      children: state.all(node),
    };
  },
  superscript(state, node) {
    return {
      type: "element",
      tagName: "sup",
      properties: {},
      children: state.all(node),
    };
  },
};

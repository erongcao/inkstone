/**
 * Live Preview 装饰器生成。
 *
 * 核心规则（Typora 式）：
 *   - 光标不在某个结构内 → 该结构的 Markdown 标记被「零宽 widget」替换掉，
 *     屏幕上看起来就是渲染后的样子
 *   - 光标进入该结构 → 移除替换装饰，标记原文重新可见、可直接编辑
 *
 * 为什么用 Decoration.replace 而不是 CSS 隐藏？
 *   `Decoration.replace` 把标记区间换成 widget，视觉上消失但**文档坐标不变**，
 *   所以光标仍然可以落在标记区间内（我们据此判断"光标进来了"）。
 *   而纯 CSS 隐藏（font-size:0 / display:none）会让光标永远无法进入标记，
 *   就做不到 Typora 那种「直接编辑 `**`」的体验。
 */

import { Decoration, WidgetType, type DecorationSet } from "@codemirror/view";
import type { Range } from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";
import { INLINE_MARKERS, BLOCK_MARKERS, HEADING_CLASSES } from "./syntax";
import { BlockWidget } from "./block-widget";
import { InlineHtmlWidget } from "./inline-widget";
import { TaskCheckboxWidget } from "./task-widget";
import { blockRenderers } from "../render/registry";
import { findInlineMath, renderInlineMath } from "../render/inline-math";
import { findTaskItems } from "../render/task-list";
import { findSizedImages, stripImageSize } from "../render/image-size";
import { overlapsAny } from "../render/scan";
import { findFootnotes, type FootnoteModel } from "../render/footnote";
import { FootnoteRefWidget, FootnoteDefWidget } from "./footnote-widget";
import { ImageWidget, renderImage } from "./image-widget";
import type { BlockMatch, BlockRenderer } from "../render/types";
import type { MarkerDisplayMode } from "@/settings/schema";

/**
 * 行内标记类型 → 规格 的查找表。
 *
 * 遍历语法树时每个节点都要查一次，用 Map 而不是 `Array.find`：
 * 4000 行文档有 7000+ 节点，线性查找会白白多出几万次字符串比较。
 */
const INLINE_MARKER_BY_TYPE = new Map(
  INLINE_MARKERS.map((spec) => [spec.nodeType, spec] as const),
);

/**
 * 零宽占位 widget：把被隐藏的标记区间替换成它。
 *
 * 视觉上完全不可见且不占宽度，但**文档坐标不变**——
 * 所以光标依然可以落在被隐藏的标记区间内，我们据此判断「光标进入该结构」。
 */
class HiddenMarkerWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-md-hidden";
    // 禁止在该 widget 上放置光标，交给外层逻辑处理
    span.contentEditable = "false";
    return span;
  }

  eq(other: HiddenMarkerWidget): boolean {
    return other instanceof HiddenMarkerWidget;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/** 创建「隐藏标记」的替换装饰 */
function hiddenMarker(): Decoration {
  return Decoration.replace({ widget: new HiddenMarkerWidget() });
}

/** 一个纯区间（不含装饰器信息） */
type Interval = {
  from: number;
  to: number;
};

/** 一个可隐藏结构 */
interface Hideable {
  /** 承载标记的节点 */
  node: SyntaxNode;
  /** 需要隐藏的标记区间 */
  hideRanges: Interval[];
  /** 需要加样式的内容区间 */
  styleRanges: Interval[];
  /** 内容样式 class */
  styleClass?: string;
  /**
   * 挂在内容区间上的 HTML 属性。
   *
   * 存在是为了让 hover 提示能**纯 CSS** 完成：`content: attr(data-href)`。
   * 走 CSS 而不是 JS 浮层，是因为它没有任何状态要同步——
   * 鼠标一移开浏览器自己撤掉，不用重算装饰器、不用管文档变没变。
   */
  styleAttrs?: Record<string, string>;
}

/**
 * 判断光标是否落在某个区间内（含边界，用于块级标记）
 */
function cursorInRange(from: number, to: number, cursor: number): boolean {
  return cursor >= from && cursor <= to;
}

/**
 * 判断某个结构当前是否应该「展开」（标记可见、可直接编辑）。
 *
 * 规则是 **左开右闭**：`node.from < cursor <= node.to`
 *
 * 为什么不是简单的「光标在节点内」：
 *   - 光标落在正文内容里 → 展开，这是 Typora 的核心手感
 *   - 光标紧跟在结束标记之后 → 展开。因为浏览器/Typora 会把这种光标
 *     放在元素内部（相当于「刚打完粗体」），此时应该继续展示原始标记
 *   - 光标紧贴在开始标记之前 → 不展开，因为光标此时在结构之外
 *   这个不对称是刻意的，和 Typora 的 DOM 行为一致。
 */
function shouldReveal(node: SyntaxNode, cursor: number): boolean {
  return cursor > node.from && cursor <= node.to;
}

/** 收集节点内的直接子节点（按类型） */
function childrenOfType(node: SyntaxNode, typeName: string): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  const cursor = node.cursor();
  if (cursor.firstChild()) {
    do {
      const child = cursor.node;
      if (child.type.name === typeName) result.push(child);
    } while (cursor.nextSibling());
  }
  return result;
}

/** 计算某个结构应该隐藏哪些区间、给哪些区间加样式 */
function analyze(
  node: SyntaxNode,
  spec: (typeof INLINE_MARKERS)[number],
  source: string,
): Hideable | null {
  const nodeName = node.type.name;

  if (nodeName === "Link") {
    // [文字](网址 "标题") → 只显示「文字」
    const marks = childrenOfType(node, "LinkMark");
    const urls = childrenOfType(node, "URL");
    const titles = childrenOfType(node, "LinkTitle");
    if (marks.length < 2) return null;
    const open = marks[0];
    const close = marks[1];

    // 网址藏在 `](…)` 里，标记隐藏后用户**看不到链接到底指向哪**。
    // 挂成 `data-href` 就能用纯 CSS 在 hover 时补一个提示（见 Hideable.styleAttrs）。
    // 引用式 `[文字][ref]` 没有 URL 节点，解析要查引用表——先不处理，
    // 没有提示和现在的行为一致，不算退化。
    const href = urls.length > 0 ? source.slice(urls[0].from, urls[0].to) : "";

    return {
      node,
      hideRanges: [...marks, ...urls, ...titles].map((n) => ({ from: n.from, to: n.to })),
      styleRanges: [{ from: open.to, to: close.from }],
      styleClass: "cm-md-link",
      styleAttrs: href ? { "data-href": href } : undefined,
    };
  }

  // StrongEmphasis / Emphasis / InlineCode / Strikethrough
  const marks = childrenOfType(node, spec.markType);
  if (marks.length === 0) return null;

  const first = marks[0];
  const last = marks[marks.length - 1];
  return {
    node,
    hideRanges: marks.map((n) => ({ from: n.from, to: n.to })),
    styleRanges: [{ from: first.to, to: last.from }],
    styleClass: spec.contentClass,
  };
}

/**
 * 生成 Live Preview 装饰器集合。
 *
 * 这是一个**纯函数**——不依赖 EditorState，只吃几个显式参数。
 * 原因是 CM6 的 `EditorView.decorations.from(field, get)` 的 get 拿不到 state，
 * 而块级装饰器必须走 facet（见 `state.ts` 的说明）。
 *
 * @param source 文档全文
 * @param cursor 主选区光标位置
 * @param mode   标记符显示策略：
 *   - `live`   标记隐藏（零宽 widget 顶替），光标进入该结构才显露
 *   - `dimmed` 标记始终可见，但弱化着色（Ulysses 式）
 * @param tree   增量维护的语法树
 * @param math   行内公式选项（是否把单个 `$` 当定界符）
 */
export function buildLivePreviewDecorations(
  source: string,
  cursor: number,
  mode: MarkerDisplayMode = "live",
  tree: Tree,
  math: { singleDollarTextMath?: boolean } = {},
): DecorationSet {
  const syntaxTree = tree;

  // 注意：`Decoration.mark(...).range(a, b)` 返回的是 `Range<Decoration>`（带 from/to 的区间），
  // 不是 `Decoration` 本身；`DecorationSet.create` 需要的正是这种区间数组。
  // 装饰器分三个桶收集，最后按「行内 → 块级 → 标题」的顺序合并——
  // 这个顺序与重构前「三次独立遍历」的推送顺序完全一致，
  // 因此重叠样式的叠放结果不变（`Decoration.set` 内部会按位置排序）。
  const inlineDecos: Range<Decoration>[] = [];
  const blockDecos: Range<Decoration>[] = [];
  const headingDecos: Range<Decoration>[] = [];
  const renderedDecos: Range<Decoration>[] = [];
  const footnoteDecos: Range<Decoration>[] = [];
  const imageDecos: Range<Decoration>[] = [];

  // 任务项要**先**算出来：后面的装饰循环要用它来藏列表符号、换勾选框
  const taskItems = findTaskItems(syntaxTree, source);

  // 脚注也要**先**算出来：lezer 会把 `[^1]和另一个[^note]` 合成**一个**
  // `Link` 节点（实测生产 DOM：`cm-md-link` 覆盖了 `^1]和另一个[^note`，
  // 两端的方括号被当链接括号藏掉），而脚注引用要自己接管这几个字符。
  // 所以行内标记那一轮必须先知道脚注引用的区间，才能让开。
  const footnotes = findFootnotes(syntaxTree, source);

  // 链接引用表**惰性**建：绝大多数文档一个 `![alt][ref]` 都没有，
  // 而收集定义要整棵语法树走一遍（1000 行约 0.16ms）——每击键都付这个钱不值。
  // 所以先放个闭包，等到真的撞上引用式图片再付。
  let linkRefTable: Map<string, string> | null = null;
  const getLinkRefTable = (): Map<string, string> => {
    if (linkRefTable === null) linkRefTable = collectLinkReferences(syntaxTree, source);
    return linkRefTable;
  };
  // 只有**会被渲染**的引用（编号 > 0）才需要让路；
  // 没有定义的 `[^missing]` 是字面量，保持原有行为不动
  const footnoteRefRanges = footnotes.refs
    .filter((ref) => ref.number > 0)
    .map((ref) => ({ from: ref.from, to: ref.to }));

  // 一次遍历收集全部三类装饰。
  // 重构前这里是三次独立的 `tree.iterate()`（实测 4000 行文档 0.78ms），
  // 合并成一次后遍历成本降到约三分之一。
  syntaxTree.iterate({
    enter(ref) {
      // `iterate` 回调拿到的是 SyntaxNodeRef（轻量引用），要拿完整节点用 `ref.node`
      const name = ref.type.name;

      // ---- 0. 图片：整块渲染成 <img>，不走标记隐藏那一套 ----
      if (name === "Image") {
        imageDecos.push(
          ...buildImageDecorations(ref.node, source, cursor, mode, getLinkRefTable),
        );
        return false;
      }

      // ---- 0b. lezer 认不出的带尺寸图片：`![a](x.png =200x100) ----
      // URL 不能含空格，所以带空格的尺寸写法 lezer 压根不产出 Image 节点
      // （整块退化成纯文本）。这里在**段落**上补一次窄范围扫描，
      // 理由与代价见 `image-size.ts` 的文件头。
      if (name === "Paragraph") {
        imageDecos.push(...buildSizedImageDecorations(ref.node, source, cursor, mode));
      }

      // ---- 1. 行内标记（可隐藏 / 可弱化）----
      const spec = INLINE_MARKER_BY_TYPE.get(name);
      if (spec) {
        // 这个 Link 里含有脚注引用 → 整个节点交给脚注渲染器，别插手
        if (
          name === "Link" &&
          overlapsAny({ from: ref.from, to: ref.to }, footnoteRefRanges)
        ) {
          return false;
        }
        const analyzed = analyze(ref.node, spec, source);
        if (!analyzed) return;

        const active = shouldReveal(analyzed.node, cursor);

        for (const range of analyzed.styleRanges) {
          if (range.to > range.from && analyzed.styleClass) {
            inlineDecos.push(
              Decoration.mark({
                class: analyzed.styleClass,
                attributes: analyzed.styleAttrs,
              }).range(range.from, range.to),
            );
          }
        }

        if (mode === "dimmed") {
          // Ulysses 式：标记不隐藏，只弱化着色；内容照样渲染
          for (const range of analyzed.hideRanges) {
            if (range.to > range.from) {
              inlineDecos.push(
                Decoration.mark({ class: "cm-md-marker" }).range(range.from, range.to),
              );
            }
          }
        } else if (!active) {
          // 光标不在该结构内 → 标记被零宽 widget 顶替（隐藏）
          for (const range of analyzed.hideRanges) {
            if (range.to > range.from) {
              inlineDecos.push(hiddenMarker().range(range.from, range.to));
            }
          }
        }
        return;
      }

      // ---- 2. 块级标记：标题的 #、列表符号、引用符号 → 弱化显示 ----
      // 光标进入所在块（标题 / 列表项 / 引用）时，标记恢复醒目
      const blockClass = BLOCK_MARKERS[name];
      if (blockClass) {
        const parent = ref.node.parent;
        const active = parent
          ? cursorInRange(parent.from, parent.to, cursor)
          : cursorInRange(ref.from, ref.to, cursor);
        blockDecos.push(
          Decoration.mark({
            class: active ? `${blockClass} cm-md-block-mark--active` : blockClass,
          }).range(ref.from, ref.to),
        );
        return;
      }

      // ---- 3. 标题正文：按层级套用字号/字重，让 Live Preview 真的有「渲染感」----
      const headingClass = HEADING_CLASSES[name];
      if (headingClass) {
        const headerMark = childrenOfType(ref.node, "HeaderMark")[0];
        const from = headerMark ? headerMark.to : ref.from;
        if (ref.to <= from) return;
        headingDecos.push(Decoration.mark({ class: headingClass }).range(from, ref.to));
      }
    },
  });

  // ── 块级渲染（代码块 / 公式块 / 表格 / 图表）──
  // 光标在块内 → 显示源码（可编辑）；光标在块外 → 显示渲染结果。
  const blockMatches = collectBlockMatches(syntaxTree, source);
  for (const { match, renderer } of blockMatches) {
    if (isBlockExpanded(match, cursor, source)) continue;
    const result = renderer.render(match, source);
    if (!result) continue;
    renderedDecos.push(
      Decoration.replace({
        widget: new BlockWidget(result, match.from),
        block: true,
      }).range(match.from, match.to),
    );
  }

  // ── 任务列表：`- [ ]` / `- [x]` ──
  // 勾选状态是**写回源码的状态**而不是纯装饰（见 live-preview/index.ts 的点击处理）。
  // 光标停在任务项里时露出原始 `[ ]`，方便直接编辑标记本身。
  for (const item of taskItems) {
    const active = cursor > item.from && cursor < item.to;
    if (mode === "dimmed") {
      if (!active) {
        inlineDecos.push(
          Decoration.mark({ class: "cm-md-task-marker" }).range(item.from, item.to),
        );
      }
      continue;
    }
    if (!active) {
      inlineDecos.push(
        Decoration.replace({
          widget: new TaskCheckboxWidget(item),
        }).range(item.from, item.to),
      );
    }
    // 列表符号藏掉：Typora 的任务项只显示勾选框，不显示项目符号
    if (item.listMarkTo > item.listMarkFrom && !active) {
      inlineDecos.push(hiddenMarker().range(item.listMarkFrom, item.listMarkTo));
    }
  }

  // ── 行内公式 `$x^2$` / `$$x^2$$` ──
  // 必须排在块级之后：行首的 `$$x^2$$` 会被块级渲染器认走，
  // 行内定位要把这些区间让开，否则同一段文本会被替换两次。
  const blockRanges = blockMatches.map(({ match }) => ({
    from: match.from,
    to: match.to,
  }));
  for (const hit of findInlineMath(syntaxTree, source, {
    singleDollarTextMath: math.singleDollarTextMath,
    blockRanges,
  })) {
    // 与块级同一套展开规则：光标落在公式内 → 露出 `$…$` 源码
    if (cursor > hit.from && cursor < hit.to) continue;
    const html = renderInlineMath(hit.tex);
    if (html === null) continue; // KaTeX 还没就绪，保持源码
    inlineDecos.push(
      Decoration.replace({
        widget: new InlineHtmlWidget(
          html,
          `math:${hit.tex}`,
          hit.from,
          "cm-md-inline-math",
        ),
      }).range(hit.from, hit.to),
    );
  }

  // ── 脚注 `[^1]` / `[^1]: 定义` ──
  // 放在最后：脚注扫描要读整篇源码，块级渲染器占用的区间已经被 `blockRanges`
  // 登记过，脚注不会再往已被替换的区间里插东西。
  footnoteDecos.push(...buildFootnoteDecorations(footnotes, cursor));

  // `DecorationSet` 只是类型别名（= RangeSet<Decoration>），
  // 真正的构造入口是静态方法 `Decoration.set(ranges, sort)`。
  return Decoration.set(
    [
      ...inlineDecos,
      ...blockDecos,
      ...headingDecos,
      ...renderedDecos,
      ...footnoteDecos,
      ...imageDecos,
    ],
    true,
  );
}

/**
 * 生成脚注装饰。
 *
 * 两条规则：
 *   - 引用 `[^1]` → 换成上标数字，点它跳到定义
 *   - 定义 `[^1]:` → 换成 `1.` 编号，整块套一层样式；点编号跳回第一个引用
 *
 * 「光标进入就露出源码」沿用同一套展开判定（严格开区间），
 * 所以脚注标记可以直接编辑——改标签、改编号，改完立刻重算。
 *
 * 编号为 0 的（没有定义的引用 / 没有被引用的定义）**不生成任何装饰**：
 * 它们在语义上就是普通文本，硬渲染反而会撒谎。
 */
function buildFootnoteDecorations(
  model: FootnoteModel,
  cursor: number,
): Range<Decoration>[] {
  const { refs, defs } = model;
  const decos: Range<Decoration>[] = [];

  for (const ref of refs) {
    if (ref.number === 0) continue;
    if (cursor > ref.from && cursor < ref.to) continue;
    decos.push(
      Decoration.replace({
        widget: new FootnoteRefWidget(ref.number, ref.targetFrom, ref.from),
      }).range(ref.from, ref.to),
    );
  }

  for (const def of defs) {
    if (def.number === 0) continue;
    // 整块样式：缩进 + 分隔，让定义在正文里能一眼认出
    decos.push(Decoration.mark({ class: "cm-md-footnote-def" }).range(def.from, def.to));
    // 光标在定义块内 → 露出 `[^1]:` 原文
    if (cursor > def.from && cursor < def.markerTo) continue;
    decos.push(
      Decoration.replace({
        widget: new FootnoteDefWidget(def.number, def.firstRefFrom),
      }).range(def.markerFrom, def.markerTo),
    );
  }

  return decos;
}

/** 一张图片在源码里的构成 */
interface ImageParts {
  /** `![alt](src "title")` 整体区间 */
  from: number;
  to: number;
  /** 替代文本 */
  alt: string;
  /** 图片地址；引用式（`![alt][ref]`）解析不出来时为 null */
  src: string | null;
  /** 显式尺寸（Typora / Obsidian 扩展），单位 px */
  width?: number;
  height?: number;
}

/**
 * 拆解图片节点。
 *
 * lezer 的形态（`dump-lezer-tree.ts` 实测）：
 * ```
 * Image[0,21]
 *   LinkMark[0,2]  "!["
 *   LinkMark[6,7]  "]"      ← 替代文本 = 两者之间
 *   LinkMark[7,8]  "("
 *   URL[8,15]      "a/b.png"
 *   LinkTitle      "标题"
 *   LinkMark[20,21] ")"
 * ```
 * 引用式 `![alt][ref]` 里没有 `URL`，多一个 `LinkLabel`。
 */
function imageParts(
  node: SyntaxNode,
  source: string,
  getLinkRefTable: () => Map<string, string>,
): ImageParts | null {
  const marks = childrenOfType(node, "LinkMark");
  const open = marks[0];
  if (!open || open.to - open.from !== 2) return null; // 必须是 "!["
  const closeBracket = marks[1];
  if (!closeBracket) return null;

  const alt = source.slice(open.to, closeBracket.from);
  const url = childrenOfType(node, "URL")[0];

  let src: string | null = url ? source.slice(url.from, url.to) : null;
  // `![a](<路径 带空格.png>)` 的 URL 区间**含尖括号**（lezer 原样切），
  // 不剥掉的话 Rust 会去找一个名字带 `<` `>` 的文件。
  if (src !== null && src.startsWith("<") && src.endsWith(">")) {
    src = src.slice(1, -1);
  }

  // `图片.png=200x100` 这种**无空格**写法 lezer 认得，尺寸就在 URL 节点里，
  // 这里剥掉尾巴否则会被当成文件名的一部分。带空格的那种 lezer 认不出，
  // 走 `findSizedImages` 的行扫描兜底（见 image-size.ts 的取舍说明）。
  let width: number | undefined;
  let height: number | undefined;
  if (src !== null) {
    const stripped = stripImageSize(src);
    src = stripped.src;
    width = stripped.width;
    height = stripped.height;
  }
  if (src === null) {
    // 引用式：`![alt][ref]` → 找文档里的 `[ref]: 地址`
    const label = childrenOfType(node, "LinkLabel")[0];
    if (!label) return null;
    const key = normalizeRefLabel(source.slice(label.from, label.to));
    src = getLinkRefTable().get(key) ?? null;
    if (src === null) return null; // 定义不存在：保持源码可见，不瞎渲染
  }

  return { from: node.from, to: node.to, alt, src, width, height };
}

/** 链接引用标签归一：大小写不敏感、内部空白折叠 */
function normalizeRefLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * 收集文档里的链接引用定义（`[ref]: 地址`），供引用式图片查表。
 *
 * 由调用方的惰性闭包触发，见 `buildLivePreviewDecorations` 里的说明。
 */
function collectLinkReferences(tree: Tree, source: string): Map<string, string> {
  const map = new Map<string, string>();
  tree.iterate({
    enter(ref) {
      if (ref.type.name !== "LinkReference") return;
      const label = childrenOfType(ref.node, "LinkLabel")[0];
      const url = childrenOfType(ref.node, "URL")[0];
      if (!label || !url) return;
      const key = normalizeRefLabel(source.slice(label.from, label.to));
      // 第一个定义胜出（CommonMark 行为）
      if (!map.has(key)) map.set(key, source.slice(url.from, url.to));
    },
  });
  return map;
}

/**
 * 生成图片装饰。
 *
 * 与其它结构同一套展开规则：光标落进 `![…](…)` 区间 → 露出源码、可直接编辑路径；
 * 在区间外 → 换成真正的 `<img>`。
 *
 * **不能**用块级替换：图片是行内的，块级 widget 会另起一行，
 * 而 `文字 ![图](a.png) 文字` 这种写法必须保持行内。
 */
function buildImageDecorations(
  node: SyntaxNode,
  source: string,
  cursor: number,
  mode: MarkerDisplayMode,
  getLinkRefTable: () => Map<string, string>,
): Range<Decoration>[] {
  const parts = imageParts(node, source, getLinkRefTable);
  if (!parts || !parts.src) return [];

  const inside = cursor > parts.from && cursor < parts.to;
  // dimmed 策略下不做整块替换，只把地址弱化显示
  if (mode === "dimmed") {
    return [Decoration.mark({ class: "cm-md-image-alt" }).range(parts.from, parts.to)];
  }
  if (inside) return [];

  const result = renderImage(parts.src, parts.alt, parts.from, parts.width, parts.height);
  return [
    Decoration.replace({ widget: new ImageWidget(result, parts.from) }).range(
      parts.from,
      parts.to,
    ),
  ];
}

/**
 * 带尺寸图片（lezer 认不出的那类）的装饰。
 *
 * 展开规则与 `buildImageDecorations` 完全一致：光标落进区间 → 露出源码，
 * 否则替换成 `<img>`。共用 `renderImage`，所以尺寸、缓存、点击回源码
 * 全部是同一套逻辑，不会出现「普通图片有尺寸、带尺寸图片反而没有」。
 */
function buildSizedImageDecorations(
  node: SyntaxNode,
  source: string,
  cursor: number,
  mode: MarkerDisplayMode,
): Range<Decoration>[] {
  if (mode === "dimmed") return []; // 弱化模式下整段纯文本本来就可见

  const decorations: Range<Decoration>[] = [];
  for (const image of findSizedImages(source, node.from, node.to)) {
    // 严格开区间，与 `buildImageDecorations` 保持一致。
    // 写成闭区间的话，光标停在**文档末尾**时（`cursor === image.to`，
    // 即整篇文档的最后一张图）就永远不替换——文档末尾放图是最常见的排法。
    if (cursor > image.from && cursor < image.to) continue;
    const result = renderImage(image.src, "", image.from, image.width, image.height);
    decorations.push(
      Decoration.replace({ widget: new ImageWidget(result, image.from) }).range(
        image.from,
        image.to,
      ),
    );
  }
  return decorations;
}

/**
 * 收集所有渲染器匹配到的块。
 *
 * **按注册顺序**逐个调用，并把已占用区间透传给后面的渲染器——
 * 有些结构会被两个渲染器同时匹配（行首单块 `$$x$$` 与块级 `math`、
 * `$$ … | a | … $$` 里的表格语法），后面的必须让开，
 * 否则同一段文本会被替换两次。
 */
function collectBlockMatches(
  tree: Tree,
  source: string,
): { match: BlockMatch; renderer: BlockRenderer }[] {
  const result: { match: BlockMatch; renderer: BlockRenderer }[] = [];
  const claimed: Interval[] = [];
  for (const renderer of blockRenderers()) {
    for (const match of renderer.find(tree, source, claimed)) {
      result.push({ match, renderer });
      claimed.push({ from: match.from, to: match.to });
    }
  }
  return result;
}

/**
 * 判断一个块当前是否应当「展开」（显示源码、可编辑）。
 *
 * 规则是**严格开区间** `from < cursor < to`：
 *   - 光标在块内 → 展开
 *   - 光标正好落在块首 → 不展开。这样打开文件时（光标在 0）
 *     第一个代码块是收起的，与 Typora 一致
 *   - 光标正好落在块尾（= 下一行开头）→ 不展开
 *
 * 进入编辑态的路径：点击渲染后的块 → 把光标移到 `from + 1`（块内）→
 * 装饰器重算 → 该块切回源码。见 live-preview/index.ts 的 mousedown 处理。
 *
 * ## 例外：**未闭合的围栏**必须保持展开（实测踩过的严重 bug）
 *
 * 未闭合的围栏，lezer 会把它**一直算到文档末尾**。于是「刚敲完 ```` ```js ````、
 * 光标停在后面」时，`cursor === match.to === doc.length`——
 * 严格开区间判成「不在块内」，块立刻收起成一个空的渲染结果。
 * 而块 widget 是 `contenteditable="false"`，用户接着打的字**全部丢失**。
 *
 * 实测（生产构建、空文档）：敲 ` ```js ` 之后编辑器里只剩一个空的
 * `<pre class="cm-md-code" data-language="js">`，再打任何字符都无效——
 * 也就是**根本没法用键盘敲出一个代码块**。
 *
 * 补法：块的**最后一行不是闭合围栏**就说明用户还没写完，
 * 此时块尾也算块内。不看围栏字符本身，只认「末行是否整行都是围栏」。
 *
 * ## 这条豁免**只给围栏**——这是加错了会连累别人两次才记住的
 *
 * 表格、公式块、mermaid **在文末时也满足** `cursor === match.to`，
 * 而它们的末行当然不是围栏（`| 甲 | 一 |`、`$$`…）。
 * 不加 `kind` 判断的话，文末的那张表会被**永久钉在展开态**——
 * 渲染路径永远走不到，表现为「表格怎么都不渲染成表格」。
 *
 * 判据必须是 `kind`：只有围栏代码块才有「写到一半」这回事，
 * 其余块在文末就是写完了，该收起。
 */
export function isBlockExpanded(
  match: BlockMatch,
  cursor: number,
  source: string,
): boolean {
  if (cursor > match.from && cursor < match.to) return true;

  // 只有围栏代码块有「未闭合」状态，其余块到文末就算写完了
  if (
    match.kind === "code" &&
    cursor === match.to &&
    !hasClosingFence(source.slice(match.from, match.to))
  ) {
    return true;
  }
  return false;
}

/**
 * 这段块文本是不是以闭合围栏结尾。
 *
 * 末行必须**整行只有**围栏字符（允许 ≤3 格缩进与尾部空白）：
 *   - `` ```js ``            → 末行是 `\`\`\`js`，带了语言标识 → 不是闭合围栏
 *   - `` ```js\ncode\n``` `` → 末行是 `\`\`\`` → 是闭合围栏
 *
 * 先 `trimEnd()`：`match.to` 落在闭合围栏**之后**的换行符上时，
 * 末行会是空串，不去掉尾部空白就会误判成「没闭合」。
 */
export function hasClosingFence(text: string): boolean {
  const trimmed = text.trimEnd();
  const lastLine = trimmed.slice(trimmed.lastIndexOf("\n") + 1);
  // 末行必须**只有**围栏字符（可带 ≤3 格缩进与尾部空白）
  return /^ {0,3}(?:`{3,}|~{3,})\s*$/.test(lastLine);
}

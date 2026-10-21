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
import { blockRenderers } from "../render/registry";
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
interface Interval {
  from: number;
  to: number;
}

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
    return {
      node,
      hideRanges: [...marks, ...urls, ...titles].map((n) => ({ from: n.from, to: n.to })),
      styleRanges: [{ from: open.to, to: close.from }],
      styleClass: "cm-md-link",
    };
  }

  if (nodeName === "Image") {
    // ![替代文本](网址) → 只显示「替代文本」
    const marks = childrenOfType(node, "LinkMark");
    const urls = childrenOfType(node, "URL");
    if (marks.length < 2) return null;
    const open = marks[0];
    const close = marks[1];
    return {
      node,
      hideRanges: [...marks, ...urls].map((n) => ({ from: n.from, to: n.to })),
      styleRanges: [{ from: open.to, to: close.from }],
      styleClass: "cm-md-image",
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
 * 这是一个**纯函数**——不依赖 EditorState，只吃四个显式参数。
 * 原因是 CM6 的 `EditorView.decorations.from(field, get)` 的 get 拿不到 state，
 * 而块级装饰器必须走 facet（见 `state.ts` 的说明）。
 *
 * @param source 文档全文
 * @param cursor 主选区光标位置
 * @param mode   标记符显示策略：
 *   - `live`   标记隐藏（零宽 widget 顶替），光标进入该结构才显露
 *   - `dimmed` 标记始终可见，但弱化着色（Ulysses 式）
 * @param tree   增量维护的语法树
 */
export function buildLivePreviewDecorations(
  source: string,
  cursor: number,
  mode: MarkerDisplayMode = "live",
  tree: Tree,
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

  // 一次遍历收集全部三类装饰。
  // 重构前这里是三次独立的 `tree.iterate()`（实测 4000 行文档 0.78ms），
  // 合并成一次后遍历成本降到约三分之一。
  syntaxTree.iterate({
    enter(ref) {
      // `iterate` 回调拿到的是 SyntaxNodeRef（轻量引用），要拿完整节点用 `ref.node`
      const name = ref.type.name;

      // ---- 1. 行内标记（可隐藏 / 可弱化）----
      const spec = INLINE_MARKER_BY_TYPE.get(name);
      if (spec) {
        const analyzed = analyze(ref.node, spec);
        if (!analyzed) return;

        const active = shouldReveal(analyzed.node, cursor);

        for (const range of analyzed.styleRanges) {
          if (range.to > range.from && analyzed.styleClass) {
            inlineDecos.push(
              Decoration.mark({ class: analyzed.styleClass }).range(range.from, range.to),
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

  // ── 块级渲染（代码块 / 表格 / 公式 / 图表）──
  // 光标在块内 → 显示源码（可编辑）；光标在块外 → 显示渲染结果。
  for (const { match, renderer } of collectBlockMatches(syntaxTree, source)) {
    if (isBlockExpanded(match, cursor)) continue;
    const result = renderer.render(match, source);
    if (!result) continue;
    renderedDecos.push(
      Decoration.replace({
        widget: new BlockWidget(result, match.from),
        block: true,
      }).range(match.from, match.to),
    );
  }

  // `DecorationSet` 只是类型别名（= RangeSet<Decoration>），
  // 真正的构造入口是静态方法 `Decoration.set(ranges, sort)`。
  return Decoration.set(
    [...inlineDecos, ...blockDecos, ...headingDecos, ...renderedDecos],
    true,
  );
}

/** 收集所有渲染器匹配到的块 */
function collectBlockMatches(
  tree: Tree,
  source: string,
): { match: BlockMatch; renderer: BlockRenderer }[] {
  const result: { match: BlockMatch; renderer: BlockRenderer }[] = [];
  for (const renderer of blockRenderers()) {
    for (const match of renderer.find(tree, source)) {
      result.push({ match, renderer });
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
 */
function isBlockExpanded(match: BlockMatch, cursor: number): boolean {
  return cursor > match.from && cursor < match.to;
}

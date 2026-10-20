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
import type { EditorState, Range } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { parseSyntax, INLINE_MARKERS, BLOCK_MARKERS, HEADING_CLASSES } from "./syntax";

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
 */
export function buildLivePreviewDecorations(state: EditorState): DecorationSet {
  const text = state.doc.toString();
  const tree = parseSyntax(text);
  // 注意：`Decoration.mark(...).range(a, b)` 返回的是 `Range<Decoration>`（带 from/to 的区间），
  // 不是 `Decoration` 本身；`DecorationSet.create` 需要的正是这种区间数组。
  const decorations: Range<Decoration>[] = [];

  // 主选区的光标位置（多选区时取主选区）
  const cursor = state.selection.main.head;

  // 收集所有可隐藏结构
  const hideables: Hideable[] = [];
  tree.iterate({
    enter(ref) {
      // `iterate` 回调拿到的是 SyntaxNodeRef（轻量引用），要拿完整节点用 `ref.node`
      const spec = INLINE_MARKERS.find((s) => s.nodeType === ref.type.name);
      if (!spec) return;
      const analyzed = analyze(ref.node, spec);
      if (analyzed) hideables.push(analyzed);
    },
  });

  for (const item of hideables) {
    const active = shouldReveal(item.node, cursor);

    for (const range of item.styleRanges) {
      if (range.to > range.from && item.styleClass) {
        decorations.push(
          Decoration.mark({ class: item.styleClass }).range(range.from, range.to),
        );
      }
    }

    // 光标在该结构内 → 标记保持可见可编辑；否则隐藏
    if (!active) {
      for (const range of item.hideRanges) {
        if (range.to > range.from) {
          decorations.push(hiddenMarker().range(range.from, range.to));
        }
      }
    }
  }

  // 块级标记：标题的 #、列表符号、引用符号 → 弱化显示
  // 光标进入所在块（标题 / 列表项 / 引用）时，标记恢复醒目
  tree.iterate({
    enter(ref) {
      const className = BLOCK_MARKERS[ref.type.name];
      if (!className) return;
      const parent = ref.node.parent;
      const active = parent
        ? cursorInRange(parent.from, parent.to, cursor)
        : cursorInRange(ref.from, ref.to, cursor);
      decorations.push(
        Decoration.mark({
          class: active ? `${className} cm-md-block-mark--active` : className,
        }).range(ref.from, ref.to),
      );
    },
  });

  // 标题正文：按层级套用字号/字重，让 Live Preview 真的有「渲染感」
  tree.iterate({
    enter(ref) {
      const headingClass = HEADING_CLASSES[ref.type.name];
      if (!headingClass) return;
      const headerMark = childrenOfType(ref.node, "HeaderMark")[0];
      const from = headerMark ? headerMark.to : ref.from;
      if (ref.to <= from) return;
      decorations.push(Decoration.mark({ class: headingClass }).range(from, ref.to));
    },
  });

  // `DecorationSet` 只是类型别名（= RangeSet<Decoration>），
  // 真正的构造入口是静态方法 `Decoration.set(ranges, sort)`。
  return Decoration.set(decorations, true);
}

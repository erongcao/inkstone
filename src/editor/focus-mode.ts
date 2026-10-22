/**
 * 焦点模式：把光标所在的段落（与它上面最近的标题）之外的内容弱化。
 *
 * Typora / iA Writer 都有这个功能，写长文时很省眼力。
 *
 * ## 实现要点
 *
 * - 弱化用 **`Decoration.line`** 而不是给字符套 `cm-md-marker`：
 *   行装饰器是 CM6 的原生概念，不进文档、不影响光标位置，
 *   而且块级 widget（代码块 / 表格 / 公式）内部也能整体弱化——
 *   给字符套样式做不到这件事（那些区间已经被 replace 掉了）。
 * - 装饰集合放进 `StateField` 里算好，而不是
 *   `EditorView.decorations.from(field, get)`：那个 getter **只拿到字段值，拿不到 state**，
 *   而这里需要 `state.doc` 与语法树。与其再塞一堆字段进去，不如让字段直接产出装饰集合。
 * - 关闭时直接返回 `Decoration.none`（不是「算一遍再丢弃」），关闭时零开销。
 */

import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Range,
  type Transaction,
} from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import type { SyntaxNode, Tree } from "@lezer/common";
import { getSyntaxTree } from "./live-preview/state";

/** 焦点模式开关（必须排在 `focusDecorations` 之前，才能被它读到） */
export const focusModeField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setFocusMode)) return effect.value;
    }
    return value;
  },
});

const setFocusMode = StateEffect.define<boolean>();

/** 编程式切换 */
export function setFocusModeOf(view: EditorView, on: boolean): void {
  view.dispatch({ effects: setFocusMode.of(on) });
}

/**
 * 顶层块节点（含光标的那一个）。
 *
 * 一路往上走到父节点是 Document 为止。
 * 中途**不能**停在更深的位置：停在段落上会让嵌套列表里的每个列表项各自成块，
 * 那不是用户理解的「当前段落」。
 */
function topLevelBlockAt(tree: Tree, cursor: number): SyntaxNode {
  let current = tree.resolveInner(cursor, -1);
  while (current.parent && current.parent.type.name !== "Document") {
    current = current.parent;
  }
  return current;
}

/** 光标所在块，以及它上面最近的标题（同一父节点下） */
/**
 * ⚠️ lezer 的坑：`cursor.node` **每次访问都返回新对象**，
 * 所以 `node === block` 即使是同一个节点也恒为 false。
 * 只能比位置（+ 类型），不能比引用。
 */
function focusedRanges(tree: Tree, cursor: number): { from: number; to: number }[] {
  const block = topLevelBlockAt(tree, cursor);
  const ranges: { from: number; to: number }[] = [{ from: block.from, to: block.to }];

  const parent = block.parent;
  if (!parent) return ranges;
  const nodeCursor = parent.cursor();
  if (!nodeCursor.firstChild()) return ranges;
  // 一路往前走，记住**最近遇到的那个标题**。
  // 不能只看紧邻的上一个兄弟：正文里两个标题之间往往有好几个段落，
  // 紧邻的那个是段落而不是标题（第一版就是这么写的，结果标题点不亮）。
  let lastHeading: SyntaxNode | null = null;
  do {
    const node = nodeCursor.node;
    if (node.type.name.startsWith("ATXHeading")) lastHeading = node;
    // 比位置而不是比引用（见函数上方的说明）
    if (node.from === block.from && node.to === block.to) {
      // 把标题一起点亮，用户才不会失去结构感
      if (lastHeading) ranges.unshift({ from: lastHeading.from, to: lastHeading.to });
      break;
    }
  } while (nodeCursor.nextSibling());

  return ranges;
}

/**
 * 逐行判断「这一行属于亮区吗」，不属于就打弱化 class。
 *
 * 亮区 = 光标所在块 + 它上面最近的标题（可能有两段，中间不相连）。
 * 逐行走一遍比按区间前后扫清楚：只有两个区间、两种写法，
 * 但「中间那段要不要弱化」只有逐行判才不会写错。
 *
 * 代价是 O(行数)，但整个函数只在**焦点模式开着**时才跑
 *（`update` 里先判开关），关着时零开销。
 */
function buildFocusDecorations(state: EditorState): DecorationSet {
  const doc = state.doc;
  const active = focusedRanges(getSyntaxTree(state), state.selection.main.head);

  const dimmed: Range<Decoration>[] = [];
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const lit = active.some((range) => line.from >= range.from && line.to <= range.to);
    if (!lit) dimmed.push(Decoration.line({ class: "cm-focus-dim" }).range(line.from));
  }
  return Decoration.set(dimmed, true);
}

/** 装饰集合字段 */
const focusDecorations = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(_value, tr) {
    if (!tr.state.field(focusModeField)) return Decoration.none;
    if (!needsRebuild(tr)) return _value;
    return buildFocusDecorations(tr.state);
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value),
});

/** 只有文档、光标或开关变了才值得重算 */
function needsRebuild(tr: Transaction): boolean {
  return tr.docChanged || tr.selection !== undefined || tr.effects.length > 0;
}

/** 焦点模式扩展（字段顺序有意义：`focusModeField` 必须在前面） */
export function focusMode(): Extension {
  return [focusModeField, focusDecorations];
}

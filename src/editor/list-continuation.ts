/**
 * 列表续行与自动编号。
 *
 * Typora 式的输入手感，靠键盘就能把列表写完：
 *   - 在列表项末尾回车 → 续下一项，**有序列表序号自动 +1**
 *   - 缩进原样带过去（嵌套层级不会被打平）
 *   - 任务列表续出的是**未勾选**的 `[ ]`（勾选状态不传染）
 *   - 在**空列表项**上回车 → 删掉 marker 退出列表，而不是留一个空壳
 *   - Tab / Shift-Tab 缩进 / 反缩进列表项
 *
 * 全部走 lezer 的语法树（`ListItem` / `ListMark` / `Task`），
 * 不自己写正则去猜「这行是不是列表项」——那会引入第二套 Markdown 规则。
 */

import type { EditorState } from "@codemirror/state";
import { EditorSelection } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { type EditorView, type Command } from "@codemirror/view";

/** 光标所在的列表项信息 */
interface ListContext {
  /** ListItem 节点 */
  itemEnd: number;
  /** 列表符号节点的起止 */
  markFrom: number;
  markTo: number;
  /** 列表符号原文，例如 `-` `1.` `3)` */
  mark: string;
  /** 列表符号之前的缩进 */
  indent: string;
  /** 有序列表的当前序号（无序列表为 null） */
  number: number | null;
  /** 闭定界符（`.` 或 `)`） */
  delimiter: string;
  /** 任务列表标记的起止（不是任务项则为 null） */
  taskFrom: number | null;
  taskTo: number | null;
  /** 任务是否已勾选 */
  taskChecked: boolean;
  /** 是否在列表之外 */
  outside: boolean;
}

/** 空上下文 */
const OUTSIDE: ListContext = {
  itemEnd: -1,
  markFrom: -1,
  markTo: -1,
  mark: "",
  indent: "",
  number: null,
  delimiter: ".",
  taskFrom: null,
  taskTo: null,
  taskChecked: false,
  outside: true,
};

/**
 * 找出光标所在的列表项。
 *
 * 从光标处向内解析，再沿父链上溯到 `ListItem`——
 * 光标在段落中间也能找到它所属的列表项。
 */
export function listContextAt(state: EditorState, pos: number): ListContext {
  const tree = syntaxTree(state);
  // side = -1（偏向左侧）：光标正好落在节点边界时，取左边的节点。
  // 试过 side = 1（偏右），在文档末尾会解析到 Document 而非段落，更糟。
  const node = tree.resolveInner(pos, -1);

  let item = node;
  while (item.parent && item.type.name !== "ListItem") item = item.parent;
  if (item.type.name !== "ListItem" || item.from > item.to) return OUTSIDE;

  const source = state.doc.toString();

  // 直接子节点里的 ListMark 与 Task
  let markFrom = -1;
  let markTo = -1;
  let taskFrom: number | null = null;
  let taskTo: number | null = null;
  let taskChecked = false;
  const cursor = item.cursor();
  if (cursor.firstChild()) {
    do {
      const node = cursor.node;
      const name = node.type.name;
      if (markFrom === -1 && name === "ListMark") {
        markFrom = node.from;
        markTo = node.to;
      } else if (taskFrom === null && name === "Task") {
        // TaskMarker **嵌在 Task 里**，不是 ListItem 的直接子节点——
        // 只看一层的话任务项的勾选状态永远读不到。
        const inner = node.cursor();
        if (inner.firstChild()) {
          do {
            if (inner.node.type.name === "TaskMarker") {
              taskFrom = inner.node.from;
              taskTo = inner.node.to;
              taskChecked = source.slice(taskFrom, taskTo) !== "[ ]";
              break;
            }
          } while (inner.nextSibling());
        }
      }
    } while (cursor.nextSibling());
  }
  if (markFrom === -1) return OUTSIDE;

  const mark = source.slice(markFrom, markTo);
  const match = /^(\d+)([.)])$/.exec(mark);

  return {
    itemEnd: item.to,
    markFrom,
    markTo,
    mark,
    // marker 之前到行首之间就是缩进
    indent: source.slice(state.doc.lineAt(markFrom).from, markFrom),
    number: match ? Number.parseInt(match[1], 10) : null,
    delimiter: match ? match[2] : ".",
    taskFrom,
    taskTo,
    taskChecked,
    outside: false,
  };
}

/**
 * 生成续行要插入的字符串（不含前导换行）。
 *
 * 单独抽出来是为了能直接单测「续出来的下一行长什么样」。
 */
export function continuationText(ctx: ListContext): string {
  // 结尾那个空格是必需的：`2.` 后面不跟空格的话，新行会被解析成一个段落
  // 而不是列表项（实测会得到 `- 第一项\n2.` 这种坏结果）。
  if (ctx.number === null) return `${ctx.mark} `;
  // 有序：序号 +1，闭定界符原样保留（`3)` 续成 `4)` 而不是 `4.`）
  return `${ctx.number + 1}${ctx.delimiter} `;
}

/** 续出的任务标记恒为未勾选 */
function continuationTask(ctx: ListContext): string {
  return ctx.taskFrom === null ? "" : "[ ] ";
}

/** 光标是否在列表项文本的末尾（忽略行尾空白） */
function atItemEnd(state: EditorState, ctx: ListContext): boolean {
  const pos = state.selection.main.head;
  if (pos < ctx.markTo) return false;
  const rest = state.doc.sliceString(pos, ctx.itemEnd);
  return rest.trim().length === 0;
}

/**
 * 回车续行。
 *
 * 两种分支：
 *   1. 光标在列表项末尾 → 插入「换行 + 缩进 + marker」
 *   2. 光标在**空**列表项上（只有 marker 没有内容）→ 删掉 marker 退出列表
 *      留一个空壳列表项是很糟的体验：用户以为退出了，其实还在列表里
 *
 * @returns 处理了返回 true（阻止默认的 Enter）
 */
export const continueListOnEnter: Command = (view: EditorView) => {
  const { state } = view;
  // 多选区不处理：行为不好预测，留给默认逻辑
  if (state.selection.ranges.length > 1) return false;

  const head = state.selection.main.head;
  const ctx = listContextAt(state, head);
  if (ctx.outside) return false;

  // 空列表项 → 退出列表
  const contentEnd = ctx.taskTo ?? ctx.markTo;
  const hasContent = state.doc.sliceString(contentEnd, ctx.itemEnd).trim().length > 0;
  if (!hasContent) {
    view.dispatch({
      changes: { from: ctx.markFrom, to: ctx.itemEnd, insert: "" },
      selection: EditorSelection.cursor(ctx.markFrom),
      userEvent: "input",
    });
    return true;
  }

  // 不在末尾 → 只是段落内换行，不续列表
  if (!atItemEnd(state, ctx)) return false;

  const line = state.doc.lineAt(head);
  const insert = `\n${ctx.indent}${continuationText(ctx)}${continuationTask(ctx)}`;
  view.dispatch({
    changes: { from: head, to: line.to, insert },
    selection: EditorSelection.cursor(head + insert.length),
    // 让光标落在 marker 之后，用户可以直接打字
    scrollIntoView: true,
    userEvent: "input",
  });
  return true;
};

/** 单行缩进量 */
const INDENT = "  ";

/**
 * Tab：缩进当前列表项。
 *
 * 只处理单行列表项。多行选区缩进由 `indentMore` 负责，
 * 这里抢过来只为了保证「列表项缩进一定生效」。
 */
export const indentListItem: Command = (view: EditorView) => {
  const { state } = view;
  if (state.selection.ranges.length > 1) return false;
  const head = state.selection.main.head;
  const ctx = listContextAt(state, head);
  if (ctx.outside) return false;

  const line = state.doc.lineAt(head);
  view.dispatch({
    changes: { from: line.from, insert: INDENT },
    // 用 cursor 而不是 range：本版本的 range(anchor, head) 两个参数都是必需的，
    // 而缩进后光标仍是一个位置，不该造出选区
    selection: EditorSelection.cursor(head + INDENT.length),
    userEvent: "input",
  });
  return true;
};

/**
 * Shift-Tab：反缩进。
 *
 * 已经是列表第一层时**不处理**（返回 false）——
 * 反缩进到顶层会变成一个新的顶层列表，那不是用户按 Shift-Tab 的本意。
 */
export const outdentListItem: Command = (view: EditorView) => {
  const { state } = view;
  if (state.selection.ranges.length > 1) return false;
  const head = state.selection.main.head;
  const ctx = listContextAt(state, head);
  if (ctx.outside) return false;

  const line = state.doc.lineAt(head);
  const indent = line.text.slice(0, ctx.markFrom - line.from);

  // 顶层列表项：没有可去掉的前导缩进
  if (indent.length === 0) return false;

  // 一次退一格；但**不留 1 个空格**——
  // 1 空格既不够构成嵌套、又不是 0，层级会变得含糊。
  let remove = Math.min(INDENT.length, indent.length);
  if (indent.length - remove === 1) remove = indent.length;
  if (remove === 0) return false;

  view.dispatch({
    changes: { from: line.from, to: line.from + remove },
    selection: EditorSelection.cursor(head - remove),
    userEvent: "input",
  });
  return true;
};

/**
 * GFM 任务列表（`- [ ]` / `- [x]`）。
 *
 * 和表格一样的教训：先用**裸 parser** 测，得出「lezer 不认任务列表、
 * `[x]` 会被当成 Link」的结论；实际上编辑器用的是 `parser.configure(GFM)`，
 * lezer 认得，节点是：
 *
 * ```
 * ListItem[0,9]
 *   ListMark[0,1]  "-"
 *   Task[2,9]      "[ ] 未完成"
 *     TaskMarker[2,5] "[ ]"
 * ```
 *
 * 那个「`[x]` 变 Link」的坑只在裸 parser 下才出现。
 *
 * 「勾选状态」的处理和别的渲染不同：它不是装饰，而是**要写回源码的状态**。
 * 只活在 DOM 里的话，关掉文件就丢、复制出去也是空的，
 * 而且永远不会被搜索/导出/打印看见——直接违反架构红线 1。见 `taskToggleChange`。
 */

import type { SyntaxNode, Tree } from "@lezer/common";

/** 一个任务项 */
export interface TaskItem {
  /** 任务标记 `[ ]` / `[x]` 的区间 */
  from: number;
  to: number;
  /** 是否已勾选 */
  checked: boolean;
  /** 原来的标记字符（` ` / `x` / `X`），翻转时保留大小写习惯 */
  markerChar: string;
  /** 列表符号（`-` `*` `+` `1.`）的区间，渲染时要藏掉 */
  listMarkFrom: number;
  listMarkTo: number;
}

/** 取某个节点的直接子节点 */
function childOfType(node: SyntaxNode, name: string): SyntaxNode | null {
  const cursor = node.cursor();
  if (cursor.firstChild()) {
    do {
      if (cursor.node.type.name === name) return cursor.node;
    } while (cursor.nextSibling());
  }
  return null;
}

/**
 * 找出文档里所有任务项。
 *
 * `TaskMarker` 的区间正好是 `[ ]` / `[x]` / `[X]` 三个字符，
 * 所以 checked 与 markerChar 直接从**源码切片**读，不用再判断。
 * （`SyntaxNode` 本身不带原文，所以这里必须传入 source。）
 */
export function findTaskItems(tree: Tree, source: string): TaskItem[] {
  const items: TaskItem[] = [];
  tree.iterate({
    enter(ref) {
      // 同上：`return;` 才是「继续深入」，`return false` 会让遍历在 Document 就停住
      if (ref.type.name !== "Task") return;

      const marker = childOfType(ref.node, "TaskMarker");
      const char = marker ? source.slice(marker.from, marker.to) : "";
      // 没有 TaskMarker 的 Task 理论上不该出现；没有 ListMark 的 ListItem
      // 退化成「不隐藏列表符号」而不是崩掉
      const listMark = childOfType(ref.node.parent ?? ref.node, "ListMark");

      items.push({
        from: marker?.from ?? ref.from,
        to: marker?.to ?? ref.to,
        checked: char !== "[ ]" && char !== "",
        markerChar: char === "[X]" ? "X" : char === "[x]" ? "x" : " ",
        listMarkFrom: listMark?.from ?? ref.from,
        listMarkTo: listMark?.to ?? ref.from,
      });
      return false; // TaskMarker 已经处理完
    },
  });
  return items;
}

/**
 * 把任务项翻转后的**文本变更**算出来（不直接 dispatch）。
 *
 * 状态必须写回 Markdown 文本——这是架构红线 1。
 *
 * 大小写保持：用户写 `[X]` 就继续写 `[X]`。Markdown 里两者等价，
 * 没必要强行改写用户的写法。
 */
export function taskToggleChange(item: TaskItem): {
  from: number;
  to: number;
  insert: string;
} {
  const nextChar = item.checked ? " " : item.markerChar === "X" ? "X" : "x";
  return { from: item.from, to: item.to, insert: `[${nextChar}]` };
}

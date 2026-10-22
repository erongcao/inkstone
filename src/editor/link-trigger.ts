/**
 * 链接浮层的触发端：检测到「光标紧跟在 `](` 之后」就打开浮层。
 *
 * ## 为什么判据是「光标前两个字符」，而不是「文档里有 `](`」
 *
 * 自动配对（basic 级）会把 `(` 补成 `()`，所以用户敲完 `](` 时文档里其实是
 * `]()`，光标停在两个括号**中间**。于是有两种形态都要认：
 *
 * | 自动配对 | 文档 | 光标 |
 * |---|---|---|
 * | 开（默认） | `]()` | 两括号之间 |
 * | 关，或用户越过自动补的 `)` | `](` | `(` 之后 |
 *
 * 两种都满足「光标前一个字符是 `(`、再前一个是 `]`」，所以判据是同一句。
 * 确认时的收尾也不同（在 LinkPopover.tsx 里）：括号里已经有 `)` 就不补第二个。
 */

import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { getSyntaxTree } from "./live-preview/state";
import { openLinkPopover } from "./link-popover";

/** lezer 里「内容不是 Markdown 语法」的节点 */
const CODE_NODES = new Set(["InlineCode", "FencedCode", "CodeBlock", "CodeText"]);

/**
 * 上一次打开浮层时 `]` 的位置。
 *
 * 用来防止同一个 `](` 反复触发：用户按 Esc 关掉浮层后，那一对 `](` 还在文档里，
 * 之后每一次光标移动都会被重新命中，浮层会「关不掉」。
 *
 * 什么时候允许再触发：**那个位置上的 `](` 已经不存在了**。
 * 这样删了重打能再触发，而光标来回移动、Esc 后继续打字都不会。
 */
let lastTriggerAt = -1;

/** 语法上是不是代码内容 */
function insideCode(view: EditorView, pos: number): boolean {
  let node: SyntaxNode | null = getSyntaxTree(view.state).resolveInner(pos, -1);
  while (node) {
    if (CODE_NODES.has(node.type.name)) return true;
    if (node.type.isTop) break;
    node = node.parent;
  }
  return false;
}

/**
 * 判据：光标前两个字符是 `](`。
 *
 * 单独导出是为了能直接测——浏览器里造出这个场景要连打三个键还要盯浮层。
 */
export function findLinkOpenSpot(
  view: EditorView,
): { at: number; image: boolean } | null {
  const pos = view.state.selection.main.head;
  if (pos < 2) return null;
  if (view.state.sliceDoc(pos - 1, pos) !== "(") return null;
  if (view.state.sliceDoc(pos - 2, pos - 1) !== "]") return null;
  return { at: pos - 2, image: view.state.sliceDoc(pos - 3, pos - 2) === "!" };
}

export const linkPopoverTrigger = ViewPlugin.fromClass(
  class {
    constructor(private view: EditorView) {}

    update(update: ViewUpdate) {
      if (!update.docChanged && !update.selectionSet) return;

      // 文档变了先看看原来那对 `](` 还在不在；不在了就允许下次再触发
      if (lastTriggerAt >= 0) {
        const { state } = this.view;
        if (state.sliceDoc(lastTriggerAt, lastTriggerAt + 2) !== "](") lastTriggerAt = -1;
      }

      const spot = findLinkOpenSpot(this.view);
      if (!spot) return;
      if (spot.at === lastTriggerAt) return;

      const cursor = this.view.state.selection.main.head;
      // 代码里的 `](` 是代码内容，不是链接
      if (insideCode(this.view, cursor)) return;

      let coords: { top: number; bottom: number; left: number };
      try {
        const box = this.view.coordsAtPos(cursor);
        if (!box) throw new Error("no coords");
        coords = { top: box.top, bottom: box.bottom, left: box.left };
      } catch {
        // 首帧还没布局时拿不到坐标；先落在左上角，用户一敲键盘就会重算
        coords = { top: 80, bottom: 100, left: 80 };
      }

      lastTriggerAt = spot.at;
      // 焦点交给浮层的输入框（那边挂载后会 focus）。
      // 这里**不改**编辑器选区——关闭浮层时再 focus 回来，光标位置才对。
      openLinkPopover({ pos: cursor, anchor: coords, image: spot.image });
    }
  },
);

/** 测试用：清掉「已触发」记忆 */
export function resetLinkTrigger(): void {
  lastTriggerAt = -1;
}

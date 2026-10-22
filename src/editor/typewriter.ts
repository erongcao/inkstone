/**
 * 打字机模式：让光标始终停在视口的**垂直中线**。
 *
 * 名字来自打字机——铅字敲到哪一行，纸就往上送一行，眼睛不用追着光标跑。
 * 长文写到屏幕底部时尤其明显：普通编辑器里光标会越走越低，
 * 打字机模式把它钉在中间，写到哪儿都在同一个视觉位置。
 *
 * ## 关键：不能和用户抢滚动
 *
 * 如果无条件每次都居中，用户想往上翻看之前写的内容时会被立刻拽回来。
 * 所以规则是：
 *   - **用户滚轮 / 拖滚动条** → 暂停自动居中，直到下一次敲键盘
 *   - 敲键盘（`docChanged` 且是输入）→ 恢复并接管
 *
 * 判定「是不是用户滚的」靠记录上一次我们自己写下的 `scrollTop`：
 * 数值对不上就是用户动的。CM6 没有暴露「这次滚动由谁触发」的标志，
 * 只能这样反推——这是本模块唯一一处不优雅的地方，记在这里备查。
 */

import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

/** 打字机模式开关（存在 StateField 里，装饰/滚动逻辑读它） */
export const typewriterModeField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setTypewriterMode)) return effect.value;
    }
    return value;
  },
});

const setTypewriterMode = StateEffect.define<boolean>();

/** 编程式切换 */
export function setTypewriterModeOf(view: EditorView, on: boolean): void {
  view.dispatch({ effects: setTypewriterMode.of(on) });
}

/** 与视口中心相差多少以内就算「已经在中间」，不再动 */
const CENTER_TOLERANCE_PX = 4;

/**
 * 把光标滚到视口垂直中心。
 *
 * 用 `EditorView.scrollIntoView(pos, { y: "center" })` 而不是手算 `scrollTop`：
 * 前者会尊重 `scrollMargin`、块级 widget 的实际高度与折叠行，
 * 这些手算都得不出正确结果。
 */
function centerCursor(view: EditorView): void {
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  const block = view.lineBlockAt(line.from);
  if (!block) return;

  const scroller = view.scrollDOM;
  const viewportMiddle = scroller.clientHeight / 2;
  const cursorMiddle = block.top - scroller.scrollTop + block.height / 2;
  if (Math.abs(cursorMiddle - viewportMiddle) <= CENTER_TOLERANCE_PX) return;

  view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: "center", yMargin: 0 }) });
}

/**
 * 自动居中的状态机。
 *
 * 用 ViewPlugin 而不是纯事件 handler：需要「上一次我们自己写下的 scrollTop」这个跨事件的状态。
 */
const autoCenter = ViewPlugin.fromClass(
  class {
    /** 上一次我们自己写下的 scrollTop */
    private lastApplied = -1;
    /** 用户手动滚动过 → 挂起，直到下一次输入 */
    private suspended = false;

    constructor(private readonly view: EditorView) {
      // 直接监听 scrollDOM 的 scroll 事件。
      // 不能用 EditorView.domEventHandlers：那个只挂在 contentDOM 上，
      // 而 `scroll` 事件**不冒泡**，滚容器上的滚动它收不到。
      this.onScroll = () => this.noteUserScroll();
      view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
      // 开启瞬间就把光标拉回中间，否则第一眼的位置很突兀
      queueMicrotask(() => {
        if (this.view.state.field(typewriterModeField)) this.apply();
      });
    }

    private readonly onScroll: () => void;

    update(update: ViewUpdate): void {
      if (!this.view.state.field(typewriterModeField)) {
        this.suspended = false;
        this.lastApplied = -1;
        return;
      }
      const typed =
        update.docChanged && update.transactions.some((tr) => tr.isUserEvent("input"));
      if (typed) {
        this.suspended = false;
        this.apply();
        return;
      }
      // 光标被程序移动（点大纲、点脚注跳转、搜索跳转）→ 跟上
      if (update.selectionSet && !update.docChanged) this.apply();
      // 文档变了但不是输入（撤销/协作/程序写入）→ 也重新居中
      if (update.docChanged) this.apply();
    }

    /** 用户主动滚动 → 挂起 */
    noteUserScroll(): void {
      if (this.view.scrollDOM.scrollTop !== this.lastApplied) this.suspended = true;
    }

    private apply(): void {
      if (this.suspended) return;
      centerCursor(this.view);
      this.lastApplied = this.view.scrollDOM.scrollTop;
    }

    destroy(): void {
      this.suspended = false;
      this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
    }
  },
);

/** 打字机模式扩展 */
export function typewriter(): Extension {
  return [typewriterModeField, autoCenter];
}

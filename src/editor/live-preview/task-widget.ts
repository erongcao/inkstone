/**
 * 任务列表的勾选框 widget。
 *
 * 与 `InlineHtmlWidget` 的区别：它必须**可点击**，而且点击不是移动光标，
 * 而是**改写 Markdown 源码**里的 `[ ]` / `[x]`——
 * 这是架构红线 1（单一真相源是 Markdown 文本）的直接体现：
 * 勾选状态不能只活在 DOM 里，否则关掉文件就丢、复制出去也是空的。
 *
 * 点击由 `live-preview/index.ts` 的 mousedown 处理接管
 * （靠 `data-task-at` 找到标记位置）。
 */

import { WidgetType } from "@codemirror/view";
import type { TaskItem } from "../render/task-list";

export class TaskCheckboxWidget extends WidgetType {
  constructor(readonly item: TaskItem) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = `cm-md-task${this.item.checked ? " cm-md-task--checked" : ""}`;
    span.setAttribute("role", "checkbox");
    span.setAttribute("aria-checked", String(this.item.checked));
    span.setAttribute("aria-label", this.item.checked ? "取消勾选" : "勾选");
    span.textContent = this.item.checked ? "☑" : "☐";
    span.dataset.taskAt = String(this.item.from);
    return span;
  }

  eq(other: TaskCheckboxWidget): boolean {
    return other.item.checked === this.item.checked;
  }

  /** 返回 false：让点击事件冒泡到 contentDOM 的 mousedown 处理 */
  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * 脚注的引用标记与定义标记 widget。
 *
 * 与任务勾选框不同，脚注点击**不改写文档**——它只是跳转。
 * 但仍然要挂 `data-footnote-jump`，让 `live-preview/index.ts` 的 mousedown
 * 统一处理（和 `data-task-at` / `data-inline-from` 同一套分发）。
 *
 * `eq` 只比编号与跳转目标：脚注的**内容**仍然躺在 Markdown 文本里，
 * widget 只负责显示一个数字，没有任何需要随内容重建的状态。
 */

import { WidgetType } from "@codemirror/view";
import { t } from "@/i18n";

/** 引用处的上标数字，点它跳到定义 */
export class FootnoteRefWidget extends WidgetType {
  constructor(
    readonly number: number,
    /** 目标定义在文档中的起点 */
    readonly target: number,
    /** 原始 `[^label]` 的起点（光标落进来时露出源码） */
    readonly from: number,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-md-footnote-ref";
    span.textContent = String(this.number);
    span.title = t("跳到脚注定义");
    span.dataset.footnoteJump = String(this.target);
    return span;
  }

  eq(other: FootnoteRefWidget): boolean {
    return other.number === this.number && other.target === this.target;
  }

  /** 返回 false：让点击事件冒泡出去给 mousedown 处理 */
  ignoreEvent(): boolean {
    return false;
  }
}

/** 定义处的编号标记（`[^1]:` 换成的那个 `1.`），点它跳回第一个引用 */
export class FootnoteDefWidget extends WidgetType {
  constructor(
    readonly number: number,
    /** 第一个引用的位置；没有引用时为 -1 */
    readonly target: number,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-md-footnote-badge";
    span.textContent = `${this.number}.`;
    span.title = t("跳回第一个引用");
    // 没有任何引用的定义不会被渲染成 widget，但保底不留空属性
    if (this.target >= 0) span.dataset.footnoteJump = String(this.target);
    return span;
  }

  eq(other: FootnoteDefWidget): boolean {
    return other.number === this.number && other.target === this.target;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

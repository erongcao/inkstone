/**
 * 行内渲染结果的 widget。
 *
 * 与 `block-widget.ts` 的区别只有两处：
 *   - 不带 `block: true`（行内替换）
 *   - `data-inline-from` 而不是 `data-block-from`
 *     ——mousedown 处理靠这个属性区分两类块，点击渲染后的行内公式同样应该露出源码。
 */

import { WidgetType } from "@codemirror/view";

/** 把一段可信 HTML 渲染成行内 widget */
export class InlineHtmlWidget extends WidgetType {
  constructor(
    /** HTML 字符串（由 KaTeX 生成，`trust: false` 下不含可执行内容） */
    readonly html: string,
    /** 内容指纹，覆盖所有影响渲染结果的输入 */
    readonly key: string,
    /** 在文档中的起点，供 mousedown 把光标移进来 */
    readonly from: number,
    /** 额外的 class（区分公式 / 未来其它行内渲染） */
    readonly className: string,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const dom = document.createElement("span");
    dom.className = this.className;
    dom.innerHTML = this.html;
    dom.dataset.inlineFrom = String(this.from);
    return dom;
  }

  eq(other: InlineHtmlWidget): boolean {
    return other.key === this.key;
  }

  /** 返回 false：让 DOM 事件正常冒泡，交给 contentDOM 上的 mousedown 处理 */
  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * 块级 widget：把一个块（代码块 / 表格 / 公式 / 图表）换成渲染后的 DOM。
 *
 * 与行内标记的 `HiddenMarkerWidget` 的关键区别：
 *   - 行内：`Decoration.replace({ widget })`（inline）
 *   - 块级：`Decoration.replace({ widget, block: true })`（block-level）
 *     `block: true` 让 CM6 把它当成块级元素插入，而不是行内的一坨。
 *
 * 文档坐标不变，所以光标依然能落进块内 → 装饰器重算 → 切回源码编辑。
 */

import { WidgetType } from "@codemirror/view";
import type { BlockRenderResult } from "../render/types";

/** 块级渲染的 widget */
export class BlockWidget extends WidgetType {
  constructor(
    /** 渲染结果 */
    readonly result: BlockRenderResult,
    /** 块在文档中的起点（点击时用来把光标移进块） */
    readonly from: number,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const dom = this.result.dom;
    // 记录起点，供 mousedown 处理把光标移进块内
    dom.dataset.blockFrom = String(this.from);
    return dom;
  }

  eq(other: BlockWidget): boolean {
    // 内容指纹相同 → 复用已有 DOM（不重建，省一次渲染）
    return other.result.key === this.result.key;
  }

  /**
   * 返回 false：让 DOM 事件正常冒泡。
   *
   * 我们靠这个在 contentDOM 上监听 mousedown，
   * 实现「点击渲染后的块 → 光标进入块内 → 切回源码编辑」。
   */
  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * GitHub 提示块的标题徽章。
 *
 * 把 `> [!NOTE]` 里的 `[!NOTE]` 换成一枚标题徽章——
 * 与 GitHub 自己的渲染一致（图标 + 类型名）。
 *
 * 为什么用文字而不是内联 SVG：SVG 路径数据要从上游包里搬，
 * 那是别人的作品（虽然 MIT），还得带署名。
 * 一个带颜色的文字徽章足够表意，样式全在 CSS 里。
 */

import { WidgetType } from "@codemirror/view";
import type { AlertType } from "@/parser/alerts";

export class AlertTitleWidget extends WidgetType {
  constructor(
    readonly type: AlertType,
    /** 标记在文档里的位置（点它能回到源码） */
    readonly from: number,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = `cm-md-alert-title cm-md-alert-title--${this.type.toLowerCase()}`;
    span.textContent = this.type;
    span.contentEditable = "false";
    span.dataset.alertFrom = String(this.from);
    return span;
  }

  eq(other: AlertTitleWidget): boolean {
    return other.type === this.type;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

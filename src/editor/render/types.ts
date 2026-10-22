/**
 * 块级渲染的公共类型。
 *
 * 什么是「块级渲染」：
 *   Live Preview 里，行内标记（`**`、`*`、`` ` ``）是**行内**的——
 *   装饰器把标记符换成零宽 widget，正文照常显示。
 *   而代码块、表格、公式块、图表是**整块**的：
 *   它们要被替换成一个有自己外观的 DOM（高亮后的代码、渲染后的表格……）。
 *
 * 两种机制在 CM6 里的区别只有一处：
 *   - 行内：`Decoration.replace({ widget })`（inline）
 *   - 块级：`Decoration.replace({ widget, block: true })`（block-level）
 * 文档坐标都不变，所以光标依然能落进块内 → 切换回源码编辑。
 */

/** 一个可渲染的块 */
export interface BlockMatch {
  /** 块在文档中的起点（含） */
  from: number;
  /** 块在文档中的终点（不含） */
  to: number;
  /** 块的种类（调试与 widget key 用） */
  kind: string;
  /** 语言标识（代码块） */
  language?: string;
  /** 块内容：已去掉围栏、标记等外围符号 */
  content: string;
}

/** 渲染结果 */
export interface BlockRenderResult {
  /** 渲染出的 DOM */
  dom: HTMLElement;
  /**
   * 内容指纹。
   * widget 用它判断「内容变了没有」——变了就得重建 DOM。
   * 所以它必须覆盖**所有影响渲染结果的输入**（内容、语言、主题）。
   */
  key: string;
}

import type { Tree } from "@lezer/common";
import type { Interval } from "./scan";

/**
 * 块级渲染器。
 *
 * 一个渲染器负责一种块结构，负责两件事：
 *   1. `find` —— 在文档里找出所有属于它的块
 *   2. `render` —— 把一个块渲染成 DOM
 *
 * `find` 拿得到 lezer 语法树和源码全文，两种识别方式都能用：
 *   - lezer 能识别的（围栏代码块 → `FencedCode`）用语法树，准
 *   - lezer 不识别的（GFM 表格、任务列表、`$$` 公式块）用行扫描
 *     ——实测 `@lezer/markdown` 的 GFM 扩展**不识别表格与任务列表**，
 *     表格会被当成普通 Paragraph
 */
export interface BlockRenderer {
  /** 唯一标识 */
  id: string;
  /**
   * 找出所有可渲染的块。
   *
   * `blockRanges` 是**先注册的渲染器**已经占用的区间集合：
   * 有些结构会被两个渲染器同时匹配（行首单块 `$$x$$` 与块级 `math`、
   * `$$ … | a | … $$` 里的表格语法），后面的渲染器要靠它让开，
   * 否则同一段文本会被替换两次。装饰器管线按注册顺序透传。
   */
  find(tree: Tree, source: string, blockRanges?: readonly Interval[]): BlockMatch[];
  /** 渲染一个块；返回 null 表示这个块不渲染 */
  render(match: BlockMatch, source: string): BlockRenderResult | null;
}

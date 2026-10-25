/**
 * AI 访问编辑器的唯一入口。
 *
 * ## 为什么需要这一层
 *
 * AI 面板要读写当前文档，但它在 React 树里的位置与编辑器实例**不同**：
 * 编辑器实例由 `EditorSurface` 创建并持有（为了多标签页各自保留撤销栈），
 * 面板却想做成应用级的浮层（命令面板、工具栏、快捷键都能打开它）。
 *
 * 如果面板直接 import 编辑器实例，就会出现两条持有路径：
 * 一条是 `EditorSurface` 的 ref，一条是模块级单例——
 * 切标签页时两者可能指向不同的状态，于是「AI 改的是你看到的那个文档」这条
 * 不变量就破了。
 *
 * 所以：**编辑器的持有权留在 `EditorSurface`，它把自己注册到这个注册表**，
 * 面板通过 `getAiEditorBridge()` 取。注册表里永远只有**当前活动的那一个**，
 * 换标签页不需要改这里（标签页切换发生在同一个 view 上）。
 *
 * ## 为什么写回要走 replaceRange 而不是直接改 state
 *
 * 见 `MarkdownEditorHandle.replaceRange` 的注释：
 * `view.setState()` 不触发 updateListener，脏标记与自动保存都不会更新。
 */

import { appendWriteback } from "./writeback";
import type { EditorState } from "@codemirror/state";

/** 一段文本的范围 */
export interface TextRange {
  from: number;
  to: number;
}

/** AI 能对编辑器做的操作 */
export interface AiEditorBridge {
  /** 当前文档全文 */
  getSource(): string;
  /** 当前光标位置 */
  getCursor(): number;
  /** 当前选区；没有选区时为 null */
  getSelection(): TextRange | null;
  /** 替换一段文本（走普通事务，可撤销） */
  replaceRange(from: number, to: number, text: string): void;
  /** 当前状态（算写回范围时要用文档长度） */
  getState(): EditorState;
}

let bridge: AiEditorBridge | null = null;

/**
 * 注册当前活动的编辑器桥。
 *
 * 传 `null` 表示注销（编辑器销毁时）。
 */
export function setAiEditorBridge(next: AiEditorBridge | null): void {
  bridge = next;
}

/** 取当前活动的编辑器桥；没有编辑器时返回 null */
export function getAiEditorBridge(): AiEditorBridge | null {
  return bridge;
}

/**
 * 按 `appendWriteback` 的规则追加文本。
 *
 * 分隔符规则（要不要补空行）只有 `writeback.ts` 一处实现——
 * 这里不重新推导，直接用它算出来的 change。
 */
export function appendWithRule(editor: AiEditorBridge, text: string): void {
  const change = appendWriteback(editor.getState(), text);
  editor.replaceRange(change.from, change.to, change.insert);
}

/**
 * AI 结果的写回。
 *
 * 契约（`docs/ai-design.md` D16，架构红线 1 的直接体现）：
 *   **AI 结果一律不直接覆盖用户文本。**
 *   - 流式结果先进预览面板，用户点「替换」才写入
 *   - 写入是**普通事务** → 可撤销（⌘Z）、立即落进 Markdown 文本、
 *     能被搜索/导出/打印看见
 *   - 取消或换一个动作重来，不留下任何痕迹
 *
 * 为什么不能「直接替换」：模型输出质量不稳定，而且用户的原文
 * 可能正在被光标邻接着的输入影响——静默覆盖会让不可撤销的数据损失。
 */

import { EditorSelection, type EditorState } from "@codemirror/state";

/** 一次待确认的写回 */
export interface PendingWriteback {
  /** 要替换的范围 */
  from: number;
  to: number;
  /** 预览中的模型输出 */
  text: string;
  /** 这段文本原来是什么（用于面板里做前后对比） */
  original: string;
  /** 动作名，面板标题用 */
  label: string;
}

/**
 * 接受预览结果：把范围替换成模型输出。
 *
 * 刻意**不**走 `EditorState.update` 的 `userEvent` 之类选项，
 * 就是最普通的一次 dispatch —— 这样它和其他编辑一样进撤销栈，
 * 用户按 ⌘Z 就能还原。
 */
export function acceptWriteback(
  state: EditorState,
  pending: PendingWriteback,
): EditorState {
  return state.update({
    changes: { from: pending.from, to: pending.to, insert: pending.text },
    // 选区落到插入内容之后，用户可以接着写
    selection: EditorSelection.cursor(pending.from + pending.text.length),
    scrollIntoView: true,
  }).state;
}

/**
 * 放弃预览：文档一个字都不动。
 *
 * 返回原 state 而不是空操作事务，是为了让调用方能直接
 * `if (next !== prev) view.dispatch(...)` 而不必先比对文档。
 */
export function rejectWriteback(state: EditorState): EditorState {
  return state;
}

/**
 * 构造「插入到光标处」的写回（总结类动作用：结果不是替换，而是新增）。
 *
 * 插入位置默认是当前文档末尾并空一行——总结这种内容
 * 塞到光标中间会把用户的思路打断。
 */
export function appendWriteback(
  state: EditorState,
  text: string,
): { from: number; to: number; insert: string } {
  const doc = state.doc;
  const at = doc.length;
  const needsSeparator =
    at === 0 || doc.sliceString(Math.max(0, at - 2)).endsWith("\n\n");
  return {
    from: at,
    to: at,
    insert: `${needsSeparator ? "" : "\n\n"}${text}\n`,
  };
}

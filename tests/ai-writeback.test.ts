/**
 * AI 写回的护栏测试。
 *
 * 这是红线 1（单一真相源是 Markdown 文本）与 D16（先预览再接受）
 * 落到代码上的**唯一证据**。用 `EditorState` 驱动，不依赖浏览器——
 * 「接受后按 ⌘Z 能还原」这种契约必须被断言，不能靠推理。
 */

import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { history, undo, redo } from "@codemirror/commands";
import {
  acceptWriteback,
  appendWriteback,
  rejectWriteback,
  type PendingWriteback,
} from "@/ai/writeback";

/**
 * 跑一次 undo / redo。
 *
 * 注意：`undo` / `redo` 是 **Command**，接收 `{ state, dispatch }`，
 * 不是直接吃 state 的函数。传错会得到
 * `Cannot read properties of undefined (reading 'readOnly')`。
 */
function tryUndo(state: EditorState): EditorState | null {
  let out: EditorState | null = null;
  const ran = undo({ state, dispatch: (tr) => (out = tr.state) });
  return ran ? out : null;
}

function tryRedo(state: EditorState): EditorState | null {
  let out: EditorState | null = null;
  const ran = redo({ state, dispatch: (tr) => (out = tr.state) });
  return ran ? out : null;
}

function makeState(doc: string, anchor = 0) {
  return EditorState.create({
    doc,
    selection: EditorSelection.single(anchor),
    extensions: [history()],
  });
}

const PENDING: PendingWriteback = {
  from: 4,
  to: 7,
  text: "改写后的内容",
  original: "原文",
  label: "润色",
};

describe("接受写回", () => {
  it("替换范围内的文本", () => {
    const state = makeState("这是原文段落。", 0);
    const next = acceptWriteback(state, {
      ...PENDING,
      from: 2,
      to: 4,
      original: "原文",
    });
    expect(next.doc.toString()).toBe("这是改写后的内容段落。");
  });

  it("是普通事务 → 可撤销、可重做", () => {
    const source = "这是原文段落。";
    const state = makeState(source, 0);
    const next = acceptWriteback(state, { ...PENDING, from: 2, to: 4 });

    const undone = tryUndo(next);
    expect(undone).not.toBeNull();
    expect(undone!.doc.toString()).toBe(source);

    const redone = tryRedo(undone!);
    expect(redone).not.toBeNull();
    expect(redone!.doc.toString()).toBe(next.doc.toString());
  });

  it("选区落到插入内容之后，用户能接着写", () => {
    const state = makeState("这是原文段落。", 0);
    const next = acceptWriteback(state, { ...PENDING, from: 2, to: 4, text: "ABC" });
    expect(next.selection.main.head).toBe(2 + 3);
  });

  it("整篇替换也能正确工作（AI 改写了整段）", () => {
    const source = "第一段。\n\n第二段。";
    const state = makeState(source, 0);
    const next = acceptWriteback(state, {
      from: 0,
      to: source.length,
      text: "全新的一篇。",
      original: source,
      label: "重写",
    });
    expect(next.doc.toString()).toBe("全新的一篇。");
    expect(tryUndo(next)!.doc.toString()).toBe(source);
  });

  it("连续接受两次，两次都在撤销栈里", () => {
    const state = makeState("aaa bbb ccc", 0);
    const first = acceptWriteback(state, { ...PENDING, from: 0, to: 3, text: "AAA" });
    const second = acceptWriteback(first, { ...PENDING, from: 4, to: 7, text: "BBB" });
    expect(second.doc.toString()).toBe("AAA BBB ccc");

    let s = second;
    s = tryUndo(s)!;
    expect(s.doc.toString()).toBe("AAA bbb ccc");
    s = tryUndo(s)!;
    expect(s.doc.toString()).toBe("aaa bbb ccc");
  });
});

describe("放弃写回", () => {
  it("文档一个字都不动", () => {
    const source = "不要动我。";
    const state = makeState(source, 0);
    const next = rejectWriteback(state);
    expect(next.doc.toString()).toBe(source);
    // 而且不产生新的撤销步骤——放弃不该占用户的撤销栈
    expect(tryUndo(next)).toBeNull();
  });

  it("在 AI 已经流式输出了内容之后再放弃，文档依然不变", () => {
    // 流式输出只是往面板里追加，不碰文档——所以放弃永远是安全的
    const source = "原文内容。";
    const state = makeState(source, 0);
    const pending: PendingWriteback = { ...PENDING, from: 0, to: source.length, original: source };
    // 流式过程只改 pending.text
    pending.text = "模型已经写了很长一段";
    expect(rejectWriteback(state).doc.toString()).toBe(source);
  });
});

describe("追加写回（总结类）", () => {
  it("空文档直接追加，不加多余空行", () => {
    const state = makeState("", 0);
    const change = appendWriteback(state, "摘要内容");
    expect(change.insert).toBe("摘要内容\n");
  });

  it("文档末尾没有空行时补一个空行", () => {
    const state = makeState("已有内容", 0);
    const change = appendWriteback(state, "摘要");
    expect(change.insert).toBe("\n\n摘要\n");
  });

  it("文档末尾已有空行时不重复加", () => {
    const state = makeState("已有内容\n\n", 0);
    const change = appendWriteback(state, "摘要");
    expect(change.insert).toBe("摘要\n");
  });

  it("追加到末尾而不是光标处——不能打断用户正在写的思路", () => {
    const source = "第一段。\n\n第二段。";
    const state = makeState(source, 3); // 光标在开头
    const change = appendWriteback(state, "摘要");
    expect(change.from).toBe(source.length);
    expect(change.to).toBe(source.length);
  });

  it("追加后同样可撤销", () => {
    const source = "已有内容";
    const state = makeState(source, 0);
    const change = appendWriteback(state, "摘要");
    const next = state.update({ changes: change }).state;
    expect(next.doc.toString()).toBe("已有内容\n\n摘要\n");
    expect(tryUndo(next)!.doc.toString()).toBe(source);
  });
});
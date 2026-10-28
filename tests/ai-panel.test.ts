/**
 * AI 面板的护栏测试。
 *
 * 这组用例守的是 D16（先预览再接受）与红线 1（真相源是 Markdown 文本）：
 *   - 模型输出**永远**不直接落进文档
 *   - 接受走**普通事务** → 能按 ⌘Z 撤销
 *   - 放弃时文档一个字都不动
 *   - 用户在等待期间改了原文 → 拒绝覆盖
 *
 * 用真实 `EditorView` 驱动（不是 mock），因为「可撤销」和
 * 「updateListener 有没有被触发」这两件事只有在真编辑器上才算数。
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";

import { setAiEditorBridge } from "@/ai/editor-bridge";
import { ensureMarkdownParser } from "@/parser/markdown-loader";
import {
  acceptAiResult,
  closeAiPanel,
  getAiPanelState,
  openAiPanel,
  rejectAiResult,
  resetAiRunner,
  runAiAction,
  setAiRunner,
  type AiRunner,
} from "@/ai/panel-store";
import { updateSettings } from "@/settings/store";

interface Fixture {
  view: EditorView;
  text(): string;
  /** updateListener 被触发的次数 */
  updates(): number;
  destroy(): void;
}

let fixture: Fixture | null = null;

function setupEditor(
  doc: string,
  opts: { cursor?: number; selection?: { from: number; to: number } } = {},
): Fixture {
  const host = document.createElement("div");
  document.body.appendChild(host);
  let updates = 0;

  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: opts.selection
        ? EditorSelection.range(opts.selection.from, opts.selection.to)
        : EditorSelection.cursor(opts.cursor ?? 0),
      extensions: [
        history(),
        EditorView.updateListener.of(() => {
          updates += 1;
        }),
      ],
    }),
    parent: host,
  });

  setAiEditorBridge({
    getSource: () => view.state.doc.toString(),
    getCursor: () => view.state.selection.main.head,
    getSelection: () => {
      const range = view.state.selection.main;
      return range.empty ? null : { from: range.from, to: range.to };
    },
    replaceRange: (from, to, text) => {
      view.dispatch({
        changes: { from, to, insert: text },
        selection: EditorSelection.cursor(from + text.length),
      });
    },
    getState: () => view.state,
  });

  return {
    view,
    text: () => view.state.doc.toString(),
    updates: () => updates,
    destroy: () => {
      view.destroy();
      host.remove();
    },
  };
}

/** 把若干块文本当成模型的流式输出 */
function mockRunner(chunks: string[], onRequest?: (request: unknown) => void): AiRunner {
  return async (_endpoint, request, handlers) => {
    onRequest?.(request);
    for (const chunk of chunks) handlers.onDelta(chunk);
    handlers.onDone();
    return () => {};
  };
}

beforeAll(async () => {
  // 段落 / 章节的切片走 mdast（红线 3：语义归 remark），
  // 而 remark 管线是按需加载的——不先等它就绪，切片会返回 null
  await ensureMarkdownParser();
});

beforeEach(() => {
  updateSettings({
    ai: { enabled: true, defaultEndpointId: "minimax-cn", defaultModel: "" },
  });
});

afterEach(() => {
  closeAiPanel();
  resetAiRunner();
  setAiEditorBridge(null);
  fixture?.destroy();
  fixture = null;
  updateSettings({ ai: { enabled: false, defaultEndpointId: "", defaultModel: "" } });
});

describe("面板开关", () => {
  it("打开后状态是 idle，并报出上下文范围", () => {
    fixture = setupEditor("这是要被润色的一段文字，长度足够触发段落与章节的降级。", {
      cursor: 3,
    });
    openAiPanel("rewrite");
    const state = getAiPanelState();
    expect(state.open).toBe(true);
    expect(state.tab).toBe("rewrite");
    expect(state.status).toBe("idle");
    expect(state.contextLabel).toContain("字）");
  });

  it("关闭后回到初始状态", () => {
    fixture = setupEditor("一段文字。", { cursor: 0 });
    openAiPanel("rewrite");
    closeAiPanel();
    const state = getAiPanelState();
    expect(state.open).toBe(false);
    expect(state.output).toBe("");
    expect(state.pending).toBeNull();
  });
});

describe("上下文切片", () => {
  it("有选区时用选区", () => {
    fixture = setupEditor("前面一段。\n\n选中的内容在这里。\n\n后面一段。", {
      selection: { from: 7, to: 15 },
    });
    openAiPanel("rewrite");
    expect(getAiPanelState().contextLabel).toContain("选区");
  });

  it("没有选区时降级到段落 / 章节", () => {
    fixture = setupEditor(
      "# 标题\n\n这是一个足够长的段落，用来触发段落级的上下文切片。",
      {
        cursor: 12,
      },
    );
    openAiPanel("rewrite");
    const label = getAiPanelState().contextLabel;
    expect(label).toMatch(/当前段落|章节/);
  });

  it("总结类用整篇文档", () => {
    fixture = setupEditor("# 标题\n\n正文。", { cursor: 0 });
    openAiPanel("summarize");
    expect(getAiPanelState().contextLabel).toContain("整篇文档");
  });
});

describe("跑动作", () => {
  it("流式内容会累加到面板里", async () => {
    fixture = setupEditor("要润色的文字。", { cursor: 0 });
    setAiRunner(mockRunner(["这是", "润色", "后的结果。"]));
    openAiPanel("rewrite");
    await runAiAction("polish");
    const state = getAiPanelState();
    expect(state.status).toBe("done");
    expect(state.output).toBe("这是润色后的结果。");
  });

  it("剥掉模型爱裹的代码块与客套话", async () => {
    fixture = setupEditor("要润色的文字。", { cursor: 0 });
    setAiRunner(mockRunner(["```markdown\n润色后的正文。\n```"]));
    openAiPanel("rewrite");
    await runAiAction("polish");
    expect(getAiPanelState().output).toBe("润色后的正文。");
  });

  it("跑完之前文档一个字都不动", async () => {
    fixture = setupEditor("原文内容。", { cursor: 0 });
    setAiRunner(mockRunner(["改写后的内容。"]));
    openAiPanel("rewrite");
    await runAiAction("polish");
    expect(fixture.text()).toBe("原文内容。");
  });

  it("AI 没启用时直接报错，不发请求", async () => {
    updateSettings({ ai: { enabled: false } });
    fixture = setupEditor("原文内容。", { cursor: 0 });
    let called = false;
    setAiRunner(
      mockRunner(["x"], () => {
        called = true;
      }),
    );
    openAiPanel("rewrite");
    await runAiAction("polish");
    expect(called).toBe(false);
    expect(getAiPanelState().status).toBe("error");
    expect(getAiPanelState().error).toContain("未启用");
  });

  it("上游报错时把错误如实显示出来", async () => {
    fixture = setupEditor("原文内容。", { cursor: 0 });
    setAiRunner(async (_endpoint, _request, handlers) => {
      handlers.onError("401 Unauthorized");
      return () => {};
    });
    openAiPanel("rewrite");
    await runAiAction("polish");
    const state = getAiPanelState();
    expect(state.status).toBe("error");
    expect(state.error).toContain("401");
  });
});

describe("接受写回（红线 1 的落点）", () => {
  it("改写会替换选区，并且能撤销", async () => {
    fixture = setupEditor("这是原文段落。", { selection: { from: 2, to: 4 } });
    setAiRunner(mockRunner(["改写后的内容"]));
    openAiPanel("rewrite");
    await runAiAction("polish");
    acceptAiResult();

    expect(fixture.text()).toBe("这是改写后的内容段落。");

    // 能撤销 —— 这条是「普通事务」的证据
    undo(fixture.view);
    expect(fixture.text()).toBe("这是原文段落。");
  });

  it("接受会触发 updateListener（脏标记与自动保存靠它）", async () => {
    fixture = setupEditor("这是原文段落。", { selection: { from: 2, to: 4 } });
    setAiRunner(mockRunner(["改写后的内容"]));
    openAiPanel("rewrite");
    await runAiAction("polish");

    const before = fixture.updates();
    acceptAiResult();
    expect(fixture.updates()).toBe(before + 1);
  });

  it("总结类追加到文末，而不是光标处", async () => {
    fixture = setupEditor("已有内容", { cursor: 0 });
    setAiRunner(mockRunner(["摘要内容"]));
    openAiPanel("summarize");
    await runAiAction("one-line");
    acceptAiResult();

    expect(fixture.text()).toBe("已有内容\n\n摘要内容\n");
    undo(fixture.view);
    expect(fixture.text()).toBe("已有内容");
  });

  it("用户在等待期间改了原文 → 拒绝覆盖", async () => {
    fixture = setupEditor("这是原文段落。", { selection: { from: 2, to: 4 } });
    setAiRunner(mockRunner(["改写后的内容"]));
    openAiPanel("rewrite");
    await runAiAction("polish");

    // 用户在模型输出期间改了同一段
    fixture.view.dispatch({ changes: { from: 2, to: 4, insert: "我自己改的" } });

    acceptAiResult();
    expect(fixture.text()).toBe("这是我自己改的段落。");
    expect(getAiPanelState().status).toBe("error");
    expect(getAiPanelState().error).toContain("改过");
  });

  it("接受后面板关闭", async () => {
    fixture = setupEditor("这是原文段落。", { selection: { from: 2, to: 4 } });
    setAiRunner(mockRunner(["改写后的内容"]));
    openAiPanel("rewrite");
    await runAiAction("polish");
    acceptAiResult();
    expect(getAiPanelState().open).toBe(false);
  });
});

describe("放弃写回", () => {
  it("文档一个字都不动，也不占用户的撤销栈", async () => {
    fixture = setupEditor("原文内容。", { cursor: 0 });
    setAiRunner(mockRunner(["改写后的内容"]));
    openAiPanel("rewrite");
    await runAiAction("polish");
    rejectAiResult();

    expect(fixture.text()).toBe("原文内容。");
    // 没有新增的撤销步骤
    undo(fixture.view);
    expect(fixture.text()).toBe("原文内容。");
  });

  it("放弃后结果被清掉，状态回到 idle", async () => {
    fixture = setupEditor("原文内容。", { cursor: 0 });
    setAiRunner(mockRunner(["改写后的内容"]));
    openAiPanel("rewrite");
    await runAiAction("polish");
    rejectAiResult();

    const state = getAiPanelState();
    expect(state.status).toBe("idle");
    expect(state.output).toBe("");
    expect(state.pending).toBeNull();
  });
});

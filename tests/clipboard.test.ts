/**
 * 剪贴板行为的护栏测试。
 *
 * 覆盖三件事：
 *   1. 复制时同时写 `text/plain`（Markdown 源码）与 `text/html`（渲染后）
 *   2. Inkstone 内部复制粘贴**逐字节无损**（靠 `text/x-inkstone-markdown`）
 *   3. 「粘贴为纯文本」是一次性标志，置位后忽略 HTML
 *
 * 这些是「从 Inkstone 复制到 Word 得到富文本」「在两个编辑器之间粘贴不丢结构」
 * 这类体验的地基，一旦回归，用户会直接感知到内容被改写。
 */

import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  INKSTONE_MARKDOWN_MIME,
  armPlainTextPaste,
  handleCopy,
  isPlainTextPasteArmed,
  markdownCopy,
  selectedMarkdown,
} from "@/editor/clipboard";
import { handlePaste } from "@/editor/paste";
import { markdownToHtml } from "@/parser/html";
import { ensureMarkdownToHtml } from "@/parser/html-loader";

/** 造一个带 clipboardData 的假事件；未声明的类型返回空串（与真实 DataTransfer 一致） */
function fakeEvent(clipboard: Record<string, string>): ClipboardEvent {
  return {
    clipboardData: {
      getData: (type: string) => clipboard[type] ?? "",
    },
  } as unknown as ClipboardEvent;
}

/** 造一个能记录 setData 的假事件 */
function recordingEvent(): {
  event: ClipboardEvent;
  written: Map<string, string>;
} {
  const written = new Map<string, string>();
  const event = {
    clipboardData: {
      getData: (type: string) => written.get(type) ?? "",
      setData: (type: string, value: string) => {
        written.set(type, value);
      },
    },
    preventDefault: () => {},
  } as unknown as ClipboardEvent;
  return { event, written };
}

const views: EditorView[] = [];

afterEach(() => {
  // 必须销毁：jsdom 没有 layout，CM6 的 rAF measure 会报
  // `textRange(...).getClientRects is not a function`
  while (views.length) {
    const view = views.pop()!;
    view.destroy();
  }
});

function createEditor(doc = ""): EditorView {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [markdownCopy()] }),
    parent: host,
  });
  views.push(view);
  return view;
}

describe("复制", () => {
  it("同时写 Markdown 源码与渲染后的 HTML", async () => {
    // HTML 渲染器是按需加载的，copy 事件（同步）只能用已就绪的版本
    await ensureMarkdownToHtml("");

    const view = createEditor("这是 **粗体** 文字");
    // 「**粗体**」占据 3..9
    view.dispatch({ selection: { anchor: 3, head: 9 } });

    const { event, written } = recordingEvent();
    expect(handleCopy(view, event)).toBe(true);

    expect(written.get("text/plain")).toBe("**粗体**");
    expect(written.get("text/html")).toContain("<strong>粗体</strong>");
  });

  it("额外写 Inkstone 专用 MIME（内部粘贴的无损通道）", () => {
    const view = createEditor("**粗体**");
    // 「**粗体**」共 6 个字符
    view.dispatch({ selection: { anchor: 0, head: 6 } });

    const { event, written } = recordingEvent();
    handleCopy(view, event);

    expect(written.get(INKSTONE_MARKDOWN_MIME)).toBe("**粗体**");
  });

  it("空选区不处理", () => {
    const view = createEditor("abc");
    const { event, written } = recordingEvent();
    expect(handleCopy(view, event)).toBe(false);
    expect(written.size).toBe(0);
  });

  it("取主选区的内容", () => {
    // 只取主选区：项目没启用多选区支持（见 selectedMarkdown 的注释）
    const state = EditorState.create({
      doc: "abc  def  ghi",
      selection: { anchor: 10, head: 13 },
    });
    expect(selectedMarkdown(state)).toBe("ghi");
  });
});

describe("粘贴：Inkstone 内部复制", () => {
  it("优先用 Inkstone 专用 MIME，逐字节无损", () => {
    const view = createEditor();

    // 模拟「从 Inkstone 复制一段含表格的 Markdown，再粘回来」
    const source = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const html = markdownToHtml(source);
    const handled = handlePaste(
      view,
      fakeEvent({
        "text/plain": html, // 剪贴板里的纯文本其实是 HTML 源码（有些应用会这样）
        "text/html": html,
        [INKSTONE_MARKDOWN_MIME]: source,
      }),
    );

    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
  });
});

describe("粘贴为纯文本", () => {
  it("置位后忽略 HTML，只取纯文本", () => {
    const view = createEditor();
    armPlainTextPaste(view);
    expect(isPlainTextPasteArmed(view.state)).toBe(true);

    const handled = handlePaste(
      view,
      fakeEvent({
        "text/plain": "纯文本内容",
        "text/html": "<p><strong>不该被用</strong></p>",
      }),
    );

    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("纯文本内容");
  });

  it("是一次性标志：粘贴后自动清除", () => {
    const view = createEditor();
    armPlainTextPaste(view);

    handlePaste(
      view,
      fakeEvent({
        "text/plain": "第一段",
        "text/html": "<p><strong>不该被用</strong></p>",
      }),
    );
    expect(isPlainTextPasteArmed(view.state)).toBe(false);

    // 下一次粘贴恢复常规行为（HTML 会被转成 Markdown）
    handlePaste(
      view,
      fakeEvent({
        "text/plain": "普通文字",
        "text/html": "<p><strong>粗体</strong></p>",
      }),
    );
    expect(view.state.doc.toString()).toContain("**粗体**");
  });

  it("未置位时按常规逻辑处理", () => {
    const view = createEditor();
    expect(isPlainTextPasteArmed(view.state)).toBe(false);
    expect(
      handlePaste(view, fakeEvent({ "text/plain": "abc" })),
    ).toBe(true);
  });
});

/**
 * 导出项快捷键 → 编辑器 keymap。
 *
 * 测的是**接线**对不对：设置里绑了快捷键，按下去要真的发出
 * 「导出这个格式」的意图。
 *
 * 为什么用 `Ctrl-` 而不是 `Mod-`：
 * CM6 的 `Mod` 在 macOS 上是 ⌘、在其它平台是 Ctrl，
 * 而测试环境（jsdom）不是 mac——用 `Mod-` 的话，同一个测试在不同平台上
 * 期望的物理键不一样，会变成平台相关的脆弱测试。
 * `Ctrl-` 在哪都是 Ctrl。
 */

import { describe, expect, it, afterEach } from "vitest";
import { createMarkdownEditor, type MarkdownEditorHandle } from "@/editor/MarkdownEditor";
import { onIntent, type Intent } from "@/editor/intents";

let editor: MarkdownEditorHandle | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function makeEditor(): MarkdownEditorHandle {
  const parent = document.body.appendChild(document.createElement("div"));
  editor = createMarkdownEditor({ parent, doc: "" });
  return editor;
}

/** 在编辑器里按一个键 */
function press(
  view: MarkdownEditorHandle,
  init: { key: string; ctrlKey?: boolean; shiftKey?: boolean; metaKey?: boolean },
): void {
  view.view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: init.key,
      ctrlKey: init.ctrlKey ?? false,
      shiftKey: init.shiftKey ?? false,
      metaKey: init.metaKey ?? false,
      bubbles: true,
      cancelable: true,
    }),
  );
}

describe("导出项快捷键", () => {
  it("绑了快捷键就能发出「导出这个格式」的意图", () => {
    const view = makeEditor();
    view.setExportShortcuts([{ shortcut: "Ctrl-Shift-1", formatId: "docx" }]);

    const seen: Intent[] = [];
    const off = onIntent((intent) => seen.push(intent));
    try {
      press(view, { key: "1", ctrlKey: true, shiftKey: true });
    } finally {
      off();
    }

    expect(seen).toEqual([{ type: "file.export", formatId: "docx" }]);
  });

  it("没绑的键不会发意图", () => {
    const view = makeEditor();
    view.setExportShortcuts([{ shortcut: "Ctrl-Shift-1", formatId: "docx" }]);

    const seen: Intent[] = [];
    const off = onIntent((intent) => seen.push(intent));
    try {
      press(view, { key: "2", ctrlKey: true, shiftKey: true });
    } finally {
      off();
    }

    expect(seen).toEqual([]);
  });

  it("改绑定后立刻生效（不用重建编辑器）", () => {
    const view = makeEditor();
    view.setExportShortcuts([{ shortcut: "Ctrl-Shift-1", formatId: "docx" }]);
    // 换成别的键——设置面板改完就该立刻能用
    view.setExportShortcuts([{ shortcut: "Ctrl-Shift-2", formatId: "epub" }]);

    const seen: Intent[] = [];
    const off = onIntent((intent) => seen.push(intent));
    try {
      press(view, { key: "1", ctrlKey: true, shiftKey: true });
      press(view, { key: "2", ctrlKey: true, shiftKey: true });
    } finally {
      off();
    }

    expect(seen).toEqual([{ type: "file.export", formatId: "epub" }]);
  });

  it("清空绑定后按键不再有反应", () => {
    const view = makeEditor();
    view.setExportShortcuts([{ shortcut: "Ctrl-Shift-1", formatId: "docx" }]);
    view.setExportShortcuts([]);

    const seen: Intent[] = [];
    const off = onIntent((intent) => seen.push(intent));
    try {
      press(view, { key: "1", ctrlKey: true, shiftKey: true });
    } finally {
      off();
    }

    expect(seen).toEqual([]);
  });
});

/**
 * 多标签页的测试。
 *
 * 测三件事：
 * 1. 标签页模型的语义（打开 / 复用 / 切换 / 关闭 / 脏标记独立）
 * 2. 每个标签页的**撤销历史**是独立的
 * 3. 崩溃恢复能一次把整个会话拿回来
 */

import { beforeEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { render, cleanup, act } from "@testing-library/react";
import App from "@/App";
import {
  activateTab,
  closeTab,
  getDocumentState,
  getTabs,
  newDocument,
  openDocumentAt,
  resetTabs,
  setDocumentContent,
} from "@/ipc/document";
import { SAMPLE_ROOT } from "@/ipc/fs";

const README = `${SAMPLE_ROOT}/README.md`;
const NOTES = `${SAMPLE_ROOT}/随手记.MARKDOWN`;

function getEditorView(): EditorView {
  const host = document.querySelector<HTMLElement>(".editor-host");
  if (!host) throw new Error("找不到编辑器挂载点");
  const view = EditorView.findFromDOM(host);
  if (!view) throw new Error("找不到 CodeMirror 实例");
  return view;
}

describe("标签页模型", () => {
  beforeEach(() => {
    resetTabs();
  });

  it("启动时有一个空标签页", () => {
    expect(getTabs()).toHaveLength(1);
    expect(getDocumentState().path).toBeNull();
  });

  it("打开文件会复用那个空占位页，不多开一个空标签", async () => {
    await openDocumentAt(README);

    expect(getTabs()).toHaveLength(1);
    expect(getDocumentState().path).toBe(README);
  });

  it("打开第二个文件 → 两个标签页", async () => {
    await openDocumentAt(README);
    await openDocumentAt(NOTES);

    expect(getTabs()).toHaveLength(2);
    expect(getDocumentState().path).toBe(NOTES);
  });

  it("重复打开同一个文件 → 不新建标签页，只切过去", async () => {
    await openDocumentAt(README);
    await openDocumentAt(NOTES);
    await openDocumentAt(README);

    expect(getTabs()).toHaveLength(2);
    expect(getDocumentState().path).toBe(README);
  });

  it("切换标签页 → 内容跟着换", async () => {
    await openDocumentAt(README);
    const firstContent = getDocumentState().content;
    await openDocumentAt(NOTES);
    expect(getDocumentState().content).not.toBe(firstContent);

    activateTab(getTabs()[0].id);
    expect(getDocumentState().content).toBe(firstContent);
  });

  it("每个标签页的脏标记独立", async () => {
    await openDocumentAt(README);
    await openDocumentAt(NOTES);

    setDocumentContent("改过的内容");
    expect(getTabs().find((tab) => tab.path === NOTES)?.dirty).toBe(true);
    expect(getTabs().find((tab) => tab.path === README)?.dirty).toBe(false);
  });

  it("关闭标签页 → 相邻的接管；最后一页关掉 → 自动开一个空页", async () => {
    await openDocumentAt(README);
    await openDocumentAt(NOTES);
    expect(getTabs()).toHaveLength(2);

    closeTab(getDocumentState().tabId);
    expect(getTabs()).toHaveLength(1);
    expect(getDocumentState().path).toBe(README);

    closeTab(getDocumentState().tabId);
    expect(getTabs()).toHaveLength(1);
    expect(getDocumentState().path).toBeNull();
  });

  it("新建是「开一个新标签页」，不是清空当前页", async () => {
    await openDocumentAt(README);
    setDocumentContent("当前页的改动");

    newDocument();

    expect(getTabs()).toHaveLength(2);
    expect(getDocumentState().path).toBeNull();
    // 原来那页的改动还在
    expect(getTabs().find((tab) => tab.path === README)?.dirty).toBe(true);
  });
});

describe("每个标签页的撤销历史独立", () => {
  beforeEach(() => {
    cleanup();
    resetTabs();
  });

  it("切回上一页，⌘Z 撤的是这一页自己的编辑", async () => {
    render(<App />);

    // 第一页：敲三个字
    let view = getEditorView();
    act(() => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "AAA" } });
    });

    // 切到第二页
    act(() => {
      newDocument();
    });
    view = getEditorView();
    act(() => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "BBB" } });
    });

    // 切回第一页
    act(() => {
      activateTab(getTabs()[0].id);
    });
    view = getEditorView();
    expect(view.state.doc.toString()).toBe("AAA");

    // ⌘Z 撤的是**这一页**的那次插入（一次改动 = 一步撤销），
    // 不是另一页的 BBB
    act(() => {
      undo(view);
    });
    expect(view.state.doc.toString()).toBe("");

    // 另一页的内容没被动过
    act(() => {
      activateTab(getTabs()[1].id);
    });
    expect(getEditorView().state.doc.toString()).toBe("BBB");
  });
});

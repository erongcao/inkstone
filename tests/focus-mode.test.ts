/**
 * 焦点模式 / 打字机模式的测试。
 *
 * 两个功能都**只影响呈现**，不碰文档内容——
 * 所以核心断言是「文档一字未动」+「弱化范围正好是光标所在段落之外」。
 * 打字机模式的**滚动量**在 jsdom 里量不出来（没有布局引擎，lineBlockAt 返回 null），
 * 那部分不在这里假装测过，列为人工验证项。
 */

import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { history, undoDepth } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { focusMode, focusModeField, setFocusModeOf } from "@/editor/focus-mode";
import { livePreview } from "@/editor/live-preview";
import {
  typewriter,
  setTypewriterModeOf,
  typewriterModeField,
} from "@/editor/typewriter";

const DOC = [
  "# 第一章", // 1
  "", // 2
  "第一段。", // 3
  "", // 4
  "第二段。", // 5
  "", // 6
  "## 第二节", // 7
  "", // 8
  "第三段。", // 9
].join("\n");

/**
 * 造一个挂了这些扩展的编辑器。
 *
 * 必须带 `livePreview()`：焦点模式要读 `livePreviewField` 里的语法树来定位
 * 「当前块」，没有它就等于在没有语法的编辑器上跑。
 */
function createEditor(doc = DOC): EditorView {
  const parent = document.body.appendChild(document.createElement("div"));
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: [history(), livePreview(), focusMode(), typewriter()],
    }),
    parent,
  });
}

/** 某一行渲染出来的 class 列表 */
function classesOfLine(view: EditorView, lineNumber: number): string[] {
  const line = view.state.doc.line(lineNumber);
  let node: Node | null = view.domAtPos(line.from).node;
  while (node && !(node instanceof HTMLElement && node.classList.contains("cm-line"))) {
    node = node.parentNode;
  }
  return node instanceof HTMLElement ? [...node.classList] : [];
}

/** 被弱化的行号 */
function dimmedLines(view: EditorView): number[] {
  const out: number[] = [];
  for (let n = 1; n <= view.state.doc.lines; n++) {
    if (classesOfLine(view, n).includes("cm-focus-dim")) out.push(n);
  }
  return out;
}

describe("焦点模式：弱化范围", () => {
  it("默认关闭时没有任何弱化", () => {
    const view = createEditor();
    expect(view.state.field(focusModeField)).toBe(false);
    expect(dimmedLines(view)).toEqual([]);
    view.destroy();
  });

  it("光标在段落里：只弱化该段落之外的行", () => {
    const view = createEditor();
    setFocusModeOf(view, true);
    view.dispatch({ selection: { anchor: DOC.indexOf("第二段") + 1 } });

    // 亮区 = 「# 第一章」+「第二段」两处；标题与当前段落之间的内容仍然弱化
    expect(dimmedLines(view)).toEqual([2, 3, 4, 6, 7, 8, 9]);
    view.destroy();
  });

  it("当前段落上最近的标题也保持点亮（用户不会失去结构感）", () => {
    const view = createEditor();
    setFocusModeOf(view, true);
    view.dispatch({ selection: { anchor: DOC.indexOf("第三段") + 1 } });

    // 亮区 =「## 第二节」+「第三段」；更上面的 # 第一章 属于上一节，弱化
    expect(dimmedLines(view)).toEqual([1, 2, 3, 4, 5, 6, 8]);
    view.destroy();
  });

  it("光标移动后弱化范围跟着变", () => {
    const view = createEditor();
    setFocusModeOf(view, true);
    view.dispatch({ selection: { anchor: DOC.indexOf("第一段") + 1 } });
    expect(dimmedLines(view)).not.toContain(3);

    view.dispatch({ selection: { anchor: DOC.indexOf("第三段") + 1 } });
    expect(dimmedLines(view)).toContain(3);
    view.destroy();
  });

  it("关闭后弱化消失", () => {
    const view = createEditor();
    setFocusModeOf(view, true);
    view.dispatch({ selection: { anchor: DOC.indexOf("第二段") + 1 } });
    expect(dimmedLines(view).length).toBeGreaterThan(0);
    setFocusModeOf(view, false);
    expect(dimmedLines(view)).toEqual([]);
    view.destroy();
  });
});

describe("焦点模式 / 打字机模式：不碰文档", () => {
  it("开关焦点模式不改动文档内容", () => {
    const view = createEditor();
    const before = view.state.doc.toString();
    setFocusModeOf(view, true);
    setFocusModeOf(view, false);
    expect(view.state.doc.toString()).toBe(before);
    view.destroy();
  });

  it("开关走 effect，不产生 undo 历史", () => {
    const view = createEditor();
    const depthBefore = undoDepth(view.state);
    setFocusModeOf(view, true);
    expect(undoDepth(view.state)).toBe(depthBefore);
    view.destroy();
  });

  it("空文档下不会死循环或抛错", () => {
    const view = createEditor("");
    setFocusModeOf(view, true);
    view.dispatch({ selection: { anchor: 0 } });
    expect(() => view.destroy()).not.toThrow();
  });
});

describe("打字机模式", () => {
  it("默认关闭", () => {
    const view = createEditor();
    expect(view.state.field(typewriterModeField)).toBe(false);
    view.destroy();
  });

  it("可以开关，且不改动文档", () => {
    const view = createEditor();
    const before = view.state.doc.toString();
    setTypewriterModeOf(view, true);
    expect(view.state.field(typewriterModeField)).toBe(true);
    setTypewriterModeOf(view, false);
    expect(view.state.field(typewriterModeField)).toBe(false);
    expect(view.state.doc.toString()).toBe(before);
    view.destroy();
  });

  it("开启时滚动监听已挂上、销毁时解绑", () => {
    const view = createEditor();
    setTypewriterModeOf(view, true);
    // jsdom 里没有布局，centerCursor 会因为 lineBlockAt 返回 null 而直接返回——
    // 这条只保证「开着也不会抛错」，滚动效果属于人工验证项
    expect(() => view.destroy()).not.toThrow();
  });
});

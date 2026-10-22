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
import { isBlockExpanded, hasClosingFence } from "@/editor/live-preview/decorations";
import type { BlockMatch } from "@/editor/render/types";
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

/* ═══════════════════════════════════════════════════════════
 * 未闭合围栏必须保持展开
 * ═══════════════════════════════════════════════════════════ */

/**
 * 回归测试：M2-4 验证 mermaid 时撞上的**既有严重 bug**。
 *
 * 现象（生产构建、空文档）：敲完 ` ```js ` 三个字符后，编辑器里只剩一个
 * 空的 `<pre class="cm-md-code" data-language="js">`，再打任何字符都无效——
 * 也就是**根本没法用键盘敲出一个代码块**。
 *
 * 原因：未闭合的围栏，lezer 把它一直算到文档末尾，于是光标正好落在
 * `match.to`；而 `isBlockExpanded` 是严格开区间，判成「不在块内」→ 块收起。
 * 块 widget 是 `contenteditable="false"`，接着打的字全部丢失。
 */
describe("块展开规则：写到一半的块", () => {
  const block = (from: number, to: number): BlockMatch => ({
    from,
    to,
    kind: "code",
    language: "js",
    content: "",
  });

  it("闭合围栏：光标在块尾仍收起（与 Typora 一致）", () => {
    const source = "```js\nconst a = 1;\n```";
    const match = block(0, source.length);
    expect(isBlockExpanded(match, match.to, source)).toBe(false);
  });

  it("闭合围栏且后面还有别的行：光标在下一行开头也收起", () => {
    const fence = "```js\nconst a = 1;\n```";
    const source = `${fence}\n\n后面段落`;
    const match = block(0, fence.length);
    expect(isBlockExpanded(match, match.to, source)).toBe(false);
  });

  it("未闭合围栏：光标在块尾（= 文档末尾）必须保持展开", () => {
    const source = "```js";
    const match = block(0, source.length);
    expect(isBlockExpanded(match, match.to, source)).toBe(true);
  });

  it("未闭合围栏且已经敲了几行内容：块尾仍然算块内", () => {
    const source = "```mermaid\ngraph TD\n  A-->B";
    const match = block(0, source.length);
    expect(isBlockExpanded(match, match.to, source)).toBe(true);
  });

  it("块内任意位置都展开（原有规则没被破坏）", () => {
    const source = "```js\nconst a = 1;\n```";
    const match = block(0, source.length);
    expect(isBlockExpanded(match, 3, source)).toBe(true);
  });

  it("块首不展开（打开文件时第一个代码块是收起的）", () => {
    const source = "```js\nconst a = 1;\n```";
    expect(isBlockExpanded(block(0, source.length), 0, source)).toBe(false);
  });

  it("闭合判定：末行只有围栏才算闭合", () => {
    expect(hasClosingFence("```js\ncode\n```")).toBe(true);
    expect(hasClosingFence("```js\ncode\n```\n")).toBe(true);
    expect(hasClosingFence("~~~py\ncode\n~~~")).toBe(true);
    expect(hasClosingFence("```js")).toBe(false); // 带语言标识的开围栏
    expect(hasClosingFence("```js\ngraph TD")).toBe(false);
    expect(hasClosingFence("$$x$$")).toBe(false); // 非围栏块一律视为未闭合
  });
});

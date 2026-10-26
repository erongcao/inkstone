/**
 * Mermaid 图表的护栏测试。
 *
 * 测三块：
 *   1. **定位**——只认 `mermaid` 围栏，且必须让开已被别的渲染器认走的区间
 *   2. **缓存与防抖**——同一份代码不重复渲染；渲染失败也要进缓存
 *   3. **主题**——明暗两套 SVG 必须分开缓存
 *
 * `mermaid.render()` 本身不在这里驱动：它要真实 DOM 与布局引擎，
 * jsdom 里跑不出结果（第一版试过，产出的是空 SVG）。
 * 那部分靠生产构建的浏览器实测。
 *
 * 但「失败也要进缓存」这一条可以在 jsdom 里验——它恰恰是渲染失败时最容易漏掉的分支，
 * 漏了的后果是用户每敲一个字都重新发起一次加载，永远等不到结果。
 */

import { describe, expect, it, beforeEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import type { Tree } from "@lezer/common";
import { findMermaidBlocks } from "@/editor/render/mermaid";
import {
  currentMode,
  flushDiagramQueue,
  renderDiagram,
  resetDiagramCache,
} from "@/editor/render/mermaid-loader";
import { gfmMarkdownLanguage } from "@/editor/markdown-language";

/** 建状态并取语法树（与编辑器里用的是同一个 Language 定义） */
function treeOf(doc: string): Tree {
  const state = EditorState.create({
    doc,
    extensions: [gfmMarkdownLanguage],
  });
  // `ensureSyntaxTree(state, upto, timeout)` 的第二个参数是**位置**，不是 Language。
  // 之前这里传的是 `gfmMarkdownLanguage`——它靠「Language >= number 恒为 false」
  // 这个巧合退化成了「解析整篇」，测试是绿的，但调用方式是错的。
  const tree = ensureSyntaxTree(state, state.doc.length, 10_000);
  if (!tree) throw new Error("语法树没建起来");
  return tree;
}

const DOC = [
  "```mermaid",
  "graph TD",
  "  A-->B",
  "```",
  "",
  "```js",
  "const a = 1;",
  "```",
  "",
  "```",
  "纯文本围栏",
  "```",
].join("\n");

describe("Mermaid 定位", () => {
  it("只认 mermaid 围栏，js 与无语言的围栏不管", () => {
    const matches = findMermaidBlocks(treeOf(DOC), DOC);
    expect(matches).toHaveLength(1);
    expect(matches[0].content).toContain("graph TD");
    expect(matches[0].kind).toBe("mermaid");
  });

  it("语言标识大小写不敏感", () => {
    const text = "```Mermaid\ngraph TD\n A-->B\n```";
    expect(findMermaidBlocks(treeOf(text), text)).toHaveLength(1);
  });

  it("`mermaid {theme: dark}` 这类带参数的写法也认", () => {
    const text = "```mermaid {theme: dark}\ngraph TD\n A-->B\n```";
    expect(findMermaidBlocks(treeOf(text), text)).toHaveLength(1);
  });

  it("让开已被别的渲染器认走的区间（否则同一段会被渲染两次）", () => {
    const text = "```mermaid\ngraph TD\n A-->B\n```";
    const [match] = findMermaidBlocks(treeOf(text), text);
    expect(match).toBeDefined();
    const again = findMermaidBlocks(treeOf(text), text, [
      { from: match.from, to: match.to },
    ]);
    expect(again).toHaveLength(0);
  });

  it("互不相交的 claimed 区间不影响识别", () => {
    // 前面有一段普通文字，先注册渲染器会认走它；
    // 后面的 mermaid 围栏与它不相交，必须照常识别出来。
    const text = "普通段落\n\n```mermaid\ngraph TD\n A-->B\n```";
    const paragraph = findMermaidBlocks(treeOf(text), text);
    expect(paragraph).toHaveLength(1);

    const claimed = { from: 0, to: 4 }; // 「普通段落」
    expect(findMermaidBlocks(treeOf(text), text, [claimed])).toHaveLength(1);
  });

  it("部分重叠也算占用（不能只比端点）", () => {
    const text = "```mermaid\ngraph TD\n A-->B\n```";
    const [match] = findMermaidBlocks(treeOf(text), text);
    const partial = [{ from: match.from, to: match.from + 3 }];
    expect(findMermaidBlocks(treeOf(text), text, partial)).toHaveLength(0);
  });
});

describe("Mermaid 缓存与防抖", () => {
  beforeEach(() => {
    resetDiagramCache();
    document.documentElement.dataset.mode = "light";
  });

  it("第一次请求返回 null（还没渲染好），块先保持源码形态", () => {
    expect(renderDiagram("graph TD\n A-->B")).toBeNull();
  });

  it("空白内容直接返回 null 且不排队", () => {
    expect(renderDiagram("   \n  ")).toBeNull();
  });

  it("渲染完成后再取会命中缓存，不再返回 null", async () => {
    const code = "graph TD\n  A-->B";
    renderDiagram(code);
    await flushDiagramQueue();
    expect(renderDiagram(code)).not.toBeNull();
  });

  it("渲染失败也必须进缓存，并带 ok: false（否则每击键都重新加载）", async () => {
    const code = "这不是合法的 mermaid 源码";
    renderDiagram(code);
    await flushDiagramQueue();
    const result = renderDiagram(code);
    expect(result).not.toBeNull();
    expect(result?.ok).toBe(false);
    expect(typeof result?.output).toBe("string");
    expect(result?.output.length).toBeGreaterThan(0);
  });

  it("缓存键含内容：改了图就重新排队", async () => {
    renderDiagram("graph TD\n A-->B");
    await flushDiagramQueue();
    expect(renderDiagram("graph TD\n A-->C")).toBeNull();
  });
});

describe("Mermaid 主题", () => {
  beforeEach(() => {
    resetDiagramCache();
    document.documentElement.dataset.mode = "light";
  });

  it("当前模式跟随 <html data-mode>", () => {
    document.documentElement.dataset.mode = "dark";
    expect(currentMode()).toBe("dark");
    document.documentElement.dataset.mode = "light";
    expect(currentMode()).toBe("light");
    document.documentElement.dataset.mode = "auto";
    expect(currentMode()).toBe("light");
  });

  it("主题是缓存键的一部分：同一段代码换主题要重画", async () => {
    const code = "graph TD\n  A-->B";
    renderDiagram(code);
    await flushDiagramQueue();

    document.documentElement.dataset.mode = "dark";
    expect(renderDiagram(code)).toBeNull(); // 未命中 → 重新排队
    await flushDiagramQueue();
    document.documentElement.dataset.mode = "light";
  });
});
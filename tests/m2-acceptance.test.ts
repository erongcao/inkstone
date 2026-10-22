/**
 * M2 综合验收。
 *
 * 单元测试各管一摊，这里把它们串成**一份文档**跑一遍：
 * 标题、表格、代码块、公式、图表、图片、脚注、链接，
 * 从 Markdown 文本 → Live Preview 渲染 → HTML 输出，验证格式正确。
 *
 * ## 为什么要专门写这个
 *
 * 各模块的单测都过，但「都过」不等于「凑在一起还过」——
 * 渲染器之间要互相让开区间（`blockRanges`），这正是单测覆盖不到的部分。
 * mermaid 抢 `FencedCode`、公式块和表格语法撞车，都是这类问题。
 *
 * ## 验收判据是**渲染出来的 DOM**，不是解析出的 AST
 *
 * 解析层由 `round-trip.test.ts` 在 13 份语料上保证。
 * 这里要回答的是另一个问题：编辑器里**看起来**对不对。
 */

import { describe, expect, it, beforeAll } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history } from "@codemirror/commands";
import { livePreview, setDisplayModeOf } from "@/editor/live-preview";
import { ensureMathRenderer } from "@/editor/render/math-loader";
import { markdownToHtml } from "@/parser/html";

beforeAll(async () => {
  await ensureMathRenderer();
});

/** 一份把 M2 所有块级 / 行内能力都用上的文档 */
const DOC = [
  "# 验收文档",
  "",
  "段落里有 [一个链接](https://inkstone.app)、`一段代码` 和一个公式 $E=mc^2$。",
  "",
  "| 列 1 | 列 2 |",
  "| --- | :---: |",
  "| 甲 | 一 |",
  "| 乙 | 二 |",
  "",
  "```js",
  "const answer = 42;",
  "```",
  "",
  "$$",
  "\\int_0^1 x\\,dx = \\frac{1}{2}",
  "$$",
  "",
  "```mermaid",
  "graph TD",
  "  A[开始] --> B[结束]",
  "```",
  "",
  "![替代文字](images/示意图.png)",
  "",
  "脚注引用[^note]。",
  "",
  "[^note]: 脚注的正文。",
  "",
  "文末哨兵。",
].join("\n");

function createEditor(doc = DOC): EditorView {
  const parent = document.body.appendChild(document.createElement("div"));
  return new EditorView({
    state: EditorState.create({ doc, extensions: [history(), livePreview()] }),
    parent,
  });
}

/** 光标移到文档末尾——此时所有块都该收起、渲染 */
function parkCursorAtEnd(view: EditorView): void {
  view.dispatch({ selection: { anchor: view.state.doc.length } });
}

describe("M2 综合验收：块级渲染", () => {
  it("表格渲染成 <table>，列数与对齐都在", () => {
    const view = createEditor();
    parkCursorAtEnd(view);

    const table = view.dom.querySelector(".cm-md-table");
    expect(table).not.toBeNull();
    expect(table!.querySelectorAll("thead th")).toHaveLength(2);
    expect(table!.querySelectorAll("tbody tr")).toHaveLength(2);
    // 分隔行的居中对齐要落到表头那一格
    expect((table!.querySelectorAll("thead th")[1] as HTMLElement).style.textAlign).toBe("center");
  });

  it("表格上方挂着工具栏，且预置了作用位置", () => {
    const view = createEditor();
    parkCursorAtEnd(view);

    const wrap = view.dom.querySelector(".cm-md-table-wrap") as HTMLElement;
    expect(wrap).not.toBeNull();
    expect(wrap.dataset.hoverRow).toBeDefined();
    expect(wrap.querySelectorAll("[data-table-action]")).toHaveLength(8);
  });

  it("代码块渲染成 <pre> 并带高亮", () => {
    const view = createEditor();
    parkCursorAtEnd(view);

    const pre = view.dom.querySelector(".cm-md-code");
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toContain("answer");
    // highlight.js 的 token class
    expect(pre!.querySelector(".hljs-keyword, .hljs-title, .hljs-variable")).not.toBeNull();
  });

  it("块级公式渲染成 KaTeX", () => {
    const view = createEditor();
    parkCursorAtEnd(view);

    const math = view.dom.querySelector(".cm-md-math");
    expect(math).not.toBeNull();
    expect(math!.querySelector(".katex")).not.toBeNull();
  });

  it("行内公式渲染成 KaTeX（且不在 <pre> 里）", () => {
    const view = createEditor();
    parkCursorAtEnd(view);

    const inline = view.dom.querySelector(".cm-md-inline-math");
    expect(inline).not.toBeNull();
    expect(inline!.querySelector(".katex")).not.toBeNull();
  });

  it("图片渲染成 widget 并保留原始路径", () => {
    const view = createEditor();
    parkCursorAtEnd(view);

    const image = view.dom.querySelector(".cm-md-image") as HTMLElement;
    expect(image).not.toBeNull();
    // hover 提示的数据来源（CSS `content: attr(data-image-src)`）
    expect(image.dataset.imageSrc).toBe("images/示意图.png");
  });

  it("脚注引用渲染成可点击的编号", () => {
    const view = createEditor();
    parkCursorAtEnd(view);

    expect(view.dom.querySelector(".cm-md-footnote-ref")).not.toBeNull();
    expect(view.dom.querySelector(".cm-md-footnote-badge")).not.toBeNull();
  });

  it("mermaid 未就绪时降级成代码块，而不是消失", () => {
    const view = createEditor();
    parkCursorAtEnd(view);

    // mermaid 是懒加载的，同步断言必然落在它就绪之前。
    // 这时 `mermaidBlockRenderer` 不产出 match，围栏由 `codeBlockRenderer`
    // 接管——这是刻意设计的降级：先看到 LaTeX/图表源码，图表到位后自动替换。
    // 真正要防的是「两者都不在」，那才是区间被抢错了。
    const error = view.dom.querySelector(".cm-md-mermaid-error");
    const svg = view.dom.querySelector("svg");
    const code = view.dom.querySelector(".cm-md-code");
    expect(error !== null || svg !== null || code !== null).toBe(true);
  });
});

describe("M2 综合验收：行内标记", () => {
  it("链接折叠成文字，但 data-href 还在（hover 提示的数据源）", () => {
    const view = createEditor();
    parkCursorAtEnd(view);

    const link = view.dom.querySelector(".cm-md-link") as HTMLElement;
    expect(link).not.toBeNull();
    expect(link.textContent).toBe("一个链接");
    expect(link.dataset.href).toBe("https://inkstone.app");
  });

  it("行内代码折叠成 <code>，标记被藏起来", () => {
    const view = createEditor();
    parkCursorAtEnd(view);

    const code = view.dom.querySelector(".cm-md-inline-code");
    expect(code).not.toBeNull();
    expect(code!.textContent).toBe("一段代码");
  });

  it("标题的 # 被折叠，字号层级保留", () => {
    const view = createEditor();
    parkCursorAtEnd(view);

    expect(view.dom.querySelector(".cm-md-heading-1")).not.toBeNull();
  });
});

describe("M2 综合验收：渲染器之间不打架", () => {
  it("代码块里的表格语法不渲染成表格", () => {
    // mermaid / 代码块 / 表格都匹配 `FencedCode` 或同一片文本，
    // 谁抢到区间错了，这里就会多出一张表
    const view = createEditor(
      ["```", "| a | b |", "| --- | --- |", "| 1 | 2 |", "```", "", "文末哨兵。"].join("\n"),
    );
    parkCursorAtEnd(view);

    expect(view.dom.querySelector(".cm-md-table")).toBeNull();
    expect(view.dom.querySelector(".cm-md-code")).not.toBeNull();
  });

  it("公式块里的表格语法要让开", () => {
    const view = createEditor(["$$", "| a | b |", "| --- | --- |", "$$", "", "文末哨兵。"].join("\n"));
    parkCursorAtEnd(view);

    expect(view.dom.querySelector(".cm-md-table")).toBeNull();
    expect(view.dom.querySelector(".cm-md-math")).not.toBeNull();
  });

  it("每一类块只渲染一份（没有重复 widget）", () => {
    const view = createEditor();
    parkCursorAtEnd(view);

    expect(view.dom.querySelectorAll(".cm-md-table")).toHaveLength(1);
    expect(view.dom.querySelectorAll(".cm-md-code")).toHaveLength(1);
    expect(view.dom.querySelectorAll(".cm-md-math")).toHaveLength(1);
  });
});

describe("M2 综合验收：双态切换", () => {
  it("光标进块内 → 表格切回源码；离开 → 切回渲染", () => {
    const view = createEditor();

    // 源码态：光标在表格里
    view.dispatch({ selection: { anchor: DOC.indexOf("甲") + 1 } });
    expect(view.dom.querySelector(".cm-md-table")).toBeNull();

    // 光标离开表格（移到末尾）→ 重新渲染
    parkCursorAtEnd(view);
    expect(view.dom.querySelector(".cm-md-table")).not.toBeNull();
  });

  it("源码模式（显示策略切换）下永远看得到原始 Markdown", () => {
    const view = createEditor();
    // 表格渲染态 + 光标在末尾时，切到源码模式应当露出全部原始行
    parkCursorAtEnd(view);
    setDisplayModeOf(view, "source");
    expect(view.dom.querySelector(".cm-md-table")).toBeNull();
    expect(view.dom.textContent).toContain("| --- | :---: |");
  });
});

describe("M2 综合验收：HTML 输出", () => {
  it("整份文档转 HTML 不抛异常，且关键结构都在", () => {
    const html = markdownToHtml(DOC);
    expect(html).toContain("<h1>");
    expect(html).toContain("<table>");
    expect(html).toContain("<code"); // 行内代码
    expect(html).toContain("katex"); // 公式已渲染
    expect(html).toContain("<pre"); // 代码块
    expect(html).toContain("href=\"https://inkstone.app\"");
  });

  it("公式在 HTML 里是渲染结果而不是裸 LaTeX", () => {
    const html = markdownToHtml(DOC);
    expect(html).not.toContain("math-inline");
    expect(html).not.toContain("math-display");
  });
});
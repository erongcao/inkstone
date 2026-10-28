/**
 * 块级渲染的护栏测试。
 *
 * 覆盖三件事：
 *   1. 代码块的定位（lezer 的 FencedCode 节点 → 位置 + 语言 + 内容）
 *   2. 渲染结果（highlight.js 高亮的 DOM）
 *   3. **展开判定**：光标在块外 → 渲染成 widget；光标在块内 → 显示源码
 *
 * 第 3 条是 Typora 式体验的核心契约：
 *   「代码块平时是渲染好的，点一下（或光标进去）就变回可编辑的源码」。
 */

import { describe, expect, it, beforeEach } from "vitest";
import { parseSyntax } from "@/editor/live-preview/syntax";
import { buildLivePreviewDecorations } from "@/editor/live-preview/decorations";
import {
  codeBlockRenderer,
  findCodeBlocks,
  highlightCode,
  resolveLanguage,
} from "@/editor/render/code-block";
import {
  registerBlockRenderer,
  clearBlockRenderers,
  blockRenderers,
} from "@/editor/render/registry";

const DOC = [
  "Intro paragraph.",
  "",
  "```js",
  "function greet(name) {",
  "  return name;",
  "}",
  "```",
  "",
  "Outro text.",
].join("\n");

/** 收集装饰器里「块级替换」的部分 */
function blockRanges(
  source: string,
  cursor: number,
): { from: number; to: number; block: boolean }[] {
  const set = buildLivePreviewDecorations(source, cursor, "live", parseSyntax(source));
  const out: { from: number; to: number; block: boolean }[] = [];
  const it = set.iter();
  while (it.value !== null) {
    const spec = it.value.spec as {
      widget?: unknown;
      block?: boolean;
    };
    if (spec.widget) {
      out.push({ from: it.from, to: it.to, block: spec.block === true });
    }
    it.next();
  }
  return out;
}

beforeEach(() => {
  clearBlockRenderers();
  registerBlockRenderer(codeBlockRenderer);
});

describe("代码块定位", () => {
  it("找出围栏代码块的位置、语言与内容", () => {
    const blocks = findCodeBlocks(parseSyntax(DOC), DOC);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].language).toBe("js");
    // CodeText 节点不含末尾换行
    expect(blocks[0].content).toBe("function greet(name) {\n  return name;\n}");
    expect(DOC.slice(blocks[0].from, blocks[0].to)).toBe(
      "```js\nfunction greet(name) {\n  return name;\n}\n```",
    );
  });

  it("没有语言标注的代码块，language 为 undefined", () => {
    const doc = "```\nplain text\n```";
    const blocks = findCodeBlocks(parseSyntax(doc), doc);
    expect(blocks[0].language).toBeUndefined();
  });

  it("未闭合的围栏延伸到文档末尾（CommonMark 语义）", () => {
    const doc = "para\n\n```js\nnever closed";
    const blocks = findCodeBlocks(parseSyntax(doc), doc);
    expect(blocks).toHaveLength(1);
    // 围栏未闭合 → 代码块一直延伸到文档末尾
    expect(blocks[0].to).toBe(doc.length);
  });
});

describe("语言解析", () => {
  it("常见别名能映射到 highlight.js 语言名", () => {
    expect(resolveLanguage("js")).toBe("javascript");
    expect(resolveLanguage("ts")).toBe("typescript");
    expect(resolveLanguage("sh")).toBe("bash");
    expect(resolveLanguage("yml")).toBe("yaml");
    expect(resolveLanguage("html")).toBe("xml");
  });

  it("认不出的语言返回 null", () => {
    expect(resolveLanguage("brainfuck")).toBeNull();
    expect(resolveLanguage("")).toBeNull();
  });
});

describe("代码高亮", () => {
  it("认不出的语言按纯文本处理（HTML 转义）", () => {
    const html = highlightCode("<script>", null);
    expect(html).toContain("&lt;script&gt;");
  });

  it("输出带 hljs token class 的 HTML", () => {
    const html = highlightCode("const x = 1;", "javascript");
    expect(html).toContain('class="hljs-keyword"');
    expect(html).toContain('class="hljs-number"');
  });

  it("高亮不会把源码当 HTML 注入（尖括号被转义）", () => {
    const html = highlightCode('<img src=x onerror="alert(1)">', "html");
    // 输出里除了 <span>/</span> 之外不该再有任何裸标签
    const stripped = html.replace(/<\/?span[^>]*>/g, "");
    expect(stripped).not.toContain("<");
    expect(html).toContain("&lt;");
  });

  it("未知语言走纯文本分支而不是抛异常", () => {
    expect(() => highlightCode("x = 1", "not-a-language")).not.toThrow();
  });
});

describe("块级渲染的展开判定", () => {
  it("光标在块外 → 块被替换成 widget", () => {
    const ranges = blockRanges(DOC, 0);
    const block = ranges.find((r) => r.block);
    expect(block).toBeDefined();
    expect(block!.from).toBe(DOC.indexOf("```js"));
    expect(block!.to).toBe(
      DOC.indexOf("```js") +
        "```js\nfunction greet(name) {\n  return name;\n}\n```".length,
    );
  });

  it("光标在块内 → 显示源码（不替换）", () => {
    const from = DOC.indexOf("```js");
    const inside = from + 5; // 落在 "function" 里
    const ranges = blockRanges(DOC, inside);
    expect(ranges.find((r) => r.block)).toBeUndefined();
  });

  it("光标正好在块首 → 仍然渲染（打开文件时第一个块是收起的）", () => {
    const from = DOC.indexOf("```js");
    const ranges = blockRanges(DOC, from);
    expect(ranges.find((r) => r.block)).toBeDefined();
  });

  it("光标正好在块尾（下一行开头）→ 仍然渲染", () => {
    const from = DOC.indexOf("```js");
    const to = from + "```js\nfunction greet(name) {\n  return name;\n}\n```".length;
    const ranges = blockRanges(DOC, to);
    expect(ranges.find((r) => r.block)).toBeDefined();
  });
});

describe("渲染器注册表", () => {
  it("同 id 重复注册是幂等的（覆盖而非报错）", () => {
    registerBlockRenderer(codeBlockRenderer);
    registerBlockRenderer(codeBlockRenderer);
    expect(blockRenderers().filter((r) => r.id === "code-block")).toHaveLength(1);
  });
});

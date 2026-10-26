/**
 * HTML 输出链路里的公式渲染。
 *
 * 改之前公式在 HTML 里是 `<code class="language-math">E=mc^2</code>`——
 * 复制到 Word、邮件、任何富文本编辑器里都是一段裸 LaTeX。
 * 这个文件钉住「复制出去的公式和屏幕上看到的是同一套渲染结果」。
 */

import { describe, expect, it, beforeAll } from "vitest";
import { markdownToHtml } from "@/parser/html";
import { ensureMathRenderer } from "@/editor/render/math-loader";

beforeAll(async () => {
  await ensureMathRenderer();
});

describe("公式在 HTML 输出里被渲染", () => {
  it("行内公式不再是裸 LaTeX", () => {
    const html = markdownToHtml("公式 $E=mc^2$ 在这里。");
    expect(html).toContain("katex");
    // 原本的形态：`<code class="language-math math-inline">…</code>`
    expect(html).not.toContain("math-inline");
  });

  it("块级公式用 display 模式", () => {
    const html = markdownToHtml("$$\n\\int_0^1 x dx\n$$");
    expect(html).toContain("katex-display");
    expect(html).not.toContain("math-display");
  });

  it("公式周围的内容不受影响", () => {
    const html = markdownToHtml("前 $x$ 后");
    expect(html).toContain("前 ");
    expect(html).toContain(" 后");
    expect(html).toContain("<p>");
  });

  it("多个公式都渲染", () => {
    const html = markdownToHtml("$a$ 和 $b$");
    expect(html.match(/class="katex"/g)?.length).toBe(2);
  });

  it("没有公式的文档里不注入 KaTeX 样式", () => {
    const html = markdownToHtml("**只是**粗体而已。");
    expect(html).not.toContain("katex");
    expect(html).toContain("<strong>只是</strong>");
  });
});

describe("不该被当公式的东西", () => {
  it("普通代码块不是公式", () => {
    const html = markdownToHtml("```js\nconst a = 1;\n```");
    expect(html).not.toContain("katex");
    expect(html).toContain("const a = 1;");
  });

  it("行内代码不是公式", () => {
    const html = markdownToHtml("用 `$foo` 这种写法");
    expect(html).not.toContain("katex");
    expect(html).toContain("<code>");
  });

  it("默认设置下 $5 和 $6 会被当公式——这是 remark-math 的既有取舍", () => {
    // 单 `$` 默认开启（调研的六个商业编辑器全部如此，见 AGENTS.md「行内公式定界符」）。
    // `价格 $5 和 $6` 长得确实像公式，用户可以在设置里关掉——
    // 关键是关掉之后**编辑器与 HTML 输出必须一起变**，见下面「解析选项」那组用例。
    expect(markdownToHtml("价格是 $5 和 $6")).toContain("katex");
  });

  it("转义的美元符号不触发公式", () => {
    const html = markdownToHtml("价格 \\$5");
    expect(html).not.toContain("katex");
  });
});

describe("解析选项必须透传（红线 3：解析规则唯一）", () => {
  it("关掉单 $ 后，HTML 链路与编辑器保持一致", () => {
    // 回归：HTML 链路曾经自己调 `parseMarkdown(source)` 不带选项，
    // 于是用户关掉单 `$` 之后，屏幕上不是公式、复制出去却是。
    const source = "价格 $5 和 $6";
    expect(markdownToHtml(source)).toContain("katex");
    expect(markdownToHtml(source, { features: { inlineMathSingleDollar: false } })).not.toContain("katex");
  });

  it("开着单 $ 时两边都当公式", () => {
    expect(markdownToHtml("$x$", { features: { inlineMathSingleDollar: true } })).toContain("katex");
  });

  it("双 $$ 不受单 $ 开关影响（两种设置下都是公式）", () => {
    const source = "$$x^2$$";
    expect(markdownToHtml(source, { features: { inlineMathSingleDollar: false } })).toContain("katex");
    expect(markdownToHtml(source, { features: { inlineMathSingleDollar: true } })).toContain("katex");
  });
});

describe("Markdown 里的原始 HTML", () => {
  it("当前会被丢弃（remark-rehype 的默认行为）", () => {
    // 如实记录现状而不是断言理想行为：`rehype-stringify` 的
    // `allowDangerousHtml` 只影响**已经变成 hast 节点**的 raw 内容
    // （KaTeX 的 HTML 走这条路），用户原文在 remark-rehype 阶段就没了。
    // 要保留得再加 `rehype-raw`，那是另一个取舍（允许任意 HTML 进入剪贴板），
    // 留到 M4 导出时一并决定，不在这里偷偷改变行为。
    const html = markdownToHtml('<span class="自定义">文字</span>');
    expect(html).toContain("文字");
    expect(html).not.toContain('class="自定义"');
  });
});
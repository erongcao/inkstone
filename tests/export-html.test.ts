/**
 * HTML 导出。
 *
 * 这些用例钉住「导出的 HTML 是一份自包含的、能直接双击打开的网页」：
 *   - 样式内联在 `<style>` 里，不依赖外部资源
 *   - 代码高亮在（导出侧补的，编辑器链路不经过这里）
 *   - 公式在（复用 KaTeX 链路）
 *   - 大纲可选，且锚点能对上标题
 */

import { describe, expect, it, beforeAll } from "vitest";
import { exportToHtml, highlightCodeBlocks } from "@/export/html";
import { ensureMathRenderer } from "@/editor/render/math-loader";

beforeAll(async () => {
  await ensureMathRenderer();
});

/** 默认选项 */
const base = {
  title: "测试文档",
  theme: "inkstone-light",
  mode: "light" as const,
  includeOutline: false,
};

describe("HTML 导出产出完整文档", () => {
  it("有 DOCTYPE 与 html 结构", () => {
    const html = exportToHtml("# 标题", base);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
  });

  it("标题进 title 标签", () => {
    const html = exportToHtml("# 正文", { ...base, title: "我的文档" });
    expect(html).toContain("<title>我的文档</title>");
  });

  it("标题里的特殊字符被转义", () => {
    const html = exportToHtml("# 正文", {
      ...base,
      title: '<script>alert("x")</script>',
    });
    // 不能让标题把 <script> 注入到 <title> 里
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("样式是内联的，不引外部 CSS", () => {
    const html = exportToHtml("# 标题", base);
    expect(html).toContain("<style>");
    // 不能有 <link rel="stylesheet">——那就不是自包含了
    expect(html).not.toContain('<link rel="stylesheet"');
  });

  it("内容进了 article 容器", () => {
    const html = exportToHtml("# 标题\n\n正文一段。", base);
    expect(html).toContain('class="inkstone-doc"');
    expect(html).toContain("正文一段。");
  });
});

describe("自定义 CSS：编辑器里有，导出里也要有", () => {
  /*
   * 用户的「附加样式」是注入到文档根节点的那张样式表。
   * 它在编辑器里**排在所有样式之后**，能覆盖任何东西。
   *
   * 之前导出完全不带它——于是同一个文档，
   * 屏幕上是一套样式、导出出来是另一套，
   * 那是架构约束 C（「屏幕与导出必须一致」）的破口。
   */
  const customCss = "p { line-height: 1.8; color: #b00; }";

  it("自定义 CSS 进了导出文件", () => {
    const html = exportToHtml("# 标题", { ...base, customCss });
    expect(html).toContain(customCss);
  });

  it("自定义 CSS 排在 <head> 最后（与编辑器一致，能覆盖任何样式）", () => {
    const html = exportToHtml("# 标题", { ...base, customCss });
    const styleAt = html.lastIndexOf(customCss);
    const headEndAt = html.indexOf("</head>");

    expect(styleAt).toBeGreaterThan(-1);
    expect(styleAt).toBeLessThan(headEndAt);
    // 它后面不该再有别的 <style>（那才是「排最后」）
    expect(html.slice(styleAt, headEndAt)).not.toContain("<style>");
  });

  it("没有自定义 CSS 时不产生多余的空 style 标签", () => {
    const html = exportToHtml("# 标题", base);
    expect(html).not.toContain("<style>\n\n</style>");
  });
});

describe("代码高亮", () => {
  it("导出的代码块带 hljs class", () => {
    const html = exportToHtml("```js\nconst a = 1;\n```", base);
    expect(html).toContain("hljs");
    expect(html).toContain("language-javascript");
  });

  it("高亮产生了 token span", () => {
    const html = exportToHtml("```js\nconst a = 1;\n```", base);
    // 有 token span 才说明真的高亮了，而不是当成纯文本
    expect(html).toMatch(/<span class="hljs-[a-z_]+"/);
  });

  it("认不出的语言按纯文本处理", () => {
    const html = exportToHtml("```notalanguage\nsome text\n```", base);
    expect(html).toContain("language-plaintext");
  });

  it("代码内容里的尖括号被转义", () => {
    const html = exportToHtml("```html\n<div>x</div>\n```", base);
    // 不能出现**真实的**标签——那会让代码块里的 HTML 变成页面元素
    expect(html).not.toContain("<div>x</div>");
    // 高亮后尖括号被拆进 span 里，所以断言「有转义后的尖括号」而不是连续的 &lt;div&gt;
    expect(html).toContain("&lt;");
    expect(html).toContain("&gt;");
  });

  it("代码内容不会双重转义", () => {
    const html = exportToHtml("```html\n<div>x</div>\n```", base);
    // 双重转义会长成 &amp;lt;div&amp;gt;——
    // 页面上就显示成 &lt;div&gt; 这种字面量，而不是代码
    expect(html).not.toContain("&amp;lt;");
    expect(html).not.toContain("&amp;#x3C;");
  });

  it("高亮函数不会破坏非代码块", () => {
    const input =
      '<p>普通段落</p><pre><code class="language-js">const a = 1;</code></pre>';
    const output = highlightCodeBlocks(input);
    expect(output).toContain("<p>普通段落</p>");
    expect(output).toContain("hljs");
  });

  it("行内代码不被当成代码块处理", () => {
    // 行内 code 不是 <pre>，正则不该匹配到它
    const input = "<p>用 <code>const</code> 声明</p>";
    expect(highlightCodeBlocks(input)).toBe(input);
  });
});

describe("公式", () => {
  it("公式被渲染成 KaTeX", () => {
    const html = exportToHtml("公式 $E=mc^2$ 在这里。", base);
    expect(html).toContain("katex");
  });

  it("公式的样式表也内联进来了", () => {
    const html = exportToHtml("公式 $x$ 在这里。", base);
    // 只有含公式时才带 KaTeX CSS——绝大多数文档没有公式，
    // 无条件带上就是每次导出都多几十 KB
    expect(html).toContain("katex");
  });

  it("样式表里有隐藏 MathML 副本的那条规则", () => {
    const html = exportToHtml("公式 $x$ 在这里。", base);
    // 这条规则是**公式能正常显示**的关键：
    // KaTeX 输出的 HTML 里同时有视觉版（.katex-html）与
    // 给读屏软件用的 MathML 副本（.katex-mathml）。
    // 靠 `.katex-mathml { position: absolute }` 把后者藏起来。
    // 少了它，每条公式都会显示成「渲染结果 + 一串裸 LaTeX」两份。
    expect(html).toContain(".katex-mathml");
  });

  it("公式不会重复显示（没有裸 LaTeX 残留）", () => {
    const html = exportToHtml("行内 $E=mc^2$ 与块级\n\n$$\n\\int_0^1 x^2 dx\n$$\n", base);
    // MathML 的注释里带原始 TeX（annotation 标签），
    // 那是对的（读屏软件需要）；但正文里不该再出现一份裸 LaTeX
    const body = /<article[\s\S]*?<\/article>/.exec(html)?.[0] ?? "";
    // 去掉 MathML 之后再找裸 LaTeX
    const withoutMathml = body.replace(
      /<span class="katex-mathml">[\s\S]*?<\/span><\/span>/g,
      "",
    );
    expect(withoutMathml).not.toContain("∫");
    expect(withoutMathml).not.toContain("mc^2");
  });

  it("拿不到样式表时给出警告而不是静默产出错乱的文件", () => {
    // 拿不到 KaTeX CSS 的场景：渲染器没就绪（公式退回源码）
    // 这时导出的文件里公式是源码形态——至少要看得出来
    const html = exportToHtml("没有公式的文档", base);
    expect(html).not.toContain("未能内联 KaTeX 样式表");
  });
});

describe("大纲", () => {
  /**
   * 一份带两级标题的文档。
   *
   * 大纲**由文档自己派生**，不走选项传入——
   * 大纲里的链接要指向正文里的标题，两边必须来自同一棵 mdast 树。
   */
  const DOC = "# 第一章\n\n正文一段。\n\n## 第二节\n\n正文二段。\n";

  it("默认不含大纲", () => {
    const html = exportToHtml("# 标题", base);
    // 断言 DOM 结构（<nav class="inkstone-outline">）而不是字符串 "inkstone-outline"——
    // 样式表里有 `.inkstone-outline { display: none }` 这条打印规则，
    // 按字符串断言会误判
    expect(html).not.toContain('<nav class="inkstone-outline"');
  });

  it("开启后有大纲", () => {
    const html = exportToHtml(DOC, { ...base, includeOutline: true });
    expect(html).toContain("inkstone-outline");
    expect(html).toContain("第一章");
    expect(html).toContain("第二节");
  });

  it("大纲的链接指向标题锚点", () => {
    const html = exportToHtml(DOC, { ...base, includeOutline: true });
    // 大纲里的 href 与标题上的 id 必须对得上
    const href = /href="#(section-[^"]+)"/.exec(html)?.[1];
    expect(href).toBeTruthy();
    expect(html).toContain(`id="${href}"`);
  });

  it("大纲的层级用缩进体现", () => {
    const html = exportToHtml(DOC, { ...base, includeOutline: true });
    expect(html).toContain('data-depth="1"');
    expect(html).toContain('data-depth="2"');
  });
});

describe("追加内容", () => {
  it("extraHead 进 head", () => {
    const html = exportToHtml("# 标题", {
      ...base,
      extraHead: '<meta name="author" content="张三">',
    });
    expect(html).toContain('<meta name="author" content="张三">');
    // 必须在 </head> 之前
    expect(html.indexOf('name="author"')).toBeLessThan(html.indexOf("</head>"));
  });

  it("extraBody 进 body 末尾", () => {
    const html = exportToHtml("# 标题", {
      ...base,
      extraBody: "<footer>页脚</footer>",
    });
    expect(html).toContain("<footer>页脚</footer>");
    expect(html.indexOf("页脚")).toBeLessThan(html.indexOf("</body>"));
  });
});

describe("主题", () => {
  it("每套主题都有亮暗两套令牌", () => {
    for (const theme of ["inkstone-light", "github", "academic"]) {
      for (const mode of ["light", "dark"] as const) {
        const html = exportToHtml("# 标题", { ...base, theme, mode });
        expect(html).toContain("--ink-fg:");
        expect(html).toContain(`data-mode="${mode}"`);
      }
    }
  });

  it("未知主题退回默认主题而不是崩掉", () => {
    const html = exportToHtml("# 标题", { ...base, theme: "不存在的主题" });
    expect(html).toContain("--ink-fg:");
  });
});

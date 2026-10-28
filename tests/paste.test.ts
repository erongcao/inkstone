/**
 * 粘贴处理测试。
 *
 * 分三层测：
 *   1. `looksLikeMarkdown` —— 判断纯文本是不是已经是 Markdown
 *   2. `htmlToMarkdown` —— HTML → Markdown 的转换与样式净化
 *   3. `handlePaste` —— 端到端：剪贴板内容 → 文档
 */

import { describe, expect, it, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { htmlToMarkdown } from "@/editor/paste/html-to-markdown";
import { looksLikeMarkdown } from "@/editor/paste/detect";
import { handlePaste, markdownPaste } from "@/editor/paste";
import { markdownToHtml } from "@/parser/html";

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("looksLikeMarkdown：判断纯文本是不是已经是 Markdown", () => {
  it("识别标题", () => {
    expect(looksLikeMarkdown("# 标题")).toBe(true);
  });

  it("识别列表", () => {
    expect(looksLikeMarkdown("- 第一项\n- 第二项")).toBe(true);
    expect(looksLikeMarkdown("1. 第一项")).toBe(true);
  });

  it("识别引用与围栏代码块", () => {
    expect(looksLikeMarkdown("> 引用内容")).toBe(true);
    expect(looksLikeMarkdown("```js\nconst a = 1;\n```")).toBe(true);
  });

  it("识别行内链接与粗体", () => {
    expect(looksLikeMarkdown("看这个 [文档](https://example.com)")).toBe(true);
    expect(looksLikeMarkdown("这是**粗体**")).toBe(true);
  });

  it("识别行内代码与高亮", () => {
    expect(looksLikeMarkdown("用 `code` 就行")).toBe(true);
    expect(looksLikeMarkdown("==高亮==")).toBe(true);
  });

  it("普通中文段落不算 Markdown", () => {
    expect(looksLikeMarkdown("这是一段普通的中文文字。")).toBe(false);
    expect(looksLikeMarkdown("粗体")).toBe(false);
  });

  it("空文本不算", () => {
    expect(looksLikeMarkdown("")).toBe(false);
    expect(looksLikeMarkdown("   \n  ")).toBe(false);
  });
});

describe("htmlToMarkdown：HTML → Markdown", () => {
  it("加粗与斜体", () => {
    expect(htmlToMarkdown("<p><strong>粗体</strong></p>")).toBe("**粗体**");
    expect(htmlToMarkdown("<p><em>斜体</em></p>")).toBe("*斜体*");
    // <b>/<i> 是老式标签，语义等价
    expect(htmlToMarkdown("<p><b>粗体</b></p>")).toBe("**粗体**");
    expect(htmlToMarkdown("<p><i>斜体</i></p>")).toBe("*斜体*");
  });

  it("链接与图片", () => {
    expect(htmlToMarkdown('<p><a href="https://example.com">链接</a></p>')).toBe(
      "[链接](https://example.com)",
    );
    expect(htmlToMarkdown('<p><img src="a.png" alt="图"></p>')).toBe("![图](a.png)");
  });

  it("标题用 ATX 语法", () => {
    expect(htmlToMarkdown("<h1>标题</h1>")).toBe("# 标题");
    expect(htmlToMarkdown("<h3>三级</h3>")).toBe("### 三级");
  });

  it("列表用 - 号", () => {
    expect(htmlToMarkdown("<ul><li>一</li><li>二</li></ul>")).toBe("- 一\n- 二");
  });

  it("引用与分隔线", () => {
    expect(htmlToMarkdown("<blockquote><p>引用</p></blockquote>")).toBe("> 引用");
    expect(htmlToMarkdown("<hr>")).toBe("---");
  });

  it("行内代码与围栏代码块", () => {
    expect(htmlToMarkdown("<p><code>x = 1</code></p>")).toBe("`x = 1`");
    expect(htmlToMarkdown("<pre><code>const a = 1;</code></pre>")).toBe(
      "```\nconst a = 1;\n```",
    );
  });

  it("删除线", () => {
    expect(htmlToMarkdown("<p><del>删掉</del></p>")).toBe("~~删掉~~");
  });

  it("mark 标签转成 Typora 的高亮语法", () => {
    expect(htmlToMarkdown("<p><mark>高亮</mark></p>")).toBe("==高亮==");
  });

  it("sub / sup 转成下标 / 上标语法", () => {
    expect(htmlToMarkdown("<p>H<sub>2</sub>O</p>")).toBe("H~2~O");
    expect(htmlToMarkdown("<p>x<sup>2</sup></p>")).toBe("x^2^");
    expect(htmlToMarkdown("<p><sub>中</sub></p>")).toBe("~中~");
  });

  it("认不出来的 sub / sup 退回纯内容，不产出看得见的标记", () => {
    // 规则 ④：内容里有空白 → `~a b~` 不会被识别成下标
    expect(htmlToMarkdown("<p><sub>a b</sub></p>")).toBe("a b");
    // 内容自带标记 → 会提前闭合（`~a~b~` → 下标 a + 文本 b~）
    expect(htmlToMarkdown("<p><sub>a~b</sub></p>")).toBe("a~b");
    expect(htmlToMarkdown("<p><sup>a^b</sup></p>")).toBe("a^b");
    // 内容是 Markdown 语法 → 包进去会变成字面文本，留着更好
    expect(htmlToMarkdown("<p><sub><em>x</em></sub></p>")).toBe("*x*");
    // 空内容
    expect(htmlToMarkdown("<p><sub></sub></p>")).toBe("");
  });

  it("行内样式表达的上下标（Word / Google Docs 的另一种写法）", () => {
    expect(htmlToMarkdown('<p>H<span style="vertical-align: sub">2</span>O</p>')).toBe(
      "H~2~O",
    );
    expect(htmlToMarkdown('<p>x<span style="vertical-align: super">2</span></p>')).toBe(
      "x^2^",
    );
    // `text-position` 是 CSS2 的写法（LibreOffice 用它）
    expect(htmlToMarkdown('<p>x<span style="text-position: super">2</span></p>')).toBe(
      "x^2^",
    );
    // 认不出来的内容不转
    expect(htmlToMarkdown('<p><span style="vertical-align: sub">a b</span></p>')).toBe(
      "a b",
    );
    // 别的 vertical-align 值不是上下标
    expect(htmlToMarkdown('<p><span style="vertical-align: middle">x</span></p>')).toBe(
      "x",
    );
  });

  it("既是粗体又是上标时不转（转了会变成一对比看得见的星号）", () => {
    expect(
      htmlToMarkdown(
        '<p><span style="font-weight:bold; vertical-align: super">x</span></p>',
      ),
    ).toBe("**x**");
  });

  it("表格转成 GFM 表格", () => {
    const html =
      "<table><thead><tr><th>列一</th><th>列二</th></tr></thead><tbody><tr><td>甲</td><td>乙</td></tr></tbody></table>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("| 列一 | 列二 |");
    expect(md).toContain("| --- | --- |");
    expect(md).toContain("| 甲 | 乙 |");
  });
});

describe("htmlToMarkdown：样式净化", () => {
  it("剥掉 script 标签及其内容", () => {
    const html = "<p>正文</p><script>alert('x')</script>";
    const md = htmlToMarkdown(html);
    expect(md).toBe("正文");
    expect(md).not.toContain("alert");
  });

  it("剥掉 style 标签及其内容", () => {
    const html = "<style>p{color:red}</style><p>正文</p>";
    const md = htmlToMarkdown(html);
    expect(md).toBe("正文");
    expect(md).not.toContain("color");
  });

  it("剥掉 iframe / object 等嵌入对象", () => {
    const md = htmlToMarkdown('<p>正文</p><iframe src="https://evil.com"></iframe>');
    expect(md).toBe("正文");
    expect(md).not.toContain("iframe");
  });

  it("剥掉表单控件", () => {
    const md = htmlToMarkdown(
      "<form><input value='x'><button>确定</button></form><p>正文</p>",
    );
    expect(md).toBe("正文");
  });

  it("识别行内样式里的加粗（Word / Google Docs 导出的形式）", () => {
    expect(htmlToMarkdown('<p><span style="font-weight:bold">粗体</span></p>')).toBe(
      "**粗体**",
    );
  });

  it("识别行内样式里的斜体与删除线", () => {
    expect(htmlToMarkdown('<p><span style="font-style:italic">斜体</span></p>')).toBe(
      "*斜体*",
    );
    expect(
      htmlToMarkdown('<p><span style="text-decoration:line-through">删掉</span></p>'),
    ).toBe("~~删掉~~");
  });

  it("普通的 span 样式不产生多余标记", () => {
    expect(htmlToMarkdown('<p><span style="color:red">红字</span></p>')).toBe("红字");
  });
});

describe("htmlToMarkdown：Word 导出的整份 HTML", () => {
  /*
   * `tests/fixtures/word-clipboard.html` 是**真机 Word 15 复制到剪贴板的 HTML**
   * （结构原样保留：`<head>` 里的 meta / link / 条件注释 / 样式表，
   * `<body>` 里的 `mso-` 行内样式、`<o:p>` 标记；
   * 可见文字换成了中性占位文字，不含任何个人笔记内容）。
   *
   * 修的是一个**真实存在**的破口：整段 HTML 丢给 turndown 时，
   * `<head>` 的样板会被摊平进根元素，而**元素之间的空白文本节点**
   * 会被塌成一个个空格（实测开头多出 8 个空格）。
   */
  const word = readFileSync(resolve(FIXTURES, "word-clipboard.html"), "utf-8");

  it("结果不以空白开头（head 的样板不会漏成缩进）", () => {
    const md = htmlToMarkdown(word);
    /*
     * 这条不是洁癖：4 个以上的行首缩进在 Markdown 里是**缩进代码块**，
     * 粘到行中间则是**行尾硬换行**（两个空格就够了）。
     * 8 个空格粘在正文前面，用户会看到一个莫名其妙 indented 的开头。
     */
    expect(md.startsWith(" ")).toBe(false);
    expect(md.startsWith("\n")).toBe(false);
    expect(md.startsWith("\t")).toBe(false);
  });

  it("样式表的内容不会漏进结果", () => {
    /*
     * 这条**不是回归测试**（旧实现也过）——`<style>` 本来就被 `JUNK_TAGS` 剥掉了。
     * 它钉的是「换成只取 body 之后，样式表更是连解析都不必」。
     * （第一版对照脚本用裸 turndown 得出「CSS 会漏进结果」，
     * 那是**测量假象**——项目的净化规则本来就挡得住。）
     */
    const md = htmlToMarkdown(word);
    expect(md).not.toContain("Font Definitions");
    expect(md).not.toContain("@font-face");
    expect(md).not.toContain("mso-");
  });

  it("标题与加粗照常转换（head 被摘掉不影响正文）", () => {
    const md = htmlToMarkdown(word);
    expect(md).toContain("### ");
    expect(md).toContain("**");
    // 段落之间是空行，不是被空白撑开的一行
    expect(md).not.toMatch(/[ \t]+\n/);
  });

  it("最小复现：head 里的 void 元素旁边的空白不会漏进结果", () => {
    /*
     * 这个 bug 的机制很小，单独钉一条：
     * turndown 的 `blankRule` 本来会删掉纯空白的文本节点，
     * 但**同层级有 void 元素时就不删**（`<meta>` / `<link>` / `<br>` / `<img>` 都是 void）。
     * Word 的 head 里全是 void 元素 → head 里那些空白全被留下。
     */
    const html = [
      "<html><head>",
      '<meta http-equiv="Content-Type" content="text/html; charset=utf-8">',
      "<meta name=ProgId content=Word.Document>",
      '<link rel=File-List href="file:///C:/Temp/word/clip_filelist.xml">',
      "<title>文档标题</title>",
      "</head>",
      '<body style="tab-interval:21.0pt">',
      "<!--StartFragment-->",
      "<p>正文</p>",
      "</body></html>",
    ].join("\n");

    expect(htmlToMarkdown(html)).toBe("正文");
  });

  it("正文里有 img 时也不会漏出空白（body 里的 void 元素也一样）", () => {
    const html = [
      "<html><head>",
      '<meta http-equiv=Content-Type content="text/html; charset=utf-8">',
      '<meta name=Generator content="Microsoft Word 15">',
      '<link rel=File-List href="file:///C:/Temp/word/clip_filelist.xml">',
      "</head>",
      "<body>",
      '<p><img src="a.png" alt="图"></p>',
      "<p>正文</p>",
      "</body></html>",
    ].join("\n");

    const md = htmlToMarkdown(html);
    expect(md.startsWith(" ")).toBe(false);
    expect(md).toContain("![图](a.png)");
  });
});

describe("htmlToMarkdown：真机 Word 的表格", () => {
  /*
   * `tests/fixtures/word-table.html` 是**真机 Word 15 导出的表格**：
   * 单元格内容用 `<p class=MsoNormal>` 包着、每个单元格都套了
   * `<b style='mso-bidi-font-weight:normal'>`（Word 表格样式的默认加粗），
   * `<td>` 之间还有换行缩进。
   *
   * 修的是一个**内容丢失**级别的破口：
   * turndown 的 GFM 插件对「首行不是表头」的表格**原样保留成 HTML**，
   * 而 Word 的表格全是 `<td>`——于是每张 Word 表格都会以裸 HTML 进文档，
   * 导出时又被 remark-rehype 丢掉（它默认丢弃 html 节点）→ **整张表消失**。
   */
  const word = readFileSync(resolve(FIXTURES, "word-table.html"), "utf-8");

  it("转成 GFM 表格，不是裸 HTML", () => {
    const md = htmlToMarkdown(word);

    expect(md).toContain("| **甲** | **乙** | **丙** |");
    expect(md).toContain("| --- | --- | --- |");
    expect(md).toContain("| **1** | **2** | **3** |");
    // 关键：不能留下任何 HTML 标签
    expect(md).not.toContain("<table");
    expect(md).not.toContain("MsoNormal");
    expect(md).not.toContain("<td");
  });

  it("导出时表格不会整块消失", () => {
    /*
     * 这是这个破口最严重的一面：
     * 裸 HTML 进文档后，编辑区显示的是字面标签，
     * 而导出管线（remark-rehype 默认丢弃 html 节点）会让它**整个消失**。
     *
     * 转成 Markdown 表格之后，两边才一致（架构约束 C）。
     */
    const md = htmlToMarkdown(word);
    const exported = markdownToHtml(md);

    expect(exported).toContain("<table");
    expect(exported).toContain("甲");
    expect(exported).toContain("丙");
    expect(exported).toContain("1");
  });

  it("单元格里的块级包装（<p>）不会把行拆散", () => {
    const md = htmlToMarkdown(word);
    // 每一行都必须是一整行，不能被 <p> 的换行拆开
    for (const line of md.split("\n")) {
      expect(line.trim()).not.toBe("");
      expect(line.startsWith("|")).toBe(true);
    }
  });

  it("真机 Word 的上下标：Word 15 写的是 <sup>/<sub>，不是 mso-vert-align", () => {
    /*
     * `tests/fixtures/word-superscript.html` 是**真机 Word 15** 复制出来的：
     * `<p class=MsoNormal><span lang=EN-US>H<sup>2</sup>O<sub><o:p></o:p></sub></span></p>`
     *
     * 之前 AGENTS.md 里记着一个「已知缺口」：Word 可能会写
     * `mso-vert-align: super`。**实测证明现代 Word 不这么写**——
     * 它写的是语义标签 `<sup>` / `<sub>`，我们早就支持。
     */
    const html = readFileSync(resolve(FIXTURES, "word-superscript.html"), "utf-8");
    expect(htmlToMarkdown(html)).toBe("H^2^O");
  });

  it("本来就有表头（<th>）的表格不受影响", () => {
    const md = htmlToMarkdown(
      "<table><tr><th>列一</th><th>列二</th></tr><tr><td>甲</td><td>乙</td></tr></table>",
    );
    expect(md).toContain("| 列一 | 列二 |");
    expect(md).toContain("| --- | --- |");
    expect(md).toContain("| 甲 | 乙 |");
  });
});

describe("htmlToMarkdown：GFM 表格插件的判据漏洞", () => {
  /*
   * `turndown-plugin-gfm` 判「首行是不是表头」的判据比看上去严：
   *
   *   parentNode.firstChild === tr
   *   && (parentNode 是 TABLE || 是「第一个 TBODY」)
   *   && tr.childNodes 全是 TH
   *
   * 「第一个 TBODY」又要求它**没有 previousSibling**（或前一个是被清空的 THEAD）。
   * 于是三样东西会让整张表退回裸 HTML、导出时**整块消失**：
   *
   *   1. `<caption>` 挡在 `<tbody>` 前面；
   *   2. `<table>` 与 `<tbody>` 之间的空白文本节点；
   *   3. `<tbody>` 与 `<tr>` 之间的空白文本节点。
   *
   * 这三条都是**结构**问题，与内容无关，所以都要用测试钉住。
   */

  it("带 <caption> 的表格仍然转成 GFM 表格，标题提到表格外面", () => {
    const md = htmlToMarkdown(
      "<table><caption>化验单</caption><tr><td>甲</td><td>乙</td></tr>" +
        "<tr><td>1</td><td>2</td></tr></table>",
    );

    expect(md).not.toContain("<table");
    expect(md).not.toContain("<caption");
    expect(md).toContain("化验单");
    expect(md).toContain("| 甲 | 乙 |");
    expect(md).toContain("| 1 | 2 |");
  });

  it("带 <caption> 的表格导出时不会整块消失", () => {
    const md = htmlToMarkdown(
      "<table><caption>化验单</caption><tr><td>甲</td></tr><tr><td>1</td></tr></table>",
    );
    const exported = markdownToHtml(md);

    expect(exported).toContain("<table");
    expect(exported).toContain("甲");
    expect(exported).toContain("化验单");
  });

  it("<table> 与 <tbody> 之间的空白文本节点不破坏表格", () => {
    const md = htmlToMarkdown(
      "<table>\n  <tbody>\n    <tr><td>甲</td><td>乙</td></tr>\n" +
        "    <tr><td>1</td><td>2</td></tr>\n  </tbody>\n</table>",
    );

    expect(md).not.toContain("<table");
    expect(md).toContain("| 甲 | 乙 |");
    expect(md).toContain("| 1 | 2 |");
  });

  it("<tbody> 与 <tr> 之间的空白文本节点不破坏表格", () => {
    const md = htmlToMarkdown(
      "<table><tbody>\n  <tr><td>甲</td><td>乙</td></tr>\n" +
        "  <tr><td>1</td><td>2</td></tr>\n</tbody></table>",
    );

    expect(md).not.toContain("<table");
    expect(md).toContain("| 甲 | 乙 |");
  });

  it("表格单元格里多个段落不会被拆散成多行", () => {
    const md = htmlToMarkdown(
      "<table><tr><td><p>甲</p><p>乙</p></td><td>丙</td></tr>" +
        "<tr><td>1</td><td>2</td></tr></table>",
    );

    // 每一行都必须是一整行
    for (const line of md.split("\n")) {
      expect(line.trim()).not.toBe("");
      expect(line.startsWith("|")).toBe(true);
    }
    // 多个段落之间补空格，而不是直接粘成「甲乙」
    expect(md).toContain("甲 乙");
  });
});

describe("htmlToMarkdown：单元格里的块级内容", () => {
  /*
   * GFM 表格的单元格**只能是一行**。
   * 而 turndown 的块级规则全都带换行——段落 `\n\n`、列表 `\n`、
   * 引用 `\n\n> `、代码块 `\n\n```\n…\n```\n\n`。
   *
   * 所以单元格里只要有**任何**块级元素，整行就被拆散。
   * 「单元格里放一个列表」的实测输出（修复前）是：
   *
   * ```
   * |
   * - x
   * - y
   *
   *  | z |
   * | --- | --- |
   * ```
   *
   * 表格直接报废：第一行是空的，分隔行还跑到了数据行后面。
   *
   * 修法是把块级元素**换成行内元素**（不是删掉——
   * 删掉会连行内格式一起丢掉）。
   */

  /** 每一行都必须是一整行的表格行 */
  function expectIntactTable(md: string): void {
    const lines = md.split("\n").filter((line) => line.trim() !== "");
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.startsWith("|"), `这一行不是表格行：${JSON.stringify(line)}`).toBe(
        true,
      );
      expect(line.endsWith("|")).toBe(true);
    }
  }

  it("单元格里放列表，表格不散架", () => {
    const md = htmlToMarkdown(
      "<table><tr><td><ul><li>x</li><li>y</li></ul></td><td>z</td></tr></table>",
    );

    expectIntactTable(md);
    expect(md).toContain("| x, y | z |");
    expect(md).toContain("| --- | --- |");
  });

  it("列表项的行内格式保留（压平不是删掉）", () => {
    const md = htmlToMarkdown(
      '<table><tr><td><ul><li><b>粗</b></li><li><a href="u">链</a></li></ul></td><td>z</td></tr></table>',
    );

    expectIntactTable(md);
    expect(md).toContain("**粗**");
    expect(md).toContain("[链](u)");
  });

  it("中文用顿号、英文用逗号", () => {
    const cn = htmlToMarkdown(
      "<table><tr><td><ul><li>甲</li><li>乙</li></ul></td></tr></table>",
    );
    expect(cn).toContain("甲、乙");

    const en = htmlToMarkdown(
      "<table><tr><td><ul><li>a</li><li>b</li></ul></td></tr></table>",
    );
    expect(en).toContain("a, b");
  });

  it("嵌套列表不会把父项和子项粘成「一级二级」", () => {
    const md = htmlToMarkdown(
      "<table><tr><td><ul><li>一级<ul><li>二级</li></ul></li><li>另一个</li></ul></td></tr></table>",
    );

    expectIntactTable(md);
    expect(md).toContain("一级 二级");
    expect(md).not.toContain("一级二级");
  });

  it("单元格里是引用、代码块、标题、分隔线，都不拆行", () => {
    const cases = [
      "<blockquote><p>引文</p></blockquote>",
      "<pre><code>line1\nline2</code></pre>",
      "<h3>小标题</h3>",
      "<p>前</p><hr><p>后</p>",
    ];

    for (const content of cases) {
      const md = htmlToMarkdown(`<table><tr><td>${content}</td><td>z</td></tr></table>`);
      expectIntactTable(md);
      expect(md).toContain("| --- | --- |");
    }
  });

  it("单元格里是嵌套表格，不拆行", () => {
    const md = htmlToMarkdown(
      "<table><tr><td><table><tr><td>内</td></tr></table></td><td>z</td></tr></table>",
    );

    expectIntactTable(md);
    expect(md).toContain("内");
  });
});

describe("handlePaste：端到端", () => {
  const views: EditorView[] = [];

  afterEach(() => {
    while (views.length) views.pop()!.destroy();
  });

  function createEditor(doc = "") {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = new EditorView({
      state: EditorState.create({ doc, extensions: [] }),
      parent: host,
    });
    views.push(view);
    return view;
  }

  /** 造一个只有 clipboardData 的假剪贴板事件 */
  function fakeEvent(clipboard: Record<string, string>): ClipboardEvent {
    return {
      clipboardData: {
        getData: (type: string) => clipboard[type] ?? "",
      },
    } as unknown as ClipboardEvent;
  }

  it("只有纯文本时原样插入", () => {
    const view = createEditor();
    const handled = handlePaste(view, fakeEvent({ "text/plain": "普通文字" }));
    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("普通文字");
  });

  it("纯文本本身是 Markdown 时原样保留", () => {
    const view = createEditor();
    handlePaste(
      view,
      fakeEvent({
        "text/plain": "**粗体** 和 [链接](https://a.com)",
        "text/html": "<p><strong>粗体</strong> 和 <a href='https://a.com'>链接</a></p>",
      }),
    );
    expect(view.state.doc.toString()).toBe("**粗体** 和 [链接](https://a.com)");
  });

  it("网页富文本转换成 Markdown", () => {
    const view = createEditor();
    handlePaste(
      view,
      fakeEvent({
        "text/plain": "粗体",
        "text/html": "<p><strong>粗体</strong></p>",
      }),
    );
    expect(view.state.doc.toString()).toBe("**粗体**");
  });

  it("真机 Word 的整份 HTML 粘进来，开头没有多余缩进", () => {
    /*
     * 走的是**真实路径**：剪贴板里同时有纯文本与 HTML
     * （Word 复制时两个都给），而纯文本「看起来不像 Markdown」，
     * 所以走 HTML 转换那条。
     *
     * 断言的重点是**文档第一行不能带缩进**：
     * 4 个以上的行首缩进在 Markdown 里是缩进代码块，
     * 用户粘进去会看到自己的内容变成了代码块。
     */
    const view = createEditor();
    const word = readFileSync(resolve(FIXTURES, "word-clipboard.html"), "utf-8");

    handlePaste(
      view,
      fakeEvent({
        "text/plain": "标题 正文要点补充说明",
        "text/html": word,
      }),
    );

    const doc = view.state.doc.toString();
    expect(doc.startsWith(" ")).toBe(false);
    expect(doc.startsWith("\t")).toBe(false);
    expect(doc.split("\n")[0]).toBe("### 标题 正文要点补充说明");
  });

  it("粘贴会替换当前选区", () => {
    const view = createEditor("占位文字啊");
    // 选中前 4 个字（占位文字）
    view.dispatch({ selection: { anchor: 0, head: 4 } });
    handlePaste(view, fakeEvent({ "text/plain": "新内容" }));
    expect(view.state.doc.toString()).toBe("新内容啊");
  });

  it("粘贴后光标停在插入内容之后", () => {
    const view = createEditor();
    handlePaste(view, fakeEvent({ "text/plain": "abc" }));
    expect(view.state.selection.main.head).toBe(3);
  });

  it("剪贴板为空时不处理（交给默认逻辑）", () => {
    const view = createEditor();
    expect(handlePaste(view, fakeEvent({}))).toBe(false);
    expect(view.state.doc.toString()).toBe("");
  });

  it("只读编辑器不处理粘贴", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = new EditorView({
      state: EditorState.create({ doc: "", extensions: [EditorState.readOnly.of(true)] }),
      parent: host,
    });
    views.push(view);
    expect(handlePaste(view, fakeEvent({ "text/plain": "abc" }))).toBe(false);
    expect(view.state.doc.toString()).toBe("");
  });
});

describe("markdownPaste 扩展：真实 DOM 事件", () => {
  const views: EditorView[] = [];

  afterEach(() => {
    while (views.length) views.pop()!.destroy();
  });

  it("在编辑器里触发 paste 事件，文档会被插入转换后的 Markdown", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = new EditorView({
      state: EditorState.create({ doc: "", extensions: [markdownPaste()] }),
      parent: host,
    });
    views.push(view);

    // 造一个带 clipboardData 的 paste 事件
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: {
        // 真实的 DataTransfer 对不存在的类型返回空串，这里要照实模拟
        getData: (type: string) => {
          if (type === "text/html") return "<p><strong>粗体</strong></p>";
          if (type === "text/plain") return "粗体";
          return "";
        },
      },
    });
    view.contentDOM.dispatchEvent(event);

    expect(view.state.doc.toString()).toBe("**粗体**");
  });

  it("扩展会阻止默认粘贴行为（不重复插入 text/plain）", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = new EditorView({
      state: EditorState.create({ doc: "", extensions: [markdownPaste()] }),
      parent: host,
    });
    views.push(view);

    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { getData: () => "纯文本" },
    });
    view.contentDOM.dispatchEvent(event);

    // 只插入了一次，没有出现「纯文本纯文本」
    expect(view.state.doc.toString()).toBe("纯文本");
    expect(event.defaultPrevented).toBe(true);
  });

  it("粘贴带 <sub> / <sup> 的网页内容，转成下标 / 上标语法", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = new EditorView({
      state: EditorState.create({ doc: "", extensions: [markdownPaste()] }),
      parent: host,
    });
    views.push(view);

    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: {
        getData: (type: string) => {
          if (type === "text/html") return "<p>H<sub>2</sub>O 与 x<sup>2</sup></p>";
          if (type === "text/plain") return "H2O 与 x2";
          return "";
        },
      },
    });
    view.contentDOM.dispatchEvent(event);

    expect(view.state.doc.toString()).toBe("H~2~O 与 x^2^");
  });
});

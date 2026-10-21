/**
 * 粘贴处理测试。
 *
 * 分三层测：
 *   1. `looksLikeMarkdown` —— 判断纯文本是不是已经是 Markdown
 *   2. `htmlToMarkdown` —— HTML → Markdown 的转换与样式净化
 *   3. `handlePaste` —— 端到端：剪贴板内容 → 文档
 */

import { describe, expect, it, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { htmlToMarkdown } from "@/editor/paste/html-to-markdown";
import { looksLikeMarkdown } from "@/editor/paste/detect";
import { handlePaste, markdownPaste } from "@/editor/paste";

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

  it("表格转成 GFM 表格", () => {
    const html = "<table><thead><tr><th>列一</th><th>列二</th></tr></thead><tbody><tr><td>甲</td><td>乙</td></tr></tbody></table>";
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
    const md = htmlToMarkdown("<form><input value='x'><button>确定</button></form><p>正文</p>");
    expect(md).toBe("正文");
  });

  it("识别行内样式里的加粗（Word / Google Docs 导出的形式）", () => {
    expect(htmlToMarkdown('<p><span style="font-weight:bold">粗体</span></p>')).toBe("**粗体**");
  });

  it("识别行内样式里的斜体与删除线", () => {
    expect(htmlToMarkdown('<p><span style="font-style:italic">斜体</span></p>')).toBe("*斜体*");
    expect(htmlToMarkdown('<p><span style="text-decoration:line-through">删掉</span></p>')).toBe(
      "~~删掉~~",
    );
  });

  it("普通的 span 样式不产生多余标记", () => {
    expect(htmlToMarkdown('<p><span style="color:red">红字</span></p>')).toBe("红字");
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
        getData: (type: string) =>
          type === "text/html" ? "<p><strong>粗体</strong></p>" : "粗体",
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
});

/**
 * 原始 HTML 在**导出**与**剪贴板**两条路上的不同待遇。
 *
 * ## 背景：丢掉原始 HTML 是**内容丢失**级别的破口
 *
 * `remark-rehype` 默认丢掉 mdast 的 `html` 节点。而 CommonMark 里
 * 块级 HTML 是**一整个** `html` 节点——于是丢掉它，里面的文字也一起没了。
 *
 * 实测（2026-10-28）：
 *
 * | 源码 | 丢掉时 | 保留时 |
 * |---|---|---|
 * | `<div align="center">` + `click me` + `</div>` | **整块消失**（连「click me」都没有） | 原样输出 |
 * | `inline <b>bold</b> here` | `inline bold here`（标签被丢） | 原样输出 |
 * | `line1<br>line2` | `line1line2`（**两个词被粘在一起**） | 原样输出 |
 *
 * 三种情况三个结果，而且没有一个跟屏幕一致——
 * 编辑器里原始 HTML 是**原样显示为文本**的。
 *
 * ## 两条路的取舍（2026-10-28 维护者拍板）
 *
 * - **导出**：保留。导出物是用户自己产出的本地文件，
 *   自己的内容不该被悄悄丢掉。
 * - **剪贴板**（⌘C / 菜单「复制为 HTML」）：丢弃。
 *   往 Word / 邮件正文里贴时，少一些意外内容（脚本、样式块）更安全。
 *
 * 这条守卫把**两边都钉住**：导出那边一改就红，剪贴板那边被「顺手放开」也红。
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import type * as ExportModule from "@/ipc/export";

/** 捕获写到磁盘（或下载）的那份 HTML */
const capture = vi.hoisted(() => ({ html: "" }));

vi.mock("@/ipc/export", async (importOriginal) => {
  const actual = await importOriginal<typeof ExportModule>();
  return {
    ...actual,
    writeTextFile: async (_path: string, content: string) => {
      capture.html = content;
    },
  };
});

import { exportToHtml } from "@/export/html";
import { exportDocument } from "@/export/service";
import { ensureMarkdownToHtml } from "@/parser/html-loader";
import { resetSettings } from "@/settings/store";
import { setDocumentContent, resetTabs } from "@/ipc/document";

/** 导出选项 */
const base = {
  title: "Probe",
  theme: "github",
  mode: "light" as const,
  includeOutline: false,
};

/** 一段带各种原始 HTML 的文档 */
const RAW_HTML_DOC = `before

<div align="center">
click me
</div>

inline <b>bold</b> here

line1<br>line2

after
`;

/** 导出产物里的正文（去掉 <head> 里的样式表） */
function body(html: string): string {
  const start = html.indexOf('<article class="inkstone-doc">');
  const end = html.indexOf("</article>");
  return html.slice(start, end);
}

beforeEach(() => {
  resetSettings();
  resetTabs();
  capture.html = "";
});

describe("原始 HTML：导出保留、剪贴板丢弃", () => {
  it("导出：块级原始 HTML 连同它的文字都保住", () => {
    const html = body(exportToHtml(RAW_HTML_DOC, base));

    expect(html).toContain('<div align="center">');
    // 关键：块级 HTML 里的**文字**不能消失
    expect(html).toContain("click me");
  });

  it("导出：行内原始 HTML 原样保留", () => {
    const html = body(exportToHtml(RAW_HTML_DOC, base));

    expect(html).toContain("<b>bold</b>");
  });

  it("导出：<br> 不会再把两个词粘在一起", () => {
    const html = body(exportToHtml(RAW_HTML_DOC, base));

    expect(html).toContain("line1<br>line2");
    expect(html).not.toContain("line1line2");
  });

  it("导出：<img> 这种没有文字的也不丢", () => {
    const html = body(
      exportToHtml(
        '<div align="center">\n<img src="logo.png" width="200">\n</div>\n',
        base,
      ),
    );

    expect(html).toContain('<img src="logo.png" width="200">');
  });

  it("剪贴板：原始 HTML 继续被丢弃（维护者拍板的取舍）", async () => {
    const html = await ensureMarkdownToHtml(RAW_HTML_DOC);

    // 丢弃：块级整块没了，连文字一起
    expect(html).not.toContain("click me");
    expect(html).not.toContain("<div");
    // 行内标签被丢，文字留下
    expect(html).not.toContain("<b>");
    expect(html).toContain("bold");
  });
});

describe("走完整导出链路：写出去的那份文件里也有原始 HTML", () => {
  it("导出的文件保留块级原始 HTML 与它的文字", async () => {
    setDocumentContent('<div align="center">\nclick me\n</div>\n');

    const result = await exportDocument("html");

    expect(result.ok).toBe(true);
    // 这是**真正写出去的那份文件**的内容，不是单测里的中间产物
    expect(capture.html).toContain('<div align="center">');
    expect(capture.html).toContain("click me");
  });

  it("导出的文件保留 <img> 这类没有文字的内容", async () => {
    setDocumentContent(
      '<div align="center">\n<img src="logo.png" width="200">\n</div>\n',
    );

    const result = await exportDocument("html");

    expect(result.ok).toBe(true);
    expect(capture.html).toContain('<img src="logo.png" width="200">');
  });
});

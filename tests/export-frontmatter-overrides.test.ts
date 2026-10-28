/**
 * front matter 覆盖导出设置：**读到了就要算数**。
 *
 * ## 这条守卫守的是什么
 *
 * 「读取 YAML front matter 覆盖导出设置」是一个**开关式**的功能——
 * 用户在设置里打开它，然后在自己的 .md 里写：
 *
 * ```yaml
 * export:
 *   html:
 *     includeOutline: false
 *   pdf:
 *     paperSize: Letter
 * fileNameTemplate: "笔记-${title}"
 * variables:
 *   site: 我的站
 * ```
 *
 * 这些值必须**真的改变产物**。
 *
 * ## 为什么需要这条守卫
 *
 * 实测（2026-10-28）：`readExportOverrides` 把 `export.pdf.paperSize`
 * 读出来了、也放进了 `ExportContext.overrides`，
 * 但**没有任何地方读它**——`src/export/pdf.ts` 直接用了设置面板里的值。
 *
 * 后果：用户开了开关、写了 `paperSize: Letter`，
 * 导出来的 PDF **还是 A4**，而且**没有任何提示**。
 * 一个「读到了却不生效」的字段，比「根本没读」更糟——
 * 用户会以为是自己写错了格式。
 *
 * ## 判据落在产物上
 *
 * 每个覆盖项都断言**产物真的变了**：
 *
 * - 纸张尺寸 → 打印 HTML 里 `@page { size: … }`
 * - 大纲开关 → 导出的 HTML 里有没有那个 `<nav>`
 * - 文件名模板 → 最终文件名
 * - 自定义变量 → 模板里 `${site}` 被替换成什么
 *
 * 外加一条**自检**：先断言 `readExportOverrides` 确实产出了这些键——
 * 否则「产物没变」可能是因为 front matter 压根没解析出来，
 * 守卫会指错方向。
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type * as ExportModule from "@/ipc/export";

/** 捕获写到磁盘（或下载）的那份文件内容 */
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

import { readExportOverrides, readFrontMatter } from "@/export/frontmatter";
import { parseMarkdown } from "@/parser/markdown";
import { prepareExport, exportDocument } from "@/export/service";
import { updateSettings, resetSettings } from "@/settings/store";
import { setDocumentContent, resetTabs } from "@/ipc/document";
import type { ExportFormat } from "@/export/registry";

/** HTML 导出格式 */
const HTML_FORMAT: ExportFormat = {
  id: "html",
  label: "HTML",
  extension: ".html",
  kind: "html",
  description: "",
  builtin: true,
};

/** PDF 导出格式 */
const PDF_FORMAT: ExportFormat = {
  id: "pdf",
  label: "PDF",
  extension: ".pdf",
  kind: "pdf",
  description: "",
  builtin: true,
};

/** 一份带全部四个覆盖项的文档 */
const DOC = `---
export:
  html:
    includeOutline: false
  pdf:
    paperSize: Letter
fileNameTemplate: "笔记-\${title}"
variables:
  site: 我的站
---

# 我的文档

正文。
`;

/** 走真实路径解析 front matter 里的覆盖项 */
function overridesOf(doc: string): Record<string, unknown> {
  const fm = readFrontMatter(parseMarkdown(doc));
  return readExportOverrides(fm.fields) as unknown as Record<string, unknown>;
}

beforeEach(() => {
  resetSettings();
  resetTabs();
  capture.html = "";
  updateSettings({ export: { readExportSettingsFromFrontMatter: true } });
});

afterEach(() => {
  resetSettings();
});

describe("front matter 的覆盖项都要真的生效", () => {
  it("自检：四个覆盖项都被读出来了", () => {
    const overrides = overridesOf(DOC);

    expect(overrides.htmlIncludeOutline).toBe(false);
    expect(overrides.pdfPaperSize).toBe("Letter");
    expect(overrides.fileNameTemplate).toBe("笔记-${title}");
    expect(overrides.variables).toEqual({ site: "我的站" });
  });

  it("export.html.includeOutline：关掉之后导出的 HTML 里没有大纲", async () => {
    // 产物判据：真正写出去的那份文件里没有大纲导航
    setDocumentContent(DOC);

    const result = await exportDocument("html");

    expect(result.ok).toBe(true);
    expect(capture.html).not.toContain('<nav class="inkstone-outline"');
  });

  it("export.pdf.paperSize：打印用的 HTML 里是 Letter 而不是 A4", async () => {
    const { buildPrintHtml } = await import("@/export/pdf");
    const context = prepareExport(PDF_FORMAT, DOC, null);

    // 自检：覆盖项确实进了上下文
    expect(context.overrides.pdfPaperSize).toBe("Letter");

    const html = await buildPrintHtml(context);

    // 产物判据：`@page` 的 size 必须是 Letter
    expect(html).toContain("size: letter;");
    expect(html).not.toContain("size: A4;");
  });

  it("fileNameTemplate：最终文件名按模板来", () => {
    const context = prepareExport(HTML_FORMAT, DOC, null);

    expect(context.fileName).toBe("笔记-我的文档.html");
  });

  it("variables：模板里的 ${site} 被替换成 front matter 里的值", () => {
    const doc = `---
fileNameTemplate: "\${site}-\${title}"
variables:
  site: 我的站
---

# 我的文档
`;
    const context = prepareExport(HTML_FORMAT, doc, null);

    expect(context.fileName).toBe("我的站-我的文档.html");
  });

  it("开关关着时，front matter 完全不生效", () => {
    updateSettings({ export: { readExportSettingsFromFrontMatter: false } });

    const context = prepareExport(PDF_FORMAT, DOC, null);

    expect(context.overrides).toEqual({});
  });
});

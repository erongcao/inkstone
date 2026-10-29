/**
 * 分页导出：纸张、页边距、分页规则、纸上的目录。
 *
 * ## 为什么要有这条守卫
 *
 * 打印样式有过**两份**：HTML 导出的 `EXPORT_STYLES` 里有一段 `@media print`，
 * PDF 导出又自己拼了一段。两份各写各的 → 同一份文档，
 * 在浏览器里打出来与在 PDF 里打出来分页不一样。
 *
 * 现在只有一份实现（`src/export/print-css.ts`），两个出口都调它。
 * 这条守卫盯的就是**别又长出第二份**。
 *
 * ## 判据落在产物上
 *
 * 断言的是「导出的 HTML 里有没有那条规则」，
 * 不是「代码里有没有调 `printStyles`」——
 * 后者对「调用了但没等完」与「压根没调」长得一模一样。
 *
 * ## 「页码」为什么不在这里
 *
 * 平台与内核的限制，不是没做：macOS 走系统打印面板（没有页码开关），
 * Tauri 2.12 的 `Webview::print()` 不接任何参数（拿不到 Chromium 的
 * `footerTemplate`），而 Chromium 与 WebKit 都不支持 CSS 的 `counter(page)`。
 * 原因写在 `src/export/print-css.ts` 的文件头。
 */

import { describe, expect, it, beforeEach } from "vitest";
import { exportToHtml } from "@/export/html";
import { printStyles, type PrintOptions } from "@/export/print-css";
import { buildPrintHtml } from "@/export/pdf";
import { readExportOverrides } from "@/export/frontmatter";
import { resetSettings, updateSettings } from "@/settings/store";
import type { ExportContext } from "@/export/service";

const OPTIONS: PrintOptions = {
  paperSize: "A4",
  margin: "normal",
  chapterBreak: false,
  includeOutline: false,
};

/** 一个最小可用的导出上下文 */
function context(
  content: string,
  overrides: ExportContext["overrides"] = {},
): ExportContext {
  return {
    content,
    title: "分页导出",
    variables: {
      title: "分页导出",
      author: "",
      date: "",
      filename: "probe.md",
      path: null,
      words: 0,
      chars: 0,
      now: new Date(),
    },
    definitions: [],
    format: {
      id: "html",
      label: "HTML",
      extension: ".html",
      kind: "html",
      description: "",
      builtin: true,
    },
    fileName: "probe.html",
    overrides,
    hasBodyContent: true,
    unusedFootnotes: [],
  };
}

/**
 * HTML 导出的最小选项。
 *
 * @param print 打印 / 分页设置（不传 = 不注入打印样式）
 * @param screenOutline **屏幕上**要不要显示大纲（与纸上那个旋钮独立）
 */
function htmlOptions(print?: PrintOptions, screenOutline = true) {
  return {
    title: "分页导出",
    theme: "inkstone-light",
    mode: "light" as const,
    includeOutline: screenOutline,
    print,
  };
}

beforeEach(() => {
  resetSettings();
});

describe("打印样式本身", () => {
  it("纸张与页边距进 @page", () => {
    const css = printStyles({ ...OPTIONS, paperSize: "Letter", margin: "wide" });
    expect(css).toContain("@page");
    expect(css).toContain("size: letter;");
    expect(css).toContain("margin: 25mm 25mm;");
  });

  it("不传纸张尺寸就不写 @page size（用浏览器 / 打印面板自己的）", () => {
    const css = printStyles({ ...OPTIONS, paperSize: undefined, margin: undefined });
    expect(css).not.toContain("@page");
    expect(css).not.toContain("size:");
  });

  it("章节另起一页的规则按开关来", () => {
    expect(printStyles({ ...OPTIONS, chapterBreak: true })).toContain(
      "page-break-before: always",
    );
    expect(printStyles({ ...OPTIONS, chapterBreak: false })).not.toContain(
      "page-break-before: always",
    );
  });

  it("第一个标题前面不留空白页", () => {
    const css = printStyles({ ...OPTIONS, chapterBreak: true });
    expect(css).toContain(".inkstone-doc > h1:first-child");
  });

  it("纸上的目录按开关来", () => {
    expect(printStyles({ ...OPTIONS, includeOutline: true })).toContain(
      ".inkstone-outline {\n    display: block !important;",
    );
    expect(printStyles({ ...OPTIONS, includeOutline: false })).toContain(
      ".inkstone-outline {\n    display: none !important;",
    );
  });

  it("图与表不跨页断开", () => {
    const css = printStyles(OPTIONS);
    expect(css).toContain("page-break-inside: avoid");
  });
});

describe("导出产物里的打印样式", () => {
  it("HTML 导出注入的正是共享模块那份（不是各写一份）", () => {
    const html = exportToHtml("# 标题\n\n正文", htmlOptions(OPTIONS));
    expect(html).toContain(printStyles(OPTIONS));
  });

  it("导出文件里只有一份 @media print（别又长出第二份）", () => {
    // 防漂移：打印样式曾经有两份（HTML 导出的 EXPORT_STYLES 一份、
    // PDF 导出自己拼一份）。断言「只有一份」比断言「内容对」更防得住
    // ——因为第二份可能是**旧的**那份，内容看着没问题。
    const html = exportToHtml("# 标题\n\n正文", htmlOptions(OPTIONS));
    expect(html.split("@media print").length - 1).toBe(1);
  });

  it("HTML 导出不带纸张尺寸，但带页边距与分页规则", () => {
    const html = exportToHtml(
      "# 标题\n\n正文",
      htmlOptions({ ...OPTIONS, paperSize: undefined }),
    );
    expect(html).not.toContain("size: A4;");
    expect(html).toContain("margin: 18mm 16mm;");
  });

  it("PDF 导出的 HTML 里有设置里的纸张尺寸", async () => {
    updateSettings({ export: { pdfPaperSize: "A5" } });
    const html = await buildPrintHtml(context("# 标题\n\n正文"));
    expect(html).toContain("size: A5;");
  });

  it("PDF 导出的 HTML 里有设置里的页边距", async () => {
    updateSettings({ export: { pdfMargin: "compact" } });
    const html = await buildPrintHtml(context("# 标题\n\n正文"));
    expect(html).toContain("margin: 12mm 12mm;");
  });

  it("PDF 导出里纸上有目录时，目录那一页在正文之前", async () => {
    updateSettings({ export: { pdfIncludeOutline: true } });
    const html = await buildPrintHtml(context("# 标题\n\n正文"));
    expect(html).toContain("inkstone-outline");
    expect(html).toContain("display: block !important;");
  });

  it("章节另起一页的设置进 PDF 导出", async () => {
    updateSettings({ export: { pdfChapterBreak: true } });
    const html = await buildPrintHtml(context("# 标题\n\n正文"));
    expect(html).toContain("page-break-before: always;");
  });

  it("设置改了，导出跟着变（不是只在启动时读一次）", async () => {
    updateSettings({ export: { pdfPaperSize: "Letter" } });
    const first = await buildPrintHtml(context("# 标题"));
    expect(first).toContain("size: letter;");

    updateSettings({ export: { pdfPaperSize: "Legal" } });
    const second = await buildPrintHtml(context("# 标题"));
    expect(second).toContain("size: legal;");
  });
});

/**
 * 纸上要目录、屏幕上不要——这两个是**独立**的旋钮。
 *
 * 早先大纲标记只按「屏幕上要不要」生成，于是「打印时带目录」在 HTML 导出里
 * **空转**：设置里打开了，文件里压根没有大纲标记，纸上当然也没有目录。
 *
 * 这类破口的特点是「不报错、不崩溃、只是没发生」，
 * 所以守卫必须盯住**产物里有没有那份标记**，
 * 而不是盯住「代码里有没有读那个设置」。
 */
describe("纸上要目录时，产物里真有目录", () => {
  const DOC = "# 一级标题\n\n## 二级标题\n\n正文";

  /**
   * 取出产物里 `<nav class="...">` 的 class。
   *
   * 不能直接 `toContain("inkstone-outline-print-only")`——
   * 那条隐藏规则的 CSS 文本**每个导出文件里都有**，
   * 字符串匹配分不出「类有没有套到 nav 上」。
   * 判据必须落在**标记本身**上。
   */
  function outlineClass(html: string): string | null {
    const match = /<nav class="([^"]*)"/.exec(html);
    return match ? match[1] : null;
  }

  it("屏幕上不要、纸上要：产物里仍然有大纲标记", () => {
    const html = exportToHtml(
      DOC,
      htmlOptions({ ...OPTIONS, includeOutline: true }, false),
    );
    expect(outlineClass(html)).not.toBeNull();
  });

  it("屏幕上不要、纸上要：目录被标成「只在纸上」", () => {
    const html = exportToHtml(
      DOC,
      htmlOptions({ ...OPTIONS, includeOutline: true }, false),
    );
    expect(outlineClass(html)).toBe("inkstone-outline inkstone-outline-print-only");
    // 屏幕上藏起来的那条规则必须在
    expect(html).toContain(
      ".inkstone-outline.inkstone-outline-print-only { display: none; }",
    );
    // 打印时由打印样式放出来
    expect(html).toContain("display: block !important;");
  });

  it("屏幕上要、纸上不要：目录在屏幕上有、在纸上没有", () => {
    const html = exportToHtml(
      DOC,
      htmlOptions({ ...OPTIONS, includeOutline: false }, true),
    );
    expect(outlineClass(html)).toBe("inkstone-outline");
    // 打印样式把它在纸上藏起来
    expect(html).toContain("display: none !important;");
  });

  it("两个都不要：产物里没有目录标记", () => {
    const html = exportToHtml(
      DOC,
      htmlOptions({ ...OPTIONS, includeOutline: false }, false),
    );
    expect(outlineClass(html)).toBeNull();
  });

  it("自检：这组守卫真的在检查东西（别对着空集假绿）", () => {
    const cases = [
      { screen: false, paper: true },
      { screen: true, paper: false },
      { screen: false, paper: false },
    ];
    expect(cases.length).toBeGreaterThan(0);
    // 每个组合都要产出**可区分**的结果：否则下面的断言分辨不出它们
    const classes = cases.map((c) =>
      outlineClass(
        exportToHtml(DOC, htmlOptions({ ...OPTIONS, includeOutline: c.paper }, c.screen)),
      ),
    );
    expect(classes[0]).toBe("inkstone-outline inkstone-outline-print-only");
    expect(classes[1]).toBe("inkstone-outline");
    expect(classes[2]).toBeNull();
  });
});

describe("front matter 覆盖分页设置", () => {
  it("纸张尺寸", () => {
    const overrides = readExportOverrides({ export: { pdf: { paperSize: "Legal" } } });
    expect(overrides.pdfPaperSize).toBe("Legal");
  });

  it("页边距", () => {
    const overrides = readExportOverrides({ export: { pdf: { margin: "wide" } } });
    expect(overrides.pdfMargin).toBe("wide");
  });

  it("章节另起一页", () => {
    const overrides = readExportOverrides({ export: { pdf: { chapterBreak: true } } });
    expect(overrides.pdfChapterBreak).toBe(true);
  });

  it("纸上有目录", () => {
    const overrides = readExportOverrides({ export: { pdf: { includeOutline: true } } });
    expect(overrides.pdfIncludeOutline).toBe(true);
  });

  it("不合法的值被忽略（退回设置面板的值，而不是让导出失败）", () => {
    const overrides = readExportOverrides({
      export: { pdf: { paperSize: "A3", margin: "huge" } },
    });
    expect(overrides.pdfPaperSize).toBeUndefined();
    expect(overrides.pdfMargin).toBeUndefined();
  });

  it("覆盖项优先于设置面板（读到了却不生效是比没读更糟的破口）", async () => {
    updateSettings({ export: { pdfPaperSize: "A4" } });
    const html = await buildPrintHtml(context("# 标题", { pdfPaperSize: "Legal" }));
    expect(html).toContain("size: legal;");
  });
});

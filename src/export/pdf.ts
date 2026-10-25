/**
 * PDF 导出：走 WebView 打印路径。
 *
 * ## 为什么不是 pandoc → LaTeX → PDF
 *
 * 那条路需要本机装 LaTeX（几百 MB）或 wkhtmltopdf。实测本机**都没有**：
 *   - `xelatex` / `pdflatex`：无
 *   - `wkhtmltopdf`：无
 *   - `weasyprint` / `typst` / `libreoffice`：无
 *
 * 而且即使能跑通，LaTeX 那条路的排版质量取决于用户装的模板与字体，
 * 和编辑器里看到的不是一回事。
 *
 * ## 实际做法
 *
 * Tauri 2 的 `Webview::print()` 在 macOS 上会调起**系统打印面板**
 * （WKWebView 的 `printOperation:`），面板里有「存储为 PDF」。
 * 于是：
 *
 *   1. 生成一份**打印专用**的 HTML（含 `@page` 纸张设置）
 *   2. 弹「另存为」拿到目标路径
 *   3. 打开一个**临时 WebView 窗口**加载那份 HTML
 *   4. 对它调 `print()` → 用户在系统面板里选「存储为 PDF」并指定位置
 *
 * 第 4 步弹的是系统面板，用户自己选保存位置——所以第 2 步的「另存为」
 * 其实只是个**建议路径**（我们会把它作为默认文件名）。
 *
 * ## 为什么打印专用 HTML 要单独一份
 *
 * 屏幕上用的排版（`--ink-content-width: 46rem` 的居中窄栏）不适合打印：
 * 打印要占满纸张宽度。所以打印版要重设宽度、字号、边距，
 * 并加上 `@page { size: A4 }` 这样的纸张指令。
 *
 * @page 的 size 直接由设置里的 `pdfPaperSize` 决定——
 * 纸张尺寸是**用户选的**，不能猜。
 */

import { exportToHtml } from "./html";
import type { ExportContext } from "./service";
import type { ExportResult } from "./service";
import { readSettings } from "@/settings/store";
import { isBrowserFallback } from "@/ipc/export";

/**
 * 生成打印用的 HTML。
 *
 * 在导出的 HTML 基础上追加一段打印样式：占满纸张宽度、去掉大纲、
 * 加上 `@page` 的纸张与页边距。
 */
export function buildPrintHtml(context: ExportContext): string {
  const settings = readSettings();

  const html = exportToHtml(context.content, {
    title: context.title,
    theme: settings.appearance.theme,
    mode: settings.appearance.colorMode,
    outline: [],
    includeOutline: false,
    words: context.variables.words,
    chars: context.variables.chars,
  });

  // 纸张尺寸 → CSS @page size
  const paperSizes: Record<string, string> = {
    A4: "A4",
    Letter: "letter",
    Legal: "legal",
    A5: "A5",
  };
  const size = paperSizes[settings.export.pdfPaperSize] ?? "A4";

  const printCss = `
@page {
  size: ${size};
  margin: 18mm 16mm;
}

@media print {
  html, body {
    background: #fff !important;
    color: #000 !important;
  }
  .inkstone-doc {
    max-width: none !important;
    padding: 0 !important;
  }
  .inkstone-doc pre {
    white-space: pre-wrap !important;
    word-break: break-word !important;
    page-break-inside: avoid;
  }
  .inkstone-doc h1,
  .inkstone-doc h2,
  .inkstone-doc h3 {
    page-break-after: avoid;
  }
  .inkstone-doc img,
  .inkstone-doc table {
    page-break-inside: avoid;
  }
}
`;

  // 把打印样式插进 <head> 末尾（在其它样式之后，能覆盖它们）
  return html.replace("</head>", `<style>\n${printCss}\n</style>\n</head>`);
}

/**
 * 执行 PDF 导出。
 *
 * @param path 建议的输出路径（用户最终在系统面板里选位置）
 */
export async function printToPdf(
  context: ExportContext,
  path: string,
): Promise<ExportResult> {
  // 浏览器里没有 WebView 打印面板，如实报错
  // 静默失败会让用户以为 PDF 导出了，打开一看什么都没有
  if (isBrowserFallback()) {
    const message = "浏览器降级模式无法导出 PDF，请在桌面应用里导出";
    return { ok: false, path: null, message, error: message };
  }

  const html = buildPrintHtml(context);

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("print_document", { html, suggestedPath: path });
    return {
      ok: true,
      path,
      message: "已打开打印面板，请选择「存储为 PDF」",
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      path: null,
      message: `PDF 导出失败：${message}`,
      error: message,
    };
  }
}

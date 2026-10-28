/**
 * 打印 / 分页样式：纸张、页边距、分页规则、纸上的目录。
 *
 * ## 为什么单独一个模块
 *
 * 打印样式有**两个出口**：HTML 导出（用户在浏览器里按 ⌘P 打印）
 * 与 PDF 导出（走系统打印面板）。两处各写一份 CSS 必然漂移——
 * 同一份文档，浏览器里打出来与 PDF 里打出来分页不一样。
 *
 * 所以只有这一份实现，两个出口都调它。
 *
 * ## 为什么「页码」做不到
 *
 * 这是**平台与内核**的限制，不是没做：
 *
 * - macOS 的 PDF 导出走 **WKWebView 的系统打印面板**（`Webview::print()`），
 *   面板里没有页码开关；
 * - Tauri 2.12 的 `Webview::print()` **不接任何参数**（上游源码：
 *   `pub fn print(&self) -> crate::Result<()>`），
 *   所以拿不到 Chromium 那套 `footerTemplate` / `displayHeaderFooter`；
 * - 而 Chromium 与 WebKit **都不支持 CSS 的 `counter(page)`**
 *   （分页计数器是 Paged Media 规范里的，两大内核都没实现）。
 *
 * 所以「每页右下角一个页码」在当前这条链路上**没有真办法**。
 * 能有真页码的路只有换一条 PDF 生成链路
 * （例如无头 Chromium 的 `Page.printToPDF`，它支持 `footerTemplate`），
 * 而那要随应用附带一个 Chromium——包体代价不可接受。
 *
 * 与其塞一个假的（自己数页、猜页码），不如把边界写清楚。
 */

/** 纸张尺寸 */
export type PrintPaperSize = "A4" | "Letter" | "Legal" | "A5";

/** 页边距预设 */
export type PrintMargin = "compact" | "normal" | "wide";

/** 打印 / 分页的选项 */
export interface PrintOptions {
  /**
   * 纸张尺寸。
   *
   * **不传 = 不写 `@page size`**——用浏览器 / 打印面板自己的纸张。
   *
   * 为什么要留这个口子：HTML 导出是一份「拿到哪都能打开」的文件，
   * 把 A4 写死进去，用户在 Letter 纸上打印时会被浏览器按 A4 排版
   * （Chrome 的打印对话框默认跟随 CSS 的纸张）。
   * 而 PDF 导出是我们自己的打印任务，纸张由设置决定，写死才对。
   */
  paperSize?: PrintPaperSize;
  /**
   * 页边距预设。
   *
   * **不传 = 不写 `@page margin`**——用浏览器 / 打印面板自己的边距。
   * 理由与 `paperSize` 一样。
   */
  margin?: PrintMargin;
  /** 一级标题是否另起一页 */
  chapterBreak: boolean;
  /** 纸上是否带目录 */
  includeOutline: boolean;
}

/**
 * 纸张尺寸 → CSS `@page size` 的取值。
 *
 * 注意 `Letter` / `Legal` 要**小写**：CSS 的关键字是大小写不敏感的，
 * 但写成 `LETTER` 在某些实现里会被当成未知纸张尺寸而整条 `@page` 失效
 * （实测 Safari 的旧版本有这个毛病）。统一用规范里的小写形式。
 */
const PAPER_SIZES: Record<PrintPaperSize, string> = {
  A4: "A4",
  Letter: "letter",
  Legal: "legal",
  A5: "A5",
};

/**
 * 页边距预设 → CSS `@page margin`。
 *
 * 值是**物理单位**（mm），不是 rem/em——rem 跟着正文字号变，
 * 而纸上的边距不该随字号变。
 */
const MARGINS: Record<PrintMargin, string> = {
  compact: "12mm 12mm",
  normal: "18mm 16mm",
  wide: "25mm 25mm",
};

/**
 * 生成打印样式。
 *
 * 这段 CSS 只在 `@media print` 里生效（或 `@page`），
 * 所以不影响导出文件在屏幕上的样子。
 */
export function printStyles(options: PrintOptions): string {
  // 纸张与边距都是**可选**的：不传就不写进 `@page`，
  // 用浏览器 / 打印面板自己的值（见 PrintOptions 的说明）。
  const pageBits: string[] = [];
  if (options.paperSize) {
    pageBits.push(`size: ${PAPER_SIZES[options.paperSize] ?? "A4"};`);
  }
  if (options.margin) {
    pageBits.push(`margin: ${MARGINS[options.margin] ?? MARGINS.normal};`);
  }
  const pageRule = pageBits.length > 0 ? `@page {\n  ${pageBits.join("\n  ")}\n}` : "";

  // 章另起一页：只对**不是第一个元素**的 h1 生效——
  // 否则文档的第一个标题前面会多出一张空白页。
  const chapterBreak = options.chapterBreak
    ? `
  .inkstone-doc h1 {
    page-break-before: always;
    break-before: page;
  }
  /* 第一个标题前面不要空白页 */
  .inkstone-doc > h1:first-child {
    page-break-before: auto;
    break-before: auto;
  }`
    : "";

  // 纸上的目录：默认**不印**（打印的是正文），用户可以在设置里打开。
  const outline = options.includeOutline
    ? `
  .inkstone-outline {
    display: block !important;
    page-break-after: always;
    break-after: page;
  }`
    : `
  .inkstone-outline {
    display: none !important;
  }`;

  return `${pageRule}
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
  /* 标题不与后面的正文分到两页 */
  .inkstone-doc h1,
  .inkstone-doc h2,
  .inkstone-doc h3 {
    page-break-after: avoid;
    break-after: avoid;
  }
  /* 图与表不跨页断开 */
  .inkstone-doc img,
  .inkstone-doc table,
  .inkstone-doc .ink-caption {
    page-break-inside: avoid;
    break-inside: avoid;
  }${chapterBreak}${outline}
}
`;
}

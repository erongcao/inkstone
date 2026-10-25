/**
 * 导出项注册表。
 *
 * 一个「导出项」= 一种输出格式 + 它的扩展名 + 它由谁来产出。
 *
 * ## 为什么要注册表而不是散落的 if-else
 *
 * 导出面板、原生菜单、命令面板都要列出「当前可用的导出项」。
 * 如果每处都写一遍 `if (format === "html") ... else if (format === "docx")`，
 * 三处必然不同步——加一种格式要改三个地方，漏一个就出现「面板里能选、点了没反应」。
 *
 * 注册表是**唯一**的格式清单：谁需要列举，都从这里取。
 *
 * ## 三种 kind 各自意味着什么
 *
 *   - `html`  前端自己产出 HTML（内嵌主题 CSS、代码高亮、可选大纲）
 *   - `pandoc` 交给 pandoc 进程产出（二进制格式必须走这条，见 pandoc.ts 的说明）
 *   - `pdf` 走 WebView 打印路径（本机无 LaTeX，见 pdf.ts 的说明）
 *
 * 分类不是为了「以后好扩展」，而是**因为三者的失败模式完全不同**：
 * pandoc 没装是「不可用」，PDF 打印是「弹系统面板」，HTML 是「写文件」。
 * UI 必须区别对待这三种情况，不能一律显示成「导出失败」。
 */

/** 导出项的实现路径 */
export type ExportFormatKind = "html" | "pandoc" | "pdf";

export interface ExportFormat {
  /** 稳定的 id，用来存用户的自定义配置 */
  id: string;
  /** 面板里显示的名字 */
  label: string;
  /** 输出文件的扩展名（含点） */
  extension: string;
  /** 由谁产出 */
  kind: ExportFormatKind;
  /**
   * pandoc 的输出格式名（`-t` 的参数）。
   * 仅 `kind === "pandoc"` 时有意义。
   */
  pandocFormat?: string;
  /** 面板里的一行说明 */
  description: string;
}

/**
 * 内置导出项。
 *
 * 顺序即面板里的默认顺序：先是自己能产出的（HTML / PDF），
 * 再是 pandoc 那批——用户没装 pandoc 时，后面这一组要显示成「不可用」而不是藏起来
 * （藏起来的话用户根本不知道这个功能存在）。
 */
export const BUILTIN_EXPORT_FORMATS: ExportFormat[] = [
  {
    id: "html",
    label: "HTML",
    extension: ".html",
    kind: "html",
    description: "内嵌主题样式与代码高亮的单文件网页",
  },
  {
    id: "pdf",
    label: "PDF",
    extension: ".pdf",
    kind: "pdf",
    description: "通过系统打印面板输出，可选择「存储为 PDF」",
  },
  {
    id: "docx",
    label: "Word (docx)",
    extension: ".docx",
    kind: "pandoc",
    pandocFormat: "docx",
    description: "Microsoft Word 文档",
  },
  {
    id: "odt",
    label: "OpenDocument (odt)",
    extension: ".odt",
    kind: "pandoc",
    pandocFormat: "odt",
    description: "LibreOffice / OpenOffice 文档",
  },
  {
    id: "epub",
    label: "EPUB",
    extension: ".epub",
    kind: "pandoc",
    pandocFormat: "epub",
    description: "电子书",
  },
  {
    id: "rtf",
    label: "RTF",
    extension: ".rtf",
    kind: "pandoc",
    pandocFormat: "rtf",
    description: "富文本格式",
  },
  {
    id: "latex",
    label: "LaTeX",
    extension: ".tex",
    kind: "pandoc",
    pandocFormat: "latex",
    description: "LaTeX 源码",
  },
  {
    id: "mediawiki",
    label: "MediaWiki",
    extension: ".mediawiki",
    kind: "pandoc",
    pandocFormat: "mediawiki",
    description: "MediaWiki 维基标记",
  },
  {
    id: "rst",
    label: "reStructuredText",
    extension: ".rst",
    kind: "pandoc",
    pandocFormat: "rst",
    description: "reStructuredText 源码",
  },
];

/** 按 id 找导出项；找不到返回 undefined */
export function findExportFormat(id: string): ExportFormat | undefined {
  return BUILTIN_EXPORT_FORMATS.find((format) => format.id === id);
}

/**
 * 把文件名里的非法字符清掉。
 *
 * 文件名可能来自两处：文档标题（用户写的）与导出文件名模板（用户写的）。
 * 两处都要过这一道，所以它住在**注册表**里——注册表是文件名的低层依赖，
 * 反过来让 service.ts import 它。
 *
 * 规则：
 *   - 只保留最后一段（路径分隔符切开）——模板里写路径会让人困惑（存到哪？）
 *   - 控制字符（C0 + DEL）直接去掉——它们在文件名里没有意义，且某些系统会拒绝
 *   - Windows 禁止的 `< > : " | ? *` 换成 `_`
 *   - 前导的点去掉——".hidden" 是隐藏文件，不该由导出产生
 *
 * 逐字符处理而不用正则：正则里的 `\u0000-\u001f` 会触发 eslint 的
 * `no-control-regex`，而字符码判断没有这个问题；
 * 顺带 `for...of` 按码点迭代，不会把 emoji 拆成两半。
 */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "";
  let cleaned = "";
  for (const char of base) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue;
    if ('<>:"'.includes(char) || char === "|" || char === "?" || char === "*") {
      cleaned += "_";
      continue;
    }
    cleaned += char;
  }
  return cleaned.trim().replace(/^\.+/, "") || "未命名";
}

/**
 * 去掉扩展名后的「建议文件名」。
 *
 * 存盘对话框的默认文件名。文档名可能带路径分隔符（Windows 上 `:`、`/` 都是非法文件名字符），
 * 所以这里只取最后一段并清掉非法字符——**不能**直接拿路径当文件名。
 */
export function suggestFileName(title: string, extension: string): string {
  return `${sanitizeFileName(title)}${extension}`;
}

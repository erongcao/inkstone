/**
 * HTML → Markdown 转换。
 *
 * 用 turndown（MIT）而不是自己写转换器：
 * 嵌套标签的配对、空白折叠、HTML 实体解码这些坑都很深，
 * 自己写的转换器会长期持续地产出脏 Markdown。
 *
 * 在 turndown 之上额外做两件它默认不做的事：
 *
 *   1. **样式净化**：剥掉 script / style / iframe 这类不该进文档的标签。
 *      顺带保证不会把网页里的样式表带进我们的文档。
 *   2. **识别行内样式**：Word 和 Google Docs 导出的是
 *      `<span style="font-weight:bold">粗体</span>`，
 *      不识别这套行内样式的话，从这些来源粘贴过来的加粗会整个丢掉。
 */

import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

/**
 * 不该进文档的标签。
 *
 * 前几个是「有内容但不该要」（脚本、样式表、嵌入对象），
 * 后几个是「内容没意义」（表单控件、媒体占位）。
 */
const JUNK_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "iframe",
  "object",
  "embed",
  "link",
  "meta",
  "template",
  "svg",
  "canvas",
  "video",
  "audio",
  "form",
  "input",
  "button",
  "select",
  "textarea",
]);

/** turndown 实例只建一次：它的规则表初始化不便宜 */
let service: TurndownService | null = null;

function createService(): TurndownService {
  const td = new TurndownService({
    // 标题用 ATX（`# 标题`）而不是下划线式——中文写作更常见
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    fence: "```",
    // Typora 官方推荐用 `*` 表示斜体、`**` 表示粗体
    emDelimiter: "*",
    strongDelimiter: "**",
    linkStyle: "inlined",
    // 段内换行用「两个空格 + 换行」，与 Typora 一致
    br: "  ",
  });

  // GFM 扩展：表格、删除线、任务列表、highlight 代码块
  td.use(gfm);

  // ── 覆盖 GFM 插件的删除线：单 `~` → 双 `~~` ─────────────────
  // GFM 规范允许单 `~`，但 Typora 的删除线语法是 `~~文字~~`，
  // 与 Typora 保持一致（见 Typora Markdown Reference）。
  // turndown 的 addRule 是 unshift，**后加的规则优先级更高**，
  // 所以这条必须放在 td.use(gfm) 之后。
  td.addRule("strikethroughDouble", {
    // 用函数而不是标签数组："strike" 不在 HTMLElementTagNameMap 里，
    // 而且 nodeName 在 HTML 文档里是大写
    filter: (node) => ["DEL", "S", "STRIKE"].includes(node.nodeName),
    replacement: (content) => `~~${content}~~`,
  });

  // ── 覆盖 turndown 的列表缩进：3 空格 → 1 空格 ────────────────
  // turndown 默认输出 "-   项目"（标记后补 3 个空格）和 "1.  项目"，
  // CommonMark 与 Typora 的惯例是 "- 项目" / "1. 项目"。
  td.addRule("listItem", {
    filter: "li",
    replacement: (content, node, options) => {
      let prefix = `${options.bulletListMarker} `;
      const parent = node.parentNode as HTMLElement | null;
      if (parent && parent.nodeName === "OL") {
        const start = parent.getAttribute("start");
        const index = Array.prototype.indexOf.call(parent.children, node);
        prefix = `${start ? Number(start) + index : index + 1}. `;
      }
      const isParagraph = /\n$/.test(content);
      const body = content.replace(/^\n+|\n+$/g, "") + (isParagraph ? "\n" : "");
      // 列表项跨多行时，续行要缩进到内容列
      const indented = body.replace(/\n/gm, `\n${" ".repeat(prefix.length)}`);
      return prefix + indented + (node.nextSibling ? "\n" : "");
    },
  });

  // ── 样式净化：直接丢掉垃圾标签 ────────────────────────────────
  td.addRule("stripJunk", {
    filter: (node) => JUNK_TAGS.has(node.nodeName.toLowerCase()),
    replacement: () => "",
  });

  // ── 行内样式 → Markdown 标记 ─────────────────────────────────
  // Word / Google Docs 导出的加粗、斜体、删除线都是 span + style，
  // 不识别就会把这些格式整个丢掉（这是「粘贴丢格式」最常见的原因）。
  td.addRule("styledSpan", {
    filter: (node) => node.nodeName === "SPAN" && node.hasAttribute("style"),
    replacement: (content, node) => {
      const style = node.getAttribute("style") ?? "";
      let out = content;
      if (/font-weight\s*:\s*(bold|bolder|[6-9]00)/i.test(style)) out = `**${out}**`;
      if (/font-style\s*:\s*italic/i.test(style)) out = `*${out}*`;
      if (/text-decoration\s*:[^;]*line-through/i.test(style)) out = `~~${out}~~`;
      return out;
    },
  });

  // ── <mark> → 高亮 ══…══（Typora 的高亮语法）──────────────────
  td.addRule("markHighlight", {
    filter: ["mark"],
    replacement: (content) => `==${content}==`,
  });

  return td;
}

/**
 * 把一段 HTML 转成 Markdown。
 *
 * @param html 剪贴板里的 HTML
 * @returns Markdown 文本；输入无效时返回空字符串
 */
export function htmlToMarkdown(html: string): string {
  if (!html || !html.trim()) return "";
  service ??= createService();
  const markdown = service.turndown(html);
  // 去掉首尾空行，粘贴时不应该多带空白
  return markdown.replace(/^\n+|\n+$/g, "");
}

/** 测试用：重置内部缓存的 turndown 实例 */
export function resetHtmlToMarkdownService(): void {
  service = null;
}

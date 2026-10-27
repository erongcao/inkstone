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
import { canWrapSubSup } from "@/parser/subsup";

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
      // 上下标也有用行内样式表达的来源（`vertical-align: super`），
      // 与 `<sup>` / `<sub>` 标签是同一个意思、同一条判据。
      //
      // 放在最后：此时 `out` 可能已经裹上了 `**…**`，
      // 而 `*` 是 Markdown 活跃字符 → `canWrapSubSup` 会拒绝，
      // 于是「既是粗体又是上标」的内容**不转**（转了会变成一对比看得见的星号）。
      if (/(?:vertical-align|text-position)\s*:\s*super/i.test(style)) {
        out = canWrapSubSup(out) ? `^${out}^` : out;
      } else if (/(?:vertical-align|text-position)\s*:\s*sub/i.test(style)) {
        out = canWrapSubSup(out) ? `~${out}~` : out;
      }
      return out;
    },
  });

  // ── <mark> → 高亮 ══…══（Typora 的高亮语法）──────────────────
  td.addRule("markHighlight", {
    filter: ["mark"],
    replacement: (content) => `==${content}==`,
  });

  // ── <sub> / <sup> → 下标 / 上标（Pandoc 风格）────────────────
  // turndown 默认**没有**这两个标签的规则，会把它们整个丢掉只留内容——
  // 从网页或 Word 粘贴过来的上下标就那么没了（实测 `H<sub>2</sub>O` → `H2O`）。
  //
  // 转的前提是：包出来的 `~…~` / `^…^` **必须能被自己的解析器认出来**。
  // 认不出来（比如内容里有空格）就不能包——否则编辑器里会出现一对
  // 看得见的波浪号，而导出时又不一样（架构约束 C：屏幕与导出必须一致）。
  // 判据见 `src/parser/subsup.ts` 的 `canWrapSubSup`（与解析规则同源）。
  //
  // 认不出来时退回**纯内容**：内容里的 Markdown 语法（粗体、链接……）
  // 仍然能正常解析，比包进一个认不出来的标记里强。
  //
  // 不按设置里的「下标 / 上标」开关分叉：粘贴的是外部内容，
  // 而开关管的是**本项目文档**的解析口径——与 `<mark>` → `==…==` 同理。
  td.addRule("subSup", {
    filter: ["sub", "sup"],
    replacement: (content, node) => {
      const marker = node.nodeName === "SUP" ? "^" : "~";
      if (!canWrapSubSup(content)) return content;
      return `${marker}${content}${marker}`;
    },
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
  const markdown = service.turndown(extractContent(html));
  // 去掉首尾空行，粘贴时不应该多带空白
  return markdown.replace(/^\n+|\n+$/g, "");
}

/**
 * 只取 HTML 的**正文**，把样板（`<head>`）与首尾空白节点摘掉。
 *
 * ## 为什么不能整段丢给 turndown
 *
 * turndown 是把输入包进 `<x-turndown>` 再用 DOM 解析器解析的，
 * 而 **DOM 解析器会把 `<head>` 的内容摊平进这个元素**——
 * 于是 Word 导出的那些 `<meta>` / `<link>` / 条件注释
 * 全都成了根元素的子节点。
 *
 * 真正咬人的不是那些标签本身（`JUNK_TAGS` 已经剥了），
 * 而是**它们之间的空白文本节点**：
 *
 * 1. 那些空白被 turndown 塌成**一个个空格**（一个文本节点 → 一个空格）；
 * 2. turndown 的 `blankRule` 本来会删掉「纯空白」的文本节点，
 *    但它有个例外——**同层级有 void 元素时就不删**
 *    （`<meta>` / `<link>` / `<br>` / `<img>` 都是 void）。
 *    Word 的 head 里全是 void 元素 → 空白全被留下。
 *
 * 结果是转换结果**开头多出 8 个空格**（实测 Word 15 的真实输出）。
 * 那 8 个空格不是装饰：粘到行中间就是「行尾硬换行」，
 * 粘到行首超过 4 个就是**缩进代码块**。
 *
 * ## 做法
 *
 * 用 `DOMParser` 自己解析一遍，**只把 `body` 交给 turndown**
 * （turndown 支持直接吃 DOM 节点，仍是同一个 clone + 空白塌缩的流程）。
 * 顺带把 body 首尾的空白文本节点摘掉——
 * 这一步是必要的：正文里只要有 `<img>` / `<br>`，
 * `blankRule` 依然会放过那些空白节点。
 *
 * `<head>` 里只有元信息（`<meta>` / `<link>` / `<title>` / 样式表 / 条件注释），
 * **没有正文内容**，摘掉不丢东西。
 */
function extractContent(html: string): HTMLElement | string {
  // DOMParser 在浏览器与 jsdom 里都有；万一没有就退回字符串路径
  if (typeof DOMParser === "undefined") return html;
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const body = doc.body;
    if (!body) return html;
    trimEdgeBlankText(body);
    return body;
  } catch {
    return html;
  }
}

/** 空白文本节点（只含空白） */
function isBlankText(node: Node): boolean {
  return node.nodeType === 3 && (node.textContent ?? "").trim() === "";
}

/**
 * 摘掉元素首尾的空白文本节点。
 *
 * 只动**首尾**，不动中间——中间那些空白是段落之间的分隔，
 * 由 turndown 自己的 `join` 处理。
 */
function trimEdgeBlankText(element: Element): void {
  while (element.firstChild && isBlankText(element.firstChild)) {
    element.removeChild(element.firstChild);
  }
  while (element.lastChild && isBlankText(element.lastChild)) {
    element.removeChild(element.lastChild);
  }
}

/** 测试用：重置内部缓存的 turndown 实例 */
export function resetHtmlToMarkdownService(): void {
  service = null;
}

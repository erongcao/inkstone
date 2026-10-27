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
    promoteTableHeaders(body);
    return body;
  } catch {
    return html;
  }
}

/**
 * 把**没有表头行**的表格的第一行提升成表头。
 *
 * ## 为什么必须做
 *
 * `turndown-plugin-gfm` 对表格有一条硬性规定：
 *
 * ```js
 * // Only convert tables with a heading row.
 * // Tables with no heading row are kept using `keep` (see below).
 * turndownService.keep(node => node.nodeName === 'TABLE' && !isHeadingRow(node.rows[0]))
 * ```
 *
 * 也就是说：**首行不是表头的表格会被原样保留成 HTML**。
 * 而 **Word 导出的表格全是 `<td>`，一个 `<th>` 都没有**（实测 Word 15）——
 * 于是每张 Word 表格都会以裸 HTML 进文档。
 *
 * 后果不只是「源码难看」：
 *
 * - 编辑器的实时预览**不渲染 HTML 块** → 用户看到的是字面的
 *   `<table class="MsoNormalTable" …>` 标签；
 * - 导出时 `remark-rehype` **默认丢弃 html 节点**
 *   （没开 `allowDangerousHtml`）→ **整张表在导出结果里消失**。
 *
 * 那是**内容丢失**，比「屏幕与导出不一致」还严重。
 *
 * ## 语义选择：为什么是「第一行当表头」
 *
 * GFM 表格**必须有表头行**，没有「无表头表格」这种东西。
 * 两种做法：
 *
 * | 做法 | 问题 |
 * |---|---|
 * | 空表头行（`|  |  |` + `|---|---|` + 全部数据行） | 编辑器里多一行空表头，看起来像坏了；中文技术写作里极少见 |
 * | **第一行当表头** | 纯数据网格的话，第一行会被「提升」成表头（显示为粗体） |
 *
 * 选后者，理由是**多数 Word 表格的第一行本来就是表头**
 * （只是 Word 用「加粗 / 底纹」表示，不用 `<th>`），
 * 提升成表头正好还原了用户的本意；而且这是绝大多数
 * HTML → Markdown 转换器的做法。
 *
 * ## 四处细节（少一处，GFM 的规则就不认）
 *
 * 插件的 `isHeadingRow` 判据（实测自 `turndown-plugin-gfm` 源码）：
 *
 * ```js
 * parentNode.nodeName === 'THEAD' ||
 * (parentNode.firstChild === tr &&
 *  (parentNode.nodeName === 'TABLE' || isFirstTbody(parentNode)) &&
 *  every.call(tr.childNodes, n => n.nodeName === 'TH'))
 * ```
 *
 * 而 `isFirstTbody` 看的又是 **previousSibling**（空白文本节点也算 sibling）：
 *
 * ```js
 * element.nodeName === 'TBODY' &&
 * (!previousSibling || (previousSibling.nodeName === 'THEAD' && 空白))
 * ```
 *
 * 于是有四个地方必须动手：
 *
 * 1. 首行的 `<td>` 全部换成 `<th>`（`every` 要求每个 childNode 都是 TH）；
 * 2. 行内的**空白文本节点**要清掉——混进去 `every` 就不成立；
 *    插件拼表头分隔行时还会对每个 childNode 调 `getAttribute`，
 *    文本节点留在那儿会直接抛异常；
 * 3. 行必须是 `<tbody>` 的**第一个子节点**（`firstChild === tr`）；
 * 4. `<tbody>` 必须是 `<table>` 的**第一个子节点**
 *    （否则 `previousSibling` 不是空，`isFirstTbody` 不成立）。
 *
 * 另外 `<caption>` 会挡在 `<tbody>` 前面，让第 4 条失效——
 * 那样整张表又会变回裸 HTML、导出时消失，所以标题要被**提到表格外面**。
 *
 * ### 为什么第 2 条不能交给 turndown
 *
 * turndown 自己会做空白塌缩（`collapseWhitespace`），大部分空白它能清掉。
 * 但它的规则是「**前面有文本、且前面那个文本不是以空格结尾**时，
 * 保留当前空白的前导空格」——所以：
 *
 * ```html
 * <tr><td>甲</td>
 *     <td>乙</td></tr>
 * ```
 *
 * `甲` 后面那个换行缩进**会活下来**，混在 `<tr>` 的 childNodes 里，
 * `every(childNode === TH)` 当场不成立。
 *
 * 表格层级的空白（`<table>` 与 `<tbody>` 之间、`<tbody>` 与 `<tr>` 之间）
 * turndown 能清掉，因为 `<table>` 是块级元素、进它之前 `prevText` 会被清空。
 * 但那属于 turndown 的**内部策略**——第 3、4 条这里仍然自己清一遍，
 * 判据就不依赖别人哪天改了实现。
 */
function promoteTableHeaders(body: HTMLElement): void {
  for (const table of Array.from(body.querySelectorAll("table"))) {
    // ── 0. 标题提到表格外面 ────────────────────────────────────
    hoistCaption(table);

    // ── 1. 首行提升成表头 ──────────────────────────────────────
    const firstRow = table.rows?.[0];
    if (firstRow) {
      // 已经有表头的表格不用管——GFM 插件本来就能转
      const hasHeader = Array.from(firstRow.cells).some((cell) => cell.nodeName === "TH");
      if (!hasHeader) {
        for (const cell of Array.from(firstRow.cells)) {
          const th = cell.ownerDocument.createElement("th");
          th.innerHTML = cell.innerHTML;
          cell.replaceWith(th);
        }
      }
    }

    // ── 2. 每一行：清空白节点 + 拆单元格里的块级包装 ───────────
    for (const row of Array.from(table.rows)) {
      // 行内的空白文本节点要清掉：GFM 插件判表头看 `tr.childNodes`
      // 是不是全是 TH，拼单元格时也按 childNodes 的**下标**决定
      // 首格要不要 `|` 前缀——混进空白节点，两头都不对。
      removeBlankTextNodes(row);
      flattenCellBlocks(row);
    }

    // ── 3. 位置：行要落在 tbody 首位，tbody 要落在 table 首位 ────
    if (firstRow) {
      const rowParent = firstRow.parentElement;
      if (rowParent) removeLeadingBlankTextNodes(rowParent);
    }
    removeLeadingBlankTextNodes(table);
  }
}

/**
 * 把 `<caption>` 的文字**提到表格外面**。
 *
 * GFM 插件判「首行是不是表头」时会看 tbody 有没有 `previousSibling`——
 * `<caption>` 正好占了那个位置，于是整张表退回裸 HTML，
 * 导出时又被 remark-rehype 丢掉 → **整张表连同标题一起消失**。
 *
 * 所以标题先变成表格前面的一段文字，表格本身才保得住。
 */
function hoistCaption(table: HTMLTableElement): void {
  const caption = table.caption;
  if (!caption) return;
  const text = (caption.textContent ?? "").trim();
  const parent = table.parentNode;
  if (parent && text) {
    const paragraph = table.ownerDocument.createElement("p");
    paragraph.textContent = text;
    parent.insertBefore(paragraph, table);
  }
  caption.remove();
}

/**
 * 把单元格里的**块级内容压成行内内容**。
 *
 * ## 为什么
 *
 * GFM 表格的单元格**只能是一行**。而 turndown 的块级规则全都带换行：
 * 段落 `\n\n`、列表 `\n`、引用 `\n\n> `、代码块 `\n\n```\n…\n```\n\n`。
 *
 * 所以单元格里只要有**任何**块级元素，整行就被拆散。
 * 最常见的是 Word 的 `<p class=MsoNormal>`（实测输出一堆 `|` 和空行）；
 * 还有「单元格里放一个列表」——实测输出成：
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
 * ## 怎么压
 *
 * 把块级元素**换成行内元素**，而不是删掉——
 * 删掉会连行内格式（粗体、链接）一起丢掉：
 *
 * | 元素 | 处理 |
 * |---|---|
 * | `<p>` / `<div>` / 标题 / 引用 | 拆开，内容提到上一层（保留行内格式） |
 * | `<li>` | 换成 `<span>`（列表项规则会加项目符号与换行） |
 * | `<ul>` / `<ol>` | 各项之间插分隔符，整体换成行内内容 |
 * | `<pre>` | 换成 `<span>`，并把代码里的换行换成空格 |
 * | `<hr>` | 删掉（单元格里没有「分隔线」这个概念） |
 *
 * 一个单元格里有**多个**段落时，它们之间补一个空格：
 * GFM 单元格没有段落概念，直接拼起来会变成「甲乙」，
 * 而 `<br>` 更不能用——导出管线的 remark-rehype 默认丢弃 html 节点，
 * 屏幕上一行、导出里没这一行，又成了两边不一致。
 */
function flattenCellBlocks(row: HTMLTableRowElement): void {
  for (const cell of Array.from(row.cells)) {
    // 从**最深**的元素开始处理：外层处理时，内层已经压成行内内容了
    const descendants = Array.from(cell.querySelectorAll("*"));
    for (let i = descendants.length - 1; i >= 0; i--) {
      const node = descendants[i];
      // 处理过程中节点可能已经被移走或替换掉了
      if (!cell.contains(node)) continue;
      if (!BLOCK_ELEMENTS.has(node.nodeName)) continue;

      switch (node.nodeName) {
        case "HR":
          node.remove();
          break;
        case "UL":
        case "OL":
          flattenList(node);
          break;
        case "LI":
          replaceWithInline(node);
          break;
        case "PRE":
          flattenCodeBlock(node);
          break;
        default:
          unwrapBlock(node);
          break;
      }
    }

    // 单元格里的换行（`<br>` 之类）也会破坏单行假设
    for (const br of Array.from(cell.querySelectorAll("br"))) {
      br.replaceWith(cell.ownerDocument.createTextNode(" "));
    }
  }
}

/**
 * turndown 内部的块级元素清单。
 *
 * **抄自 `turndown/lib/turndown.cjs.js` 的 `blockElements`**——
 * 规则是「这些元素的替换结果带换行」，所以判据必须跟它一致，
 * 自己猜一份清单就会漏。
 */
const BLOCK_ELEMENTS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "AUDIO",
  "BLOCKQUOTE",
  "BODY",
  "CANVAS",
  "CENTER",
  "DD",
  "DIR",
  "DIV",
  "DL",
  "DT",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "FRAMESET",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HGROUP",
  "HR",
  "HTML",
  "ISINDEX",
  "LI",
  "MAIN",
  "MENU",
  "NAV",
  "NOFRAMES",
  "NOSCRIPT",
  "OL",
  "OUTPUT",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "TBODY",
  "TD",
  "TFOOT",
  "TH",
  "THEAD",
  "TR",
  "UL",
]);

/**
 * 把一个列表压成行内内容。
 *
 * 列表项已经先被换成了 `<span>`（见 `flattenCellBlocks`），
 * 所以这里只需要把各项用分隔符连起来，再把整个列表换成行内内容。
 */
function flattenList(list: Element): void {
  const doc = list.ownerDocument;
  const parts: Node[] = [];
  for (const child of Array.from(list.childNodes)) {
    if (isBlankText(child)) continue;
    parts.push(child);
  }
  if (parts.length === 0) {
    list.remove();
    return;
  }

  const text = parts.map((part) => part.textContent ?? "").join("");
  const separator = separatorFor(text);

  const fragment = doc.createDocumentFragment();
  // 列表前面已经有内容时补一个空格——
  // 「说明：」+ 列表不能变成「说明：甲」，
  // 嵌套列表也不能把父项和子项粘成「一级二级」。
  if (hasContentBefore(list)) {
    fragment.append(doc.createTextNode(" "));
  }
  parts.forEach((part, index) => {
    if (index > 0) fragment.append(doc.createTextNode(separator));
    fragment.append(part);
  });
  list.replaceWith(fragment);
}

/**
 * 列表压成一行时，项与项之间的分隔符。
 *
 * 中文内容用顿号「、」，其余用「, 」。
 *
 * 为什么按内容选：中文技术写作里顿号才是列举分隔符
 * （「支持甲、乙、丙」），硬塞一个半角逗号会看着不像中文；
 * 而英文内容反过来——顿号在英文里几乎不用。
 */
function separatorFor(text: string): string {
  return /[一-鿿]/.test(text) ? "、" : ", ";
}

/** 把块级元素换成同内容的 `<span>`（去掉块级语义，保留行内格式） */
function replaceWithInline(node: Element): void {
  const span = node.ownerDocument.createElement("span");
  while (node.firstChild) span.append(node.firstChild);
  node.replaceWith(span);
}

/**
 * 代码块 → 行内内容。
 *
 * `<pre>` 换成 `<span>` 后，里面的 `<code>` 走的是**行内代码**规则
 * （不会加换行），但代码内容里的换行还在——那照样会拆行，
 * 所以先把文本节点里的换行换成空格。
 */
function flattenCodeBlock(node: Element): void {
  for (const text of Array.from(node.querySelectorAll("*"))) {
    for (const child of Array.from(text.childNodes)) {
      if (child.nodeType !== 3) continue;
      const value = child.textContent ?? "";
      if (!value.includes("\n")) continue;
      child.textContent = value.replace(/\s*\n\s*/g, " ");
    }
  }
  replaceWithInline(node);
}

/**
 * 拆掉块级包装：把内容提到包装的位置。
 *
 * 多个块之间补一个空格——GFM 单元格没有段落概念，
 * 直接拼起来会变成「甲乙」。
 */
function unwrapBlock(node: Element): void {
  const parent = node.parentNode;
  if (!parent) return;
  const hasText = (node.textContent ?? "").trim() !== "";
  if (hasText && hasContentBefore(node)) {
    parent.insertBefore(node.ownerDocument.createTextNode(" "), node);
  }
  while (node.firstChild) {
    parent.insertBefore(node.firstChild, node);
  }
  parent.removeChild(node);
}

/** 节点之前是否已经有内容（用来判断要不要补空格） */
function hasContentBefore(node: Node): boolean {
  let prev = node.previousSibling;
  while (prev) {
    if ((prev.textContent ?? "").trim() !== "") return true;
    prev = prev.previousSibling;
  }
  return false;
}

/** 删掉元素里的全部空白文本节点 */
function removeBlankTextNodes(element: Element): void {
  for (const node of Array.from(element.childNodes)) {
    if (isBlankText(node)) element.removeChild(node);
  }
}

/** 删掉元素**开头**的空白文本节点（不影响结尾） */
function removeLeadingBlankTextNodes(element: Element): void {
  while (element.firstChild && isBlankText(element.firstChild)) {
    element.removeChild(element.firstChild);
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

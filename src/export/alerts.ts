/**
 * 把 GitHub 提示块（`> [!NOTE]`）改写成 **pandoc 认得**的形态。
 *
 * ## 为什么需要这一步
 *
 * 屏幕上，`> [!NOTE]` 会被 `remark-github-blockquote-alert` 变成一个
 * 带标题、带颜色的提示块（见 `src/parser/alerts.ts`）。
 *
 * 而 pandoc 那条导出链路（DOCX / ODT / EPUB / RTF / LaTeX / MediaWiki… 共 21 种）
 * 把**原始 Markdown** 交给外部的 pandoc 进程——
 * pandoc **不认识**这个语法（实测：`pandoc --list-extensions=markdown`
 * 里没有 `alert`、也没有 `callout`）。
 *
 * 结果：屏幕上是一个写着「NOTE」的彩色提示块，
 * 导出的 Word 里却是一段普通引用，正文里还留着字面量 `[!NOTE]`。
 * 这正是「屏幕与导出必须一致」（架构约束 C）要避免的事。
 *
 * ## 改写成什么
 *
 * ```
 * > **NOTE**
 * >
 * > 这是一条提示。
 * ```
 *
 * 选它的理由是**可移植**：引用块 + 粗体标题，是**每一种** pandoc 输出格式
 * 都支持的两样东西。
 *
 * - HTML / EPUB / ODT / DOCX / LaTeX / MediaWiki：都渲染成「引用块 + 粗体标题」
 * - 彩色左边框到不了 Word 里——那是格式限制，不是内容缺失
 *
 * 试过但放弃的替代方案：
 *
 * - **围栏 div**（`::: {.callout-note}`）：pandoc 的 HTML 输出会带上
 *   `class="callout-note"`，但默认样式表里没有这个类，页面上就是一段普通文字；
 *   而 DOCX 输出会把 div **摊平**成普通段落，引用块的语义整个丢掉。
 * - **直接改 mdast 再重新序列化**：会重排用户的原文
 *   （`*斜体*` 变 `_斜体_`、列表符号归一化），
 *   而 pandoc 那 21 种格式里有 `.md`（`pandoc:gfm` / `pandoc:commonmark`）——
 *   那是**给人看、给人再编辑**的产物，不该被悄悄重排。
 *
 * 所以这里走**外科手术式**的路子：只改提示块那几行，
 * **其余的原文一个字节都不动**。
 *
 * ## 判定规则与屏幕完全一致
 *
 * 什么算一个提示块，规则抄的是上游插件（`src/parser/alerts.ts` 里有对拍断言）：
 *
 *   - 引用块里的**第一个匹配的段落**（不是「第一个段落」）
 *   - 该段落的**第一个文本节点**以 `[!TYPE]` 开头
 *   - `TYPE` ∈ NOTE / TIP / IMPORTANT / WARNING / CAUTION（不区分大小写）
 *
 * 标题文案与上游一致：**大写**的 `NOTE`。
 *
 * ## 改的是**副本**
 *
 * 用户源文件里的 `[!NOTE]` 一个字都不动——
 * 那是用户写的东西，导出不应该改他的源文件。
 */

import { ALERT_TYPES, matchAlert } from "@/parser/alerts";
import type { AlertType } from "@/parser/alerts";

/** 提示类型 → 大写标题（与上游插件一致：`alertType.toLocaleUpperCase()`） */
const TITLES: Record<AlertType, string> = {
  NOTE: "NOTE",
  TIP: "TIP",
  IMPORTANT: "IMPORTANT",
  WARNING: "WARNING",
  CAUTION: "CAUTION",
};

/** 一段行号区间 → 替换成的新行 */
interface LineReplacement {
  /** 起始行号（含） */
  from: number;
  /** 结束行号（含） */
  to: number;
  /** 替换成的新行 */
  lines: string[];
}

/**
 * 一行是不是围栏代码块的边界。
 *
 * 代码块里的 `> [!NOTE]` **不是**提示块——
 * 屏幕上的代码块也不渲染成提示块。这里必须挡住，
 * 否则用户写了个示例代码块，导出后示例里的 `[!NOTE]` 变成了 `**NOTE**`。
 */
function isFence(line: string): boolean {
  return /^\s{0,3}(`{3,}|~{3,})/.test(line);
}

/**
 * 取一行里的引用前缀（`>` 们 + 它们后面的空白）。
 *
 * 例：`"> "`、`">> "`、`"  > "`。
 * 匹配不到就返回 `null`（这一行不是引用块的内容）。
 */
function quotePrefix(line: string): { prefix: string; rest: string } | null {
  const m = /^(\s*>*\s*)/.exec(line);
  if (!m || !m[1].includes(">")) return null;
  return { prefix: m[1], rest: line.slice(m[1].length) };
}

/**
 * 算出「续行」与「空引用行」的前缀。
 *
 * - 续行前缀 = 引用前缀（`"> "` → 续行还是 `"> "`）
 * - 空引用行 = 引用前缀去掉尾部空白（`"> "` → `">"`）
 *
 * 但只有当引用前缀**纯粹**是 `>` 与空白时才给空引用行：
 * 引用块嵌在列表里时（`"- > "`），空引用行写成 `">"` 会把列表项拆开——
 * 那比标题挤在正文前面更糟。这种情况下退回「软换行」形态：
 * 标题与正文仍在同一段里，只是标题单独一行。
 */
function continuationPrefixes(prefix: string): { cont: string; blank: string | null } {
  const cont = prefix;
  const blank = /^\s*>\s*$/.test(prefix) ? prefix.trimEnd() : null;
  return { cont, blank };
}

/**
 * 在一段（引用块里去掉引用前缀后）的**开头**找 alert 标记。
 *
 * 必须在开头——上游的规则是「段落的第一个文本节点以 `[!TYPE]` 开头」。
 */
function markerIn(rest: string): { type: AlertType; length: number } | null {
  const m = matchAlert(rest);
  if (!m) return null;
  if (!ALERT_TYPES.includes(m.type)) return null;
  return { type: m.type, length: m.length };
}

/**
 * 把源码里的 GitHub 提示块改写成「引用块 + 粗体标题」。
 *
 * @param source 原始 Markdown
 * @returns 改写后的 Markdown（**只在提示块那几行动过**）
 */
export function rewriteAlertsForPandoc(source: string): string {
  const lines = source.split("\n");
  const replacements: LineReplacement[] = [];

  let inFence = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // 围栏代码块：整块跳过
    if (isFence(line)) {
      inFence = !inFence;
      i += 1;
      continue;
    }
    if (inFence) {
      i += 1;
      continue;
    }

    if (!quotePrefix(line)) {
      i += 1;
      continue;
    }

    // 收集这一整段引用块（连续的引用行）。
    // 空引用行 `">"` 也是引用块的一部分——它是段落分隔符。
    const block: number[] = [];
    while (i < lines.length) {
      const q = quotePrefix(lines[i]);
      if (!q) break;
      block.push(i);
      i += 1;
    }

    // 块内按「空引用行」切成段落
    const paragraphs: number[][] = [];
    let current: number[] = [];
    for (const lineNo of block) {
      const q = quotePrefix(lines[lineNo]);
      const isBlankQuote = q !== null && q.rest.trim() === "";
      if (isBlankQuote) {
        if (current.length > 0) {
          paragraphs.push(current);
          current = [];
        }
        continue;
      }
      current.push(lineNo);
    }
    if (current.length > 0) paragraphs.push(current);

    // 找**第一个**含标记的段落（上游规则：第一个**匹配上**的段落）
    for (const para of paragraphs) {
      const firstLineNo = para[0];
      const q = quotePrefix(lines[firstLineNo]);
      if (!q) continue;
      const marker = markerIn(q.rest);
      if (!marker) continue;

      const { cont, blank } = continuationPrefixes(q.prefix);
      const title = TITLES[marker.type];
      const afterMarker = q.rest.slice(marker.length);
      const restOfPara = para.slice(1);

      // 新段落 = 标题行 [+ 空引用行] + 正文行
      const body: string[] = [];
      // 标记后面**同一行**还有内容（`> [!NOTE] 正文`）→ 挪到标题下面单独一行
      if (afterMarker.trim() !== "") {
        body.push(`${cont}${afterMarker.replace(/^\s+/, "")}`);
      }
      // 段落里剩下的行原样保留
      for (const lineNo of restOfPara) {
        body.push(lines[lineNo]);
      }

      const replacement: string[] = [`${cont}**${title}**`];
      // 需要补一行空引用行吗？
      // 只有「后面确实还有内容」时才补——否则会多出一个空段落。
      if (blank !== null && body.length > 0) {
        replacement.push(blank);
      }
      replacement.push(...body);

      replacements.push({
        from: firstLineNo,
        to: para[para.length - 1],
        lines: replacement,
      });

      break; // 一个引用块里只处理第一个匹配的段落
    }
  }

  if (replacements.length === 0) return source;

  // 重建字符串。区间互不重叠（不同引用块），所以顺序替换即可。
  const out: string[] = [];
  let cursor = 0;
  for (const rep of replacements) {
    for (let n = cursor; n < rep.from; n += 1) out.push(lines[n]);
    out.push(...rep.lines);
    cursor = rep.to + 1;
  }
  for (let n = cursor; n < lines.length; n += 1) out.push(lines[n]);

  return out.join("\n");
}

/**
 * GFM 表格。
 *
 * 为什么必须行扫描：
 *   实测 `dump-lezer-tree.ts`，整张表在 lezer 里就是一个普通 `Paragraph`
 *   ——`@lezer/markdown` **完全不认** GFM 表格。
 *   而语义层有 `remark-gfm`（mdast 的 `table` / `tableRow` / `tableCell`）。
 *
 * 表格结构天然是**多行**的（表头 + 分隔行 + 数据行），
 * 所以不能像行内公式那样「逐行解析」——
 * 这里自己做行扫描来定结构，单元格内部的行内 Markdown 交给 `html-loader`
 * （同一个 remark 管线 + remark-rehype），所以语义不会分裂。
 *
 * 判定规则逐条对着 remark-gfm 实测过，并由 `tests/table.test.ts`
 * 的**对拍组**保证（拿全文 remark-gfm 的结果与本模块的行扫描结果比对）。
 */

import type { Tree } from "@lezer/common";
import {
  collectSkipRanges,
  makeSkipTest,
  scanLines,
  type Interval,
  type Line,
} from "./scan";
import { renderInlineHtmlSync } from "@/parser/html-loader";
import type { BlockMatch, BlockRenderer, BlockRenderResult } from "./types";

/** 单元格对齐方式 */
export type CellAlign = "left" | "center" | "right";

/** 一个表格 */
export interface TableMatch extends Interval {
  kind: "table";
  /** 每列的对齐方式（null = 不指定，交给浏览器默认） */
  align: (CellAlign | null)[];
  /** 首行是表头 */
  rows: string[][];
}

/**
 * 拆分一行的单元格。
 *
 * 只在**未被转义**的 `|` 上切分（GFM 规则），且**保留转义序列原样**——
 * `\|` 交给后续的 remark 去反转义，这里提前改会丢掉「这是字面量竖线」的信息。
 *
 * 首尾的 `|` 是可选的（GFM 允许省略），要剥掉；
 * 但结尾是 `\|` 时不能剥，那是真的内容。
 */
export function splitRow(text: string): string[] {
  let s = text.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);

  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && i + 1 < s.length) {
      // 反斜杠与后一个字符一起带走，转义序列原样保留
      current += ch + s[i + 1];
      i++;
      continue;
    }
    if (ch === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

/**
 * 解析分隔行（`| --- | :---: |`）。
 *
 * @returns 不是合法分隔行时返回 null
 */
export function parseDelimiterRow(text: string): (CellAlign | null)[] | null {
  const cells = splitRow(text);
  if (cells.length === 0) return null;
  for (const cell of cells) {
    if (!/^:?-+:?$/.test(cell)) return null;
  }
  return cells.map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":") && cell.length > (left ? 2 : 1);
    if (left && right) return "center" as const;
    if (left) return "left" as const;
    if (right) return "right" as const;
    return null;
  });
}

/**
 * 行前缀：前导空白与引用标记（`>`），可交替出现多次。
 *
 * 表格可以**嵌套在列表项与引用里**（实测 remark-gfm 认
 * `  | a |` 与 `> | a |`），所以扫描前必须把前缀摘掉，
 * 否则永远匹配不到；而 `from` 要落在 `|` 上而不是前缀上
 * （实测 remark 给的区间也是从 `|` 开始）。
 */
function splitPrefix(text: string): { prefix: string; offset: number } {
  let i = 0;
  for (;;) {
    const before = i;
    while (i < text.length && (text[i] === " " || text[i] === "\t")) i++;
    if (text[i] === ">") {
      i++;
      if (text[i] === " ") i++;
      continue;
    }
    // 没有 `>` 就只保留这一步吃掉的缩进
    i = before;
    while (i < text.length && (text[i] === " " || text[i] === "\t")) i++;
    return { prefix: text.slice(0, i), offset: i };
  }
}

/**
 * 判断内容（剥掉前缀之后）是否会**中断**表格。
 *
 * 全部来自实测：GFM 表格只在空行或「另一个块级结构」处结束，
 * 普通文本—even 带缩进— 都会被当成表格的一行。
 * （`  缩进` 续行 → 仍是行；`    x` 四空格起 → 缩进代码块 → 中断）
 */
const INTERRUPTS: RegExp[] = [
  /^ {0,3}#{1,6}(\s|$)/, // ATX 标题
  /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/, // 分隔线
  /^ {0,3}([-*+]|\d{1,9}[.)])(\s|$)/, // 列表
  /^ {0,3}>/, // 引用（多级引用的内层）
  /^ {0,3}(?:`{3,}|~{3,})/, // 围栏代码
  /^ {4,}\S/, // 缩进代码
  /^ {0,3}</, // HTML 块
];

function interruptsTable(content: string): boolean {
  if (content.trim().length === 0) return true; // 空行
  return INTERRUPTS.some((re) => re.test(content));
}

/**
 * 找出文档里所有 GFM 表格。
 *
 * 结构判定：第 i 行（剥掉前缀后）含 `|`，第 i+1 行是**列数相同**的
 * 合法分隔行，之后同前缀、不中断表格的行都算数据行。
 *
 * 数据行会被**归一化到表头宽度**：少了补空、多了截断——
 * 这正是 GFM 的规定，也和 remark-gfm 的 `tableRow` 列数一致。
 */
export function findTables(
  tree: Tree,
  source: string,
  options: { blockRanges?: readonly Interval[] } = {},
): TableMatch[] {
  const matches: TableMatch[] = [];
  // 文档里没有 `|` 就不可能有表格——先做一次原生字符串快筛
  if (!source.includes("|")) return matches;

  const lines = scanLines(source);
  // 禁区 = lezer 认识的代码块 / HTML 块 + 已被块级渲染器占用的区间。
  // 后者必需：`$$ … | a | … $$` 里的表格语法在语义上属于公式块。
  const isSkipped = makeSkipTest([
    ...collectSkipRanges(tree),
    ...(options.blockRanges ?? []),
  ]);

  /** 剥掉行前缀后的内容 */
  const contentOf = (line: Line): { prefix: string; text: string; from: number } => {
    const { prefix, offset } = splitPrefix(line.text);
    return { prefix, text: line.text.slice(offset), from: line.from + offset };
  };

  for (let i = 0; i + 1 < lines.length; i++) {
    if (isSkipped(lines[i].from)) continue;
    const headerLine = contentOf(lines[i]);
    if (!headerLine.text.includes("|")) continue;

    // 分隔行必须与表头**前缀相同**（否则那是另一个块里的表格）
    const delimLine = contentOf(lines[i + 1]);
    if (delimLine.prefix !== headerLine.prefix) continue;
    const align = parseDelimiterRow(delimLine.text);
    const header = splitRow(headerLine.text);
    // GFM 要求表头与分隔行列数一致，否则整块只是段落
    if (!align || align.length !== header.length) continue;

    const rows: string[][] = [header];
    let last = i + 1;
    for (let j = i + 2; j < lines.length; j++) {
      if (isSkipped(lines[j].from)) continue;
      const cell = contentOf(lines[j]);
      if (cell.prefix !== headerLine.prefix) break;
      if (interruptsTable(cell.text)) break;
      rows.push(splitRow(cell.text));
      last = j;
    }

    // 注意：`rows` 保持**原始**逐行列数，不补空格也不截断——
    // 实测 remark-gfm 的 tableRow 就是这样（3 列的表可以带 2 列的行）。
    // 「不足补空、超过截断」是**渲染**阶段的事，见 render()。

    matches.push({
      from: headerLine.from,
      to: lines[last].to,
      kind: "table",
      align,
      rows,
    });
    i = last;
  }

  return matches;
}

/** HTML 转义（渲染器尚未就绪时的兜底） */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\|/g, "|");
}

/** 渲染一个单元格的内容 */
function renderCell(source: string): string {
  // HTML 渲染器还没就绪 → 转义后的纯文本。加载完成后 refreshRendering 会补上
  const html = renderInlineHtmlSync(source);
  if (html !== null) return html;
  return escapeHtml(source);
}

/** 表格渲染器 */
export const tableRenderer: BlockRenderer = {
  id: "table",

  find(tree, source, blockRanges) {
    return findTables(tree, source, { blockRanges }) as unknown as BlockMatch[];
  },

  render(match) {
    const table = match as unknown as TableMatch;
    const el = document.createElement("table");
    el.className = "cm-md-table";

    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    table.rows[0].forEach((cell, i) => {
      const th = document.createElement("th");
      th.innerHTML = renderCell(cell);
      applyAlign(th, table.align[i]);
      headRow.appendChild(th);
    });
    head.appendChild(headRow);
    el.appendChild(head);

    const body = document.createElement("tbody");
    for (let r = 1; r < table.rows.length; r++) {
      const tr = document.createElement("tr");
      // GFM：数据行可以比表头少列或多列——
      // 少的补空单元格，多的忽略。实测「3 列的表 + 2 列的行」是合法的，
      // 且 remark-gfm 的 AST 保留原始列数，补齐只发生在渲染阶段。
      const width = table.align.length;
      for (let c = 0; c < width; c++) {
        const td = document.createElement("td");
        td.innerHTML = renderCell(table.rows[r][c] ?? "");
        applyAlign(td, table.align[c]);
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
    el.appendChild(body);

    return {
      dom: el,
      // 指纹必须覆盖对齐方式与全部单元格内容
      key: `table:${table.align.join(",")}:${table.rows.map((r) => r.join("")).join("")}`,
    } satisfies BlockRenderResult;
  },
};

function applyAlign(el: HTMLElement, align: CellAlign | null | undefined): void {
  if (align) el.style.textAlign = align;
}

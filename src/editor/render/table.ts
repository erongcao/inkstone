/**
 * GFM 表格。
 *
 * **走语法树，不做行扫描**——这一点是本文件被推翻重写过的，理由值得留着。
 *
 * 最初以为「lezer 不认 GFM 表格」，于是自己写行扫描把整套 GFM 规则重实现了一遍
 * （续行吸收、分隔行合法性、列数、列表/引用前缀、中断条件……），
 * 结果和 remark-gfm 对拍时连续 4 处不一致，全是 GFM 规则的细节。
 *
 * 根因是**测错了对象**：`scripts/dump-lezer-tree.ts` 用的是裸 `parser`，
 * 而编辑器真正用的是 `parser.configure(GFM)`（见 `live-preview/syntax.ts`）。
 * 配上 GFM 之后 lezer **完全认得**表格：
 *
 * ```
 * Table[0,37]
 *   TableHeader[0,11]     "| 名称 | 说明 |"
 *   TableDelimiter[12,27] "| --- | :---: |"   ← 名字叫 Delimiter，其实是分隔行
 *   TableRow[28,37]       "| 甲 | 乙 |"
 * ```
 *
 * 所有 GFM 边界（分隔行不合法 / 列数不符 / 被标题列表引用打断）
 * lezer 都已经判对了，`Table` 节点的区间也**自带**列表与引用前缀处理
 * （`  | a |` 的 from 落在 `|` 上；`> | a |` 的子节点里夹着 `QuoteMark`）。
 *
 * 教训写在这里：**能用语法树表达的，就不要用行扫描再实现一遍**——
 * 行扫描的每一条规则都是一个潜在的语义分叉点。
 *
 * 仍然要自己解析的只剩**对齐方式**：lezer 不把 `:---:` 的对齐暴露成属性，
 * 只能从 `TableDelimiter` 的文本里读。
 */

import type { SyntaxNode, Tree } from "@lezer/common";
import type { Interval } from "./scan";
import { renderInlineHtmlSync } from "@/parser/html-loader";
import { createTableToolbar, markCell, paintToolbar } from "./table-toolbar";
import type { BlockMatch, BlockRenderer, BlockRenderResult } from "./types";

/** 单元格对齐方式 */
export type CellAlign = "left" | "center" | "right";

/** 一个表格 */
export interface TableMatch {
  from: number;
  to: number;
  kind: "table";
  /** 每列的对齐方式（null = 不指定，交给浏览器默认） */
  align: (CellAlign | null)[];
  /** 首行是表头 */
  rows: string[][];
}

/** 取某个节点的直接子节点 */
function childrenOfType(node: SyntaxNode, name: string): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  const cursor = node.cursor();
  if (cursor.firstChild()) {
    do {
      if (cursor.node.type.name === name) out.push(cursor.node);
    } while (cursor.nextSibling());
  }
  return out;
}

/**
 * 解析分隔行（`| --- | :---: |`）得到每列的对齐方式。
 *
 * @returns 不是合法分隔行时返回 null
 */
export function parseDelimiterRow(text: string): (CellAlign | null)[] | null {
  let s = text.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);

  const cells = s.split("|").map((c) => c.trim());
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
 * 取一行里的所有单元格文本。
 *
 * **不能直接数 `TableCell` 节点**——lezer 对空单元格**不生成节点**，
 * 只留下分隔符。实测 `|  | z |`：lezer 只给 1 个 `TableCell`（`z`），
 * 而 remark 给 2 个单元格。数节点会少数一列。
 *
 * 所以改成按「分隔符切列」的状态机：
 *   - 行首的分隔符是**边框**，不是列分隔，跳过
 *   - 遇到 `TableDelimiter` → 收尾当前列，开始新列
 *   - 收尾时只有「最后一个子节点是 TableCell」才补最后一列
 *     （行尾的分隔符已经把最后一列收掉了）
 */
function cellsOf(row: SyntaxNode, source: string): string[] {
  const cells: string[] = [];
  let current = "";
  let pending: string | null = null; // null = 当前列尚未开始

  const cursor = row.cursor();
  if (cursor.firstChild()) {
    let first = true;
    do {
      const child = cursor.node;
      const name = child.type.name;
      if (first) {
        first = false;
        // 行首分隔符是边框，跳过
        if (name === "TableDelimiter") continue;
      }
      if (name === "TableCell") {
        current += source.slice(child.from, child.to);
        pending = "cell";
      } else if (name === "TableDelimiter") {
        cells.push(current.trim());
        current = "";
        pending = null;
      }
    } while (cursor.nextSibling());
  }

  if (pending === "cell") cells.push(current.trim());
  if (cells.length === 0) cells.push("");
  return cells;
}

/**
 * 找出文档里所有 GFM 表格。
 *
 * `blockRanges` 是**已被块级渲染器占用的区间**，必须让开：
 * lezer 不认识数学，所以 `$$\n| a |\n| --- |\n$$\n` 里的表格语法
 * 它会照认不误（实测 `Table[3,19)`），而 remark 判它属于公式块。
 * 不让开的话，同一段文本会被公式块与表格同时替换。
 */
export function findTables(
  tree: Tree,
  source: string,
  options: { blockRanges?: readonly Interval[] } = {},
): TableMatch[] {
  const matches: TableMatch[] = [];
  const claimed = options.blockRanges ?? [];
  const isClaimed = (from: number, to: number): boolean =>
    claimed.some((r) => from < r.to && r.from < to);

  tree.iterate({
    enter(ref) {
      // 注意：这里必须 `return;`（继续深入）而不是 `return false`（不进子树）——
      // 否则会在 Document 就停住，永远走不到 Table。
      if (ref.type.name !== "Table") return;

      const header = childrenOfType(ref.node, "TableHeader")[0];
      const delimiter = childrenOfType(ref.node, "TableDelimiter")[0];
      if (!header || !delimiter) return false;
      if (isClaimed(ref.from, ref.to)) return false;

      const align = parseDelimiterRow(source.slice(delimiter.from, delimiter.to));
      if (!align) return false;

      const rows = [cellsOf(header, source)];
      for (const row of childrenOfType(ref.node, "TableRow")) {
        rows.push(cellsOf(row, source));
      }

      matches.push({ from: ref.from, to: ref.to, kind: "table", align, rows });
      return false; // 子节点已全部处理完，不必再深入
    },
  });

  return matches;
}

/** HTML 转义（渲染器尚未就绪时的兜底） */
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

    // 工具栏 + 表格一起塞进 wrapper。
    // 为什么不直接把 <table> 当 dom：工具栏必须在表**外面**，
    // 否则点它会命中 `data-block-from` 而把表切回源码。
    const wrap = document.createElement("div");
    wrap.className = "cm-md-table-wrap";
    const bar = createTableToolbar();
    wrap.appendChild(bar);

    const el = document.createElement("table");
    el.className = "cm-md-table";

    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    table.rows[0].forEach((cell, i) => {
      const th = document.createElement("th");
      th.innerHTML = renderCell(cell);
      markCell(th, 0, i);
      applyAlign(th, table.align[i]);
      headRow.appendChild(th);
    });
    head.appendChild(headRow);
    el.appendChild(head);

    const body = document.createElement("tbody");
    for (let r = 1; r < table.rows.length; r++) {
      const tr = document.createElement("tr");
      // GFM 允许数据行的列数与表头不同：少的补空单元格，多的忽略。
      // （实测「3 列的表 + 2 列的行」合法；remark-gfm 的 AST 也保留原始列数，
      //   补齐只发生在渲染阶段。）
      const width = table.align.length;
      for (let c = 0; c < width; c++) {
        const td = document.createElement("td");
        td.innerHTML = renderCell(table.rows[r][c] ?? "");
        // 几何行号 = 渲染行号 + 1（0 表头 / 1 分隔行 / 2 起数据行）
        markCell(td, r + 1, c);
        applyAlign(td, table.align[c]);
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
    el.appendChild(body);
    wrap.appendChild(el);

    // 默认落点 = 最后一个数据行的最后一列，和初始标签说的是同一个位置。
    //
    // **必须在这里就写进 dataset**：任何一次表格改动都会让这个 DOM 被重建，
    // hover 写在元素上的坐标随之消失。若不预置，用户点完第一个按钮后
    // 再点第二个就会因为读不到坐标而**静默无反应**（浏览器实测踩到）。
    const defaultRow = Math.max(table.rows.length, 2);
    wrap.dataset.hoverRow = String(defaultRow);
    wrap.dataset.hoverCol = String(Math.max(table.align.length - 1, 0));
    paintToolbar(bar, defaultRow, table.align.length);

    return {
      dom: wrap,
      // 指纹必须覆盖对齐方式与全部单元格内容
      key: `table:${table.align.join(",")}:${table.rows.map((r) => r.join("")).join("")}`,
    } satisfies BlockRenderResult;
  },
};

function applyAlign(el: HTMLElement, align: CellAlign | null | undefined): void {
  if (align) el.style.textAlign = align;
}

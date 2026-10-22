/**
 * 表格源码的几何信息与结构编辑。
 *
 * ## 为什么要自己算「每列的字符区间」
 *
 * 图形化编辑的每个动作最终都要落到**一次文档事务**上（红线 1：真相源是 Markdown 文本，
 * 界面只是它的一面）。而事务要的是 `from` / `to`，不是「第 r 行第 c 列」——
 * 所以必须知道每列在源码里的确切起止位置。
 *
 * 为什么不复用 lezer 的 `TableCell` 节点：实测 `|  | z |` 里 lezer **不给空单元格生成节点**
 * （见 `render/table.ts` 的 `cellsOf` 注释），数节点会少数一列。
 * 而编辑操作最常发生在空单元格上（新增行列就是加空格子）。所以自己按未转义的 `|` 切列。
 *
 * ## 行号约定（**与 `TableMatch.rows` 不同，别混**）
 *
 *   `tableRowsGeometry` 数**源码里的每一行**，所以：
 *
 *   | 下标 | 内容 |
 *   |---|---|
 *   | 0 | 表头 |
 *   | 1 | 分隔行（不可删） |
 *   | 2+ | 数据行 |
 *
 *   而 `TableMatch.rows` **不含**分隔行（表头在 0，数据从 1 开始）。
 *
 * ## 边界：转义的竖线
 *
 * `a \| b` 是一个单元格，不是两列。切分时看前一个字符是不是 `\`。
 * 这是 GFM 里唯一会骗过朴素切分的地方。
 *
 * ## 不做列宽
 *
 * **GFM 没有列宽语法**。Typora 支持调列宽，但它把宽度存在**自己的配置**里，
 * 不写进 Markdown——照搬就是给同一份文档引入第二个真相源，破坏红线 1。
 * 所以只有：增删行、增删列、对齐，三者都能用 Markdown 表达。
 */

import type { CellAlign } from "./table";

/** 一列在源码里的位置与文本 */
export interface CellSpan {
  /** 去掉两侧空白后的内容起点（绝对位置） */
  from: number;
  /** 去掉两侧空白后的内容终点（绝对位置，不含） */
  to: number;
  /** 单元格文本 */
  text: string;
}

/** 一行在源码里的几何信息 */
export interface RowSpan {
  /** 行首（绝对，含引用/列表前缀与前导空白） */
  from: number;
  /** 行尾（绝对，不含换行） */
  to: number;
  /** 去掉两侧边框后的正文起点（绝对） */
  bodyFrom: number;
  /** 去掉两侧边框后的正文终点（绝对，指向收尾 `|`） */
  bodyTo: number;
  /** 每列 */
  cells: CellSpan[];
  /** 行首有没有前导边框 `|` */
  hasLeadingPipe: boolean;
  /** 行尾有没有收尾边框 `|` */
  hasTrailingPipe: boolean;
  /** 是不是分隔行（`| --- | :---: |`） */
  isDelimiter: boolean;
}

/** 分隔行的判据：每列都形如 `:?-+:?` */
const DELIMITER_CELL = /^:?-+:?$/;

/**
 * 是不是 GFM 分隔行。
 *
 * 与 `table.ts` 的 `parseDelimiterRow` 用同一套判据（每列都匹配 `:?-+:?`），
 * 但这里允许行首缩进与引用前缀，所以先剥掉。
 */
export function isDelimiterRow(text: string): boolean {
  let s = text.trim().replace(/^(?:>\s*)+/, "");
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells = s.split("|");
  if (cells.length === 0) return false;
  return cells.every((cell) => DELIMITER_CELL.test(cell.trim()));
}

/** 这个 `|` 是不是转义的一部分（前一个字符是奇数个反斜杠） */
function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) backslashes++;
  return backslashes % 2 === 1;
}

function isSpace(ch: string): boolean {
  return ch === " " || ch === "\t";
}

/**
 * 把一行表格文本切成列（返回相对该行起点的偏移信息）。
 *
 * @param text 整行原文
 * @param base 该行在文档里的起始绝对位置
 */
export function splitRow(
  text: string,
  base: number,
): Omit<RowSpan, "from" | "to" | "isDelimiter"> {
  // 前导边框：**行首（跳过空白与引用/列表前缀）那个字符**是不是未转义的 `|`。
  // 不能找「第一个 `|` 在哪」——`a | b` 里那个 `|` 是列分隔符，不是边框。
  let firstNonSpace = 0;
  while (firstNonSpace < text.length && isSpace(text[firstNonSpace])) firstNonSpace++;
  const hasLeadingPipe = text[firstNonSpace] === "|" && !isEscaped(text, firstNonSpace);
  const start = hasLeadingPipe ? firstNonSpace + 1 : 0;

  let end = text.length;
  while (end > 0 && isSpace(text[end - 1])) end--;
  const hasTrailingPipe = end > 0 && text[end - 1] === "|" && !isEscaped(text, end - 1);

  const raw: { start: number; end: number }[] = [];
  let segmentStart = start;
  for (let i = start; i < end; i++) {
    if (text[i] === "|" && !isEscaped(text, i)) {
      raw.push({ start: segmentStart, end: i });
      segmentStart = i + 1;
    }
  }
  // 有收尾边框时，末尾那一段只是「边框之后的空白」，不是一列
  if (!hasTrailingPipe) raw.push({ start: segmentStart, end });

  const cells: CellSpan[] = raw.map((seg) => {
    let a = seg.start;
    let b = seg.end;
    while (a < b && isSpace(text[a])) a++;
    while (b > a && isSpace(text[b - 1])) b--;
    return { from: base + a, to: base + b, text: text.slice(a, b) };
  });

  return {
    bodyFrom: base + start,
    bodyTo: base + (hasTrailingPipe ? end - 1 : text.length),
    cells,
    hasLeadingPipe,
    hasTrailingPipe,
  };
}

/**
 * 一张表在源码里的行几何。
 *
 * @param source 整篇文档
 * @param from   `Table` 节点的 from（含引用/列表前缀）
 * @param to     `Table` 节点的 to
 */
export function tableRowsGeometry(source: string, from: number, to: number): RowSpan[] {
  const rows: RowSpan[] = [];
  const limit = Math.min(to, source.length);
  let lineFrom = from;

  while (lineFrom <= limit) {
    let lineTo = source.indexOf("\n", lineFrom);
    if (lineTo === -1 || lineTo > limit) lineTo = limit;
    const text = source.slice(lineFrom, lineTo);
    if (text.trim().length > 0) {
      rows.push({
        from: lineFrom,
        to: lineTo,
        isDelimiter: isDelimiterRow(text),
        ...splitRow(text, lineFrom),
      });
    }
    if (lineTo >= limit) break;
    lineFrom = lineTo + 1;
  }
  return rows;
}

/** 列数（以表头为准） */
export function columnCount(rows: readonly RowSpan[]): number {
  return rows[0]?.cells.length ?? 0;
}

/* ═══════════════════════════════════════════════════════════
 * 结构编辑
 * ═══════════════════════════════════════════════════════════ */

/** 一次结构编辑：把 `from..to` 换成 `insert` */
export interface TableEdit {
  from: number;
  to: number;
  insert: string;
}

/** 分隔行里新列的占位（不能是空——没有 `---` 这张表就不成立） */
const DELIMITER_CELL_TEXT = "---";

/** 数据行/表头里新列的占位 */
const EMPTY_CELL = "";

/**
 * 把一行重建为规范形式 `| a | b |`。
 *
 * ## 为什么**整行重建**而不是做插入手术
 *
 * 原设计是在「列文本起点」插 `| 新列 |`，看着省事，实际有两个坑：
 *
 *  1. **分隔行会粘连。** `| --- | --- |` 在第一列内容起点插 `| --- `，
 *     得到 `| --- | --- --- |`——两个 `---` 之间没有 `|`，这张表当场失效。
 *  2. **空格形态五花八门。** 实测（`vite` 无关，纯 lezer GFM）：
 *     列数对得上时 `| a |  | b |`、`| a || b |`、`| a| b |` 全都认；
 *     但列数对不上时**任何**写法都不认，而粘连恰恰会让列数对不上。
 *
 * 整行重建直接产出规范形式（首尾边框 + 每列两侧单空格），
 * 结果唯一确定、用户手敲的样子，也是 GFM 最保险的写法。
 * 代价是被编辑的行会被规整化——这是用户主动操作的结果，可以接受，
 * 而且只有**点过工具栏**的那些列会动，其余行原样保留。
 */
function renderRow(source: string, cells: readonly string[], template: RowSpan): string {
  // 行首的引用/列表前缀与前导空白必须原样保留（`| a |` 在 `> | a |` 里不是同一行）。
  // 注意 `bodyFrom` 已经跳过了前导边框，所以要往回退一格才是前缀末尾，
  // 否则会拼出 `|| 名称 |` 这种双竖线，lezer 直接不认作表格。
  const prefixEnd = template.hasLeadingPipe ? template.bodyFrom - 1 : template.bodyFrom;
  const prefix = source.slice(template.from, prefixEnd);
  return `${prefix}| ${cells.join(" | ")} |`;
}

/** 重建一行所有编辑并合成一段替换 */
function rebuildRows(
  source: string,
  rows: readonly RowSpan[],
  nextCells: readonly (readonly string[])[],
): TableEdit | null {
  if (rows.length !== nextCells.length) return null;
  const edits: TableEdit[] = rows.map((row, i) => ({
    from: row.from,
    to: row.to,
    insert: renderRow(source, nextCells[i], row),
  }));
  return mergeEdits(source, edits);
}

/** 取某一行的单元格文本 */
function textsOf(row: RowSpan): string[] {
  return row.cells.map((cell) => cell.text);
}

/**
 * 插入一个空数据行。
 *
 * @param afterRow 插在第几行**之后**。默认（省略）= 追加到末尾。
 *                 0 是表头、1 是分隔行，所以「在表头下面加行」传 0 或 1 都一样。
 *
 * @returns null 表示这还不是一张完整的 GFM 表（没有分隔行），
 *         那种情况下既没有列数可以照着填，也谈不上「加一行」。
 */
export function addTableRow(
  source: string,
  rows: readonly RowSpan[],
  afterRow?: number,
): TableEdit | null {
  // 门槛是**两行**（表头 + 分隔行），不是三行。
  // 「只有表头和分隔行」恰恰是最需要加行的状态——用命令面板刚插出来的空表就是它，
  // 挡下来等于「刚建的表格不能加行」。这是浏览器实测抓出来的。
  if (rows.length < 2 || !rows[1]?.isDelimiter) return null;
  const columns = columnCount(rows);
  if (columns === 0) return null;

  // 夹到 [1, rows.length - 1]：0 是表头不能往后插到它上面，最多追加到末尾
  const at =
    afterRow === undefined ? rows.length - 1 : clamp(afterRow, 1, rows.length - 1);
  const template = rows[at];
  const line = renderRow(source, new Array<string>(columns).fill(EMPTY_CELL), template);
  return { from: template.to, to: template.to, insert: `\n${line}` };
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * 删掉一个数据行。
 *
 * `_source` 只是没用上：删行是纯删除，不产生新文本。
 * 保留它是为了让本模块所有入口都是 `(source, rows, …)` 这个形状——
 * 调用方不用记「哪个要传 source、哪个不用」。
 *
 * @param rowIndex 几何行下标（2 起；1 是分隔行，不可删）
 */
export function removeTableRow(
  _source: string,
  rows: readonly RowSpan[],
  rowIndex: number,
): TableEdit | null {
  if (rowIndex < 2 || rowIndex >= rows.length) return null;
  const target = rows[rowIndex];
  if (target.isDelimiter) return null;

  if (rowIndex === rows.length - 1) {
    // 删末行：连同**它前面**的换行一起删，否则会留一个空行
    return { from: rows[rowIndex - 1].to, to: target.to, insert: "" };
  }
  // 删中间行：连同它**后面**的换行一起删
  return { from: target.from, to: rows[rowIndex + 1].from, insert: "" };
}

/**
 * 在第 `afterColumn` 列**之后**插入一个空列。
 *
 * 要改**每一行**：表头与数据行加空格，分隔行加 `---`。
 * 分隔行少写一个 `---`，这张表就不再是 GFM 表了。
 *
 * @param afterColumn -1 = 插在最前面；columns-1 = 追加到末尾
 */
export function addTableColumn(
  source: string,
  rows: readonly RowSpan[],
  afterColumn: number,
): TableEdit | null {
  const columns = columnCount(rows);
  if (columns === 0) return null;
  if (afterColumn < -1 || afterColumn >= columns) return null;
  const at = afterColumn + 1; // 插入点在下一列之前

  const next = rows.map((row) => {
    const cells = textsOf(row);
    cells.splice(at, 0, row.isDelimiter ? DELIMITER_CELL_TEXT : EMPTY_CELL);
    return cells;
  });
  return rebuildRows(source, rows, next);
}

/**
 * 删掉第 `column` 列。表至少要剩一列。
 *
 * @param column 0 起
 */
export function removeTableColumn(
  source: string,
  rows: readonly RowSpan[],
  column: number,
): TableEdit | null {
  const columns = columnCount(rows);
  if (columns <= 1) return null;
  if (column < 0 || column >= columns) return null;

  const next = rows.map((row) => {
    const cells = textsOf(row);
    cells.splice(column, 1);
    return cells;
  });
  return rebuildRows(source, rows, next);
}

/**
 * 设某一列的对齐方式。只改分隔行那一格（手术式，其余行完全不动）。
 *
 * `_source` 同 removeTableRow：为了签名统一而保留。
 */
export function setTableColumnAlign(
  _source: string,
  rows: readonly RowSpan[],
  column: number,
  align: CellAlign | null,
): TableEdit | null {
  const delimiter = rows[1];
  if (!delimiter?.isDelimiter) return null;
  const cell = delimiter.cells[column];
  if (!cell) return null;

  const text =
    align === "left"
      ? `:--`
      : align === "center"
        ? `:-:`
        : align === "right"
          ? `--:`
          : `---`;
  return { from: cell.from, to: cell.to, insert: text };
}

/** 读某一列当前的对齐方式（面板上要显示当前状态） */
export function getTableColumnAlign(
  rows: readonly RowSpan[],
  column: number,
): CellAlign | null {
  const cell = rows[1]?.cells[column];
  if (!cell) return null;
  const text = cell.text;
  const left = text.startsWith(":");
  const right = text.endsWith(":") && text.length > (left ? 2 : 1);
  if (left && right) return "center";
  if (left) return "left";
  if (right) return "right";
  return null;
}

/**
 * 把若干处编辑合成**一段**整体替换。
 *
 * 合成而不是发多条 change：只需要考虑编辑之间的相对顺序，
 * 不用管 CM6 的 change 排序与重叠规则——错不了。
 */
function mergeEdits(source: string, edits: readonly TableEdit[]): TableEdit | null {
  if (edits.length === 0) return null;
  const sorted = [...edits].sort((a, b) => a.from - b.from || a.to - b.to);

  const from = sorted[0].from;
  let to = sorted[0].to;
  let out = "";
  let cursor = from;
  for (const edit of sorted) {
    if (edit.from < cursor) continue; // 与前一处重叠，跳过
    out += source.slice(cursor, edit.from) + edit.insert;
    cursor = edit.to;
    if (edit.to > to) to = edit.to;
  }
  out += source.slice(cursor, to);
  return { from, to, insert: out };
}

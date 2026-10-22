/**
 * 表格图形化编辑 → 文档事务。
 *
 * 这一层只做三件事：
 *   1. 从 `EditorView` 拿到当前光标所在的表格（几何）
 *   2. 调用 `table-edit.ts` 的纯函数算出替换区间
 *   3. 发**一个**事务
 *
 * 「一个事务」是硬要求：拆成「改内容 + 移光标 + 改另一处」三个 dispatch，
 * 用户按一次 ⌘Z 只撤掉一半，表格就错位了。
 *
 * ## 目标行/列有两个来源
 *
 * | 来源 | 场景 | 怎么来的 |
 * |---|---|---|
 * | `target` 参数 | 鼠标 hover 表格工具栏 | 工具栏记住最后 hover 的单元格 |
 * | 不传 | 命令面板 / 斜杠菜单 | 退回「光标所在的行列」，没有就用默认值 |
 *
 * 两条路都必须能用：渲染态下光标**不在**表内（整张表是个 widget），
 * 工具栏拿不到光标；而展开成源码后光标又在表内，工具栏已经不在了。
 */

import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { CellAlign } from "./table";
import {
  addTableColumn,
  addTableRow,
  columnCount,
  getTableColumnAlign,
  removeTableColumn,
  removeTableRow,
  setTableColumnAlign,
  tableRowsGeometry,
  type RowSpan,
  type TableEdit,
} from "./table-edit";
import { findTables } from "./table";
import { getSyntaxTree } from "../live-preview/state";

/** 一个可操作的表格 */
export interface EditableTable {
  from: number;
  to: number;
  rows: RowSpan[];
  columns: number;
  /** 光标所在的数据行下标（2 起）；不在表内或落在表头时为 -1 */
  cursorRow: number;
  /** 光标所在的列下标（0 起）；不在表内时为 -1 */
  cursorColumn: number;
}

/** 操作作用的位置。`undefined` = 用光标位置。 */
export interface TableTarget {
  /** 数据行下标（几何行号，2 起） */
  row?: number;
  /** 列下标（0 起） */
  column?: number;
}

/**
 * 找出光标（或指定位置）所在的表格。
 *
 * @param at 指定位置；省略则取光标位置。
 *   工具栏要用这个——渲染态下光标在表外，但鼠标 hover 的单元格在表内。
 */
export function findEditableTable(view: EditorView, at?: number): EditableTable | null {
  const cursor = at ?? view.state.selection.main.head;
  const source = view.state.doc.toString();
  const tables = findTables(getSyntaxTree(view.state), source);
  const table = tables.find((t) => cursor >= t.from && cursor <= t.to);
  if (!table) return null;

  const rows = tableRowsGeometry(source, table.from, table.to);
  const columns = columnCount(rows);
  const row = rows.findIndex((r) => cursor >= r.from && cursor <= r.to);
  const column =
    row === -1
      ? -1
      : rows[row].cells.findIndex((c) => cursor >= c.from && cursor <= c.to);

  return {
    from: table.from,
    to: table.to,
    rows,
    columns,
    // 表头与分隔行不算「数据行」
    cursorRow: row >= 2 ? row : -1,
    cursorColumn: column,
  };
}

/** 把一次编辑变成事务并派发。返回是否真的改了文档。 */
function apply(
  view: EditorView,
  edit: TableEdit | null,
  selectTo: number | null,
): boolean {
  if (!edit) return false;
  view.dispatch({
    changes: { from: edit.from, to: edit.to, insert: edit.insert },
    selection:
      selectTo === null
        ? undefined
        : EditorSelection.cursor(Math.min(view.state.doc.length, selectTo)),
    // 归到「一次用户操作」，撤销栈里是一条而不是三条
    userEvent: "input.table",
  });
  return true;
}

/** 定操作作用的数据行：外部指定 > 光标 > 最后一行 */
function pickRow(table: EditableTable, target?: TableTarget): number {
  if (target?.row !== undefined) return target.row;
  if (table.cursorRow >= 2) return table.cursorRow;
  return table.rows.length - 1;
}

/** 定操作作用的列：外部指定 > 光标 > 第一列 */
function pickColumn(table: EditableTable, target?: TableTarget): number {
  if (target?.column !== undefined) return target.column;
  if (table.cursorColumn >= 0) return table.cursorColumn;
  return 0;
}

/* ═══════════════════════════════════════════════════════════
 * 命令
 * ═══════════════════════════════════════════════════════════ */

/**
 * 插入一个空行。`target.row` 指定时插在它**之后**，否则追加到末尾。
 *
 * 光标落进新行：插到中间时落在新行的第一个单元格开头，追加时落在末尾。
 */
export function commandAddTableRow(
  view: EditorView,
  target?: TableTarget,
  at?: number,
): boolean {
  const table = findEditableTable(view, at);
  if (!table) return false;
  const source = view.state.doc.toString();
  const edit = addTableRow(source, table.rows, target?.row);
  if (!edit) return false;
  // 新行是 `from + 1 + "|"`，光标落在第一个 `|` 之后
  return apply(view, edit, edit.from + 2);
}

/** 删掉一行。`target.row` 指定时删它，否则删光标所在行 / 最后一行。 */
export function commandRemoveTableRow(
  view: EditorView,
  target?: TableTarget,
  at?: number,
): boolean {
  const table = findEditableTable(view, at);
  if (!table) return false;
  const source = view.state.doc.toString();
  const edit = removeTableRow(source, table.rows, pickRow(table, target));
  if (!edit) return false;
  // 光标收回到表格起点，别落到被删掉的位置之后
  return apply(view, edit, table.from + 1);
}

/** 在某一列之后插入一列；没有列时插到最前面。 */
export function commandAddTableColumn(
  view: EditorView,
  target?: TableTarget,
  at?: number,
): boolean {
  const table = findEditableTable(view, at);
  if (!table) return false;
  const source = view.state.doc.toString();
  const edit = addTableColumn(source, table.rows, pickColumn(table, target));
  if (!edit) return false;
  return apply(view, edit, null);
}

/** 删掉某一列；没指定时删光标所在列 / 最后一列。 */
export function commandRemoveTableColumn(
  view: EditorView,
  target?: TableTarget,
  at?: number,
): boolean {
  const table = findEditableTable(view, at);
  if (!table) return false;
  const source = view.state.doc.toString();
  const column = pickColumn(table, target);
  const edit = removeTableColumn(source, table.rows, column);
  if (!edit) return false;
  return apply(view, edit, null);
}

/** 设某一列的对齐方式。 */
export function commandSetTableAlign(
  view: EditorView,
  align: CellAlign | null,
  target?: TableTarget,
  at?: number,
): boolean {
  const table = findEditableTable(view, at);
  if (!table) return false;
  const source = view.state.doc.toString();
  const edit = setTableColumnAlign(source, table.rows, pickColumn(table, target), align);
  if (!edit) return false;
  return apply(view, edit, null);
}

/** 某一列当前的对齐（工具栏按钮的高亮状态用） */
export function columnAlignAt(table: EditableTable, column: number): CellAlign | null {
  return getTableColumnAlign(table.rows, column);
}

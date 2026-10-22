/**
 * 表格结构编辑的护栏测试。
 *
 * 这一层是纯函数（源码 → 替换区间），所以每个操作都能对着**精确的输出字符串**断言。
 *
 * 判据不是「渲染出来对不对」而是「源码变成了什么」——
 * 红线 1 要求真相源是 Markdown 文本，那么正确性的唯一落点就是源码本身。
 */

import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { findTables } from "@/editor/render/table";
import { gfmMarkdownLanguage } from "@/editor/markdown-language";
import { ensureSyntaxTree } from "@codemirror/language";
import type { Tree } from "@lezer/common";
import {
  addTableColumn,
  addTableRow,
  columnCount,
  getTableColumnAlign,
  isDelimiterRow,
  removeTableColumn,
  removeTableRow,
  setTableColumnAlign,
  splitRow,
  tableRowsGeometry,
} from "@/editor/render/table-edit";

/** 取源码里第一张表的行几何 */
function geometryOf(doc: string) {
  const state = EditorState.create({ doc, extensions: [gfmMarkdownLanguage] });
  const tree: Tree = ensureSyntaxTree(state, gfmMarkdownLanguage, 10_000);
  const [table] = findTables(tree, doc);
  if (!table) throw new Error(`文档里没有表格：\n${doc}`);
  return { table, rows: tableRowsGeometry(doc, table.from, table.to), doc };
}

/** 套用一次编辑，返回新文档 */
function applyEdit(doc: string, edit: { from: number; to: number; insert: string } | null): string {
  if (!edit) throw new Error("预期有一次编辑，实际是 null");
  return doc.slice(0, edit.from) + edit.insert + doc.slice(edit.to);
}

const SIMPLE = ["| 名称 | 说明 |", "| --- | --- |", "| 甲 | 一 |", "| 乙 | 二 |"].join("\n");

/* ═══════════════════════════════════════════════════════════ */

describe("行几何", () => {
  it("每行的列数与内容", () => {
    const { rows } = geometryOf(SIMPLE);
    expect(rows).toHaveLength(4);
    expect(rows[0].cells.map((c) => c.text)).toEqual(["名称", "说明"]);
    expect(rows[0].hasLeadingPipe).toBe(true);
    expect(rows[0].hasTrailingPipe).toBe(true);
  });

  it("行号约定：0 表头 / 1 分隔行 / 2+ 数据行", () => {
    const { rows } = geometryOf(SIMPLE);
    expect(rows[0].isDelimiter).toBe(false);
    expect(rows[1].isDelimiter).toBe(true);
    expect(rows[2].isDelimiter).toBe(false);
  });

  it("列数取表头", () => {
    expect(columnCount(geometryOf(SIMPLE).rows)).toBe(2);
  });

  it("列区间指向真实字符（不是 trim 后的猜测位置）", () => {
    const doc = SIMPLE;
    const { rows } = geometryOf(doc);
    for (const cell of rows[0].cells) {
      expect(doc.slice(cell.from, cell.to)).toBe(cell.text);
    }
  });

  it("转义的竖线不算分列", () => {
    const parsed = splitRow("| a \\| b | c |", 0);
    expect(parsed.cells.map((c) => c.text)).toEqual(["a \\| b", "c"]);
  });

  it("没有收尾边框也能切", () => {
    const parsed = splitRow("| a | b", 0);
    expect(parsed.hasTrailingPipe).toBe(false);
    expect(parsed.cells.map((c) => c.text)).toEqual(["a", "b"]);
  });

  it("行首没有边框也能切（GFM 允许 `a | b`）", () => {
    const parsed = splitRow("a | b", 0);
    expect(parsed.hasLeadingPipe).toBe(false);
    expect(parsed.cells.map((c) => c.text)).toEqual(["a", "b"]);
  });

  it("分隔行判据", () => {
    expect(isDelimiterRow("| --- | :---: |")).toBe(true);
    expect(isDelimiterRow("| - | :-: |")).toBe(true);
    expect(isDelimiterRow("| 名称 | 说明 |")).toBe(false);
    expect(isDelimiterRow("| --- |")).toBe(true); // 单列也是分隔行
  });
});

/* ═══════════════════════════════════════════════════════════
 * 增删行
 * ═══════════════════════════════════════════════════════════ */

describe("增删行", () => {
  it("追加一个空行（沿用最后一行的边框习惯）", () => {
    const { doc, rows } = geometryOf(SIMPLE);
    const result = applyEdit(doc, addTableRow(doc, rows));
    expect(result).toBe(
      ["| 名称 | 说明 |", "| --- | --- |", "| 甲 | 一 |", "| 乙 | 二 |", "|  |  |"].join("\n"),
    );
  });

  it("追加后仍是合法的 GFM 表（列数一致）", () => {
    const before = geometryOf(SIMPLE);
    const after = applyEdit(before.doc, addTableRow(before.doc, before.rows));
    expect(columnCount(geometryOf(after).rows)).toBe(2);
    expect(after.split("\n")).toHaveLength(5);
  });

  it("只有表头 + 分隔行时**照样能加行**（刚建出来的空表最需要它）", () => {
    // 回归：曾经用 `rows.length < 3` 当门槛，把这种状态挡掉了，
    // 结果「用命令面板刚插出来的表格」点「＋行」毫无反应。
    const doc = "| a | b |\n| --- | --- |";
    const { rows } = geometryOf(doc);
    const result = applyEdit(doc, addTableRow(doc, rows));
    expect(result).toBe(["| a | b |", "| --- | --- |", "|  |  |"].join("\n"));
    // 必须是仍然认得出来的表，否则这一行等于把表写坏了
    expect(columnCount(geometryOf(result).rows)).toBe(2);
  });

  it("没有分隔行就不算 GFM 表，什么都做不了", () => {
    const doc = "| a | b |";
    // 只敲了一行：连 `Table` 节点都还不存在，几何是手工造的
    const rows = tableRowsGeometry(doc, 0, doc.length);
    expect(addTableRow(doc, rows)).toBeNull();
  });

  it("删中间行，连同后面的换行", () => {
    const { doc, rows } = geometryOf(SIMPLE);
    expect(applyEdit(doc, removeTableRow(doc, rows, 2))).toBe(
      ["| 名称 | 说明 |", "| --- | --- |", "| 乙 | 二 |"].join("\n"),
    );
  });

  it("删最后一行，连同前面的换行（不留空行）", () => {
    const { doc, rows } = geometryOf(SIMPLE);
    const result = applyEdit(doc, removeTableRow(doc, rows, 3));
    expect(result).toBe(["| 名称 | 说明 |", "| --- | --- |", "| 甲 | 一 |"].join("\n"));
    expect(result.endsWith("\n")).toBe(false);
  });

  it("分隔行不能删", () => {
    const { doc, rows } = geometryOf(SIMPLE);
    expect(removeTableRow(doc, rows, 1)).toBeNull();
  });

  it("表头不能删", () => {
    const { doc, rows } = geometryOf(SIMPLE);
    expect(removeTableRow(doc, rows, 0)).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════
 * 增删列
 * ═══════════════════════════════════════════════════════════ */

describe("增删列", () => {
  it("在最后一列之后追加（分隔行也要加 `---`，否则表就不成立）", () => {
    const { doc, rows } = geometryOf(SIMPLE);
    const result = applyEdit(doc, addTableColumn(doc, rows, 1));
    expect(result).toBe(
      [
        "| 名称 | 说明 |  |",
        "| --- | --- | --- |",
        "| 甲 | 一 |  |",
        "| 乙 | 二 |  |",
      ].join("\n"),
    );
  });

  it("追加后仍是合法的 GFM 表", () => {
    const before = geometryOf(SIMPLE);
    const after = applyEdit(before.doc, addTableColumn(before.doc, before.rows, 1));
    const { rows } = geometryOf(after);
    expect(rows[1].isDelimiter).toBe(true);
    expect(columnCount(rows)).toBe(3);
    for (const row of rows) expect(row.cells.length).toBe(3);
  });

  it("在第一列之前插入", () => {
    const { doc, rows } = geometryOf(SIMPLE);
    const result = applyEdit(doc, addTableColumn(doc, rows, -1));
    expect(result).toBe(
      ["|  | 名称 | 说明 |", "| --- | --- | --- |", "|  | 甲 | 一 |", "|  | 乙 | 二 |"].join("\n"),
    );
  });

  it("在中间插入", () => {
    const { doc, rows } = geometryOf(SIMPLE);
    const result = applyEdit(doc, addTableColumn(doc, rows, 0));
    expect(columnCount(geometryOf(result).rows)).toBe(3);
  });

  it("删第一列", () => {
    const { doc, rows } = geometryOf(SIMPLE);
    expect(applyEdit(doc, removeTableColumn(doc, rows, 0))).toBe(
      ["| 说明 |", "| --- |", "| 一 |", "| 二 |"].join("\n"),
    );
  });

  it("删最后一列（重建成规范形式，列间不留多余空格）", () => {
    const { doc, rows } = geometryOf(SIMPLE);
    const result = applyEdit(doc, removeTableColumn(doc, rows, 1));
    expect(result).toBe(["| 名称 |", "| --- |", "| 甲 |", "| 乙 |"].join("\n"));
    expect(geometryOf(result).rows[0].cells.map((c) => c.text)).toEqual(["名称"]);
  });

  it("不能删到零列", () => {
    const doc = "| a |\n| --- |\n| 1 |";
    const { rows } = geometryOf(doc);
    expect(removeTableColumn(doc, rows, 0)).toBeNull();
  });

  it("afterColumn 的语义是「插在第几列**之后**」，-1 才是插最前面", () => {
    const { doc, rows } = geometryOf(SIMPLE);
    // afterColumn = 0 → 新列成为第 1 列（在「名称」右边）
    expect(applyEdit(doc, addTableColumn(doc, rows, 0))).toBe(
      ["| 名称 |  | 说明 |", "| --- | --- | --- |", "| 甲 |  | 一 |", "| 乙 |  | 二 |"].join("\n"),
    );
    // afterColumn = -1 → 新列成为第 0 列（插在最前）
    expect(applyEdit(doc, addTableColumn(doc, rows, -1))).toBe(
      ["|  | 名称 | 说明 |", "| --- | --- | --- |", "|  | 甲 | 一 |", "|  | 乙 | 二 |"].join("\n"),
    );
    // afterColumn = 列数 - 1 → 追加到末尾
    expect(applyEdit(doc, addTableColumn(doc, rows, 1))).toBe(
      ["| 名称 | 说明 |  |", "| --- | --- | --- |", "| 甲 | 一 |  |", "| 乙 | 二 |  |"].join("\n"),
    );
  });

  it("增删一轮之后内容不串位（列数与内容都对得上）", () => {
    const before = geometryOf(SIMPLE);
    // -1 = 插在最前面，接着删第 0 列 → 正好把刚插的那列删掉，回到原样
    const added = applyEdit(before.doc, addTableColumn(before.doc, before.rows, -1));
    const mid = geometryOf(added);
    const removed = applyEdit(added, removeTableColumn(added, mid.rows, 0));
    // 插了一列又删掉这一列 → 回到原样（分隔行也要还原）
    expect(removed).toBe(SIMPLE);
  });
});

/* ═══════════════════════════════════════════════════════════
 * 对齐
 * ═══════════════════════════════════════════════════════════ */

describe("列对齐", () => {
  it("读当前对齐", () => {
    const doc = ["| a | b | c |", "| :-- | :-: | --: |", "| 1 | 2 | 3 |"].join("\n");
    const { rows } = geometryOf(doc);
    expect(getTableColumnAlign(rows, 0)).toBe("left");
    expect(getTableColumnAlign(rows, 1)).toBe("center");
    expect(getTableColumnAlign(rows, 2)).toBe("right");
  });

  it("未指定对齐时读成 null", () => {
    const { rows } = geometryOf(SIMPLE);
    expect(getTableColumnAlign(rows, 0)).toBeNull();
  });

  it("设居中：只改分隔行那一格", () => {
    const { doc, rows } = geometryOf(SIMPLE);
    expect(applyEdit(doc, setTableColumnAlign(doc, rows, 0, "center"))).toBe(
      ["| 名称 | 说明 |", "| :-: | --- |", "| 甲 | 一 |", "| 乙 | 二 |"].join("\n"),
    );
  });

  it("设左 / 右对齐", () => {
    const { doc, rows } = geometryOf(SIMPLE);
    expect(applyEdit(doc, setTableColumnAlign(doc, rows, 1, "right"))).toContain("| --- | --: |");
    const b = geometryOf(doc).rows;
    expect(applyEdit(doc, setTableColumnAlign(doc, b, 1, "left"))).toContain("| --- | :-- |");
  });

  it("取消对齐回到 `---`", () => {
    const doc = ["| a |", "| :-: |", "| 1 |"].join("\n");
    const { rows } = geometryOf(doc);
    expect(applyEdit(doc, setTableColumnAlign(doc, rows, 0, null))).toBe(
      ["| a |", "| --- |", "| 1 |"].join("\n"),
    );
  });

  it("改完对齐仍然是合法 GFM 表", () => {
    const { doc, rows } = geometryOf(SIMPLE);
    const result = applyEdit(doc, setTableColumnAlign(doc, rows, 1, "center"));
    const after = geometryOf(result).rows;
    expect(after[1].isDelimiter).toBe(true);
    expect(getTableColumnAlign(after, 1)).toBe("center");
  });
});
/**
 * 表格图形化编辑：工具栏 DOM + 事务层。
 *
 * 纯函数层（`table-edit.ts`）的护栏在 `table-edit.test.ts`；
 * 这一层验的是「DOM 上写的东西够不够把事务层喂起来」——
 * 也就是坐标属性、动作名、hover 标签这些**契约**。
 *
 * 最容易坏的地方是契约对不上：工具栏发的是几何行号 2，
 * 命令层按数据行 1 去读，于是「＋行」永远插在错的地方，
 * 而且不报错、测试也全绿——所以这里直接把两边接起来跑。
 */

import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import { livePreview } from "@/editor/live-preview";
import {
  CELL_COL_ATTR,
  CELL_ROW_ATTR,
  TABLE_ACTIONS,
  TOOLBAR_ATTR,
  createTableToolbar,
  highlightHover,
  markCell,
  rowLabel,
} from "@/editor/render/table-toolbar";
import {
  commandAddTableColumn,
  commandAddTableRow,
  commandRemoveTableColumn,
  commandRemoveTableRow,
  commandSetTableAlign,
  findEditableTable,
} from "@/editor/render/table-operations";

const DOC = [
  "| 名称 | 说明 |",
  "| --- | --- |",
  "| 甲 | 一 |",
  "| 乙 | 二 |",
].join("\n");

function createEditor(doc = DOC): EditorView {
  const parent = document.body.appendChild(document.createElement("div"));
  return new EditorView({
    state: EditorState.create({ doc, extensions: [history(), livePreview()] }),
    parent,
  });
}

/** 渲染出来的表格 DOM */
function renderedTable(): HTMLElement {
  const table = document.querySelector(".cm-md-table");
  if (!table) throw new Error("编辑器里没有渲染出表格");
  return table as HTMLElement;
}

/* ═══════════════════════════════════════════════════════════ */

describe("工具栏 DOM", () => {
  it("八个动作各有一个按钮，且都带 data-table-action", () => {
    const bar = createTableToolbar();
    for (const action of TABLE_ACTIONS) {
      expect(bar.querySelector(`[data-table-action="${action}"]`)).not.toBeNull();
    }
    expect(bar.querySelectorAll("[data-table-action]")).toHaveLength(TABLE_ACTIONS.length);
  });

  it("不可编辑：按钮里有原生 <button>，光标进去就等于吞输入", () => {
    // 和「未闭合围栏吞输入」是同一类事故：块级 widget 里放可聚焦元素，
    // 浏览器把光标放进去后，之后敲的字全部消失
    expect(createTableToolbar().contentEditable).toBe("false");
  });

  it("有工具栏标记属性，供 mousedown 分发识别", () => {
    expect(createTableToolbar().hasAttribute(TOOLBAR_ATTR)).toBe(true);
  });
});

describe("行号翻译", () => {
  it("几何行号 → 用户看得懂的标签", () => {
    expect(rowLabel(0, 1)).toBe("表头 · 第 1 列");
    // 几何 2 是**第一个数据行**，用户数它是「第 1 行」
    expect(rowLabel(2, 1)).toBe("第 1 行 · 第 1 列");
    expect(rowLabel(3, 2)).toBe("第 2 行 · 第 2 列");
  });
});

describe("渲染出来的坐标", () => {
  it("表头是 0，数据行从 2 起（1 是看不见的分隔行）", () => {
    createEditor();
    const table = renderedTable();
    expect(table.querySelector("thead th")?.getAttribute(CELL_ROW_ATTR)).toBe("0");
    expect(table.querySelector("thead th")?.getAttribute(CELL_COL_ATTR)).toBe("0");

    const firstBody = table.querySelectorAll("tbody tr")[0].querySelectorAll("td");
    expect(firstBody[0].getAttribute(CELL_ROW_ATTR)).toBe("2");
    expect(firstBody[1].getAttribute(CELL_COL_ATTR)).toBe("1");
    expect(firstBody[1].textContent).toBe("一");
  });

  it("hover 高亮把同一行与同一列都点亮", () => {
    createEditor();
    const table = renderedTable();
    highlightHover(table, 2, 0);
    const lit = [...table.querySelectorAll("[data-highlight]")];
    // 第 0 列 = 表头 1 格 + 两个数据行各 1 格 = 3；
    // 第 1 行（几何 2）的两格 = 2，其中「一」已在第 0 列里，去重后 4
    expect(lit).toHaveLength(4);
    expect(lit.map((c) => c.textContent)).toContain("名称");
    expect(lit.map((c) => c.textContent)).toContain("一");
    expect(lit.map((c) => c.textContent)).toContain("乙");
    // 第二行第二格既不同行也不同列，不该亮
    expect(lit.map((c) => c.textContent)).not.toContain("二");
  });

  it("markCell 写出的坐标可被读回", () => {
    const td = document.createElement("td");
    markCell(td, 4, 7);
    expect(td.getAttribute(CELL_ROW_ATTR)).toBe("4");
    expect(td.getAttribute(CELL_COL_ATTR)).toBe("7");
  });

  it("**渲染时就预置 hover 坐标**——否则连点第二个按钮必然失效", () => {
    // 回归：任何一次表格改动都会让这个 DOM 被重建，hover 写在元素上的坐标随之消失。
    // 症状是「点完第一个按钮有反应，第二个就没反应了」，
    // 而且不报错——用户只会当成功能坏了。
    createEditor();
    const wrap = document.querySelector(".cm-md-table-wrap") as HTMLElement;
    expect(wrap.dataset.hoverRow).toBeDefined();
    expect(wrap.dataset.hoverCol).toBeDefined();
    expect(Number(wrap.dataset.hoverCol)).toBe(1); // SIMPLE 两列 → 最后一列

    // 标签说的位置必须就是实际操作的位置
    const pos = wrap.querySelector(".cm-md-table-bar__pos")?.textContent;
    expect(pos).toBe(rowLabel(Number(wrap.dataset.hoverRow), Number(wrap.dataset.hoverCol) + 1));
  });
});

/* ═══════════════════════════════════════════════════════════ */

describe("事务层", () => {
  it("工具栏给的坐标能直接驱动增删——行号不需要换算", () => {
    const view = createEditor();
    const from = Number(view.dom.querySelector<HTMLElement>(".cm-md-table-wrap")?.dataset.blockFrom);
    expect(Number.isFinite(from)).toBe(true);

    // 悬停在**第一个**数据行（几何行 2）上点「＋行」→ 插在它下面，
    // 而不是追加到末尾——这条断言就是为了钉住「行号是相对的」
    expect(commandAddTableRow(view, { row: 2 }, from + 1)).toBe(true);
    const lines = view.state.doc.toString().split("\n");
    expect(lines).toHaveLength(5);
    expect(lines[2]).toBe("| 甲 | 一 |");
    expect(lines[3]).toBe("|  |  |");
    expect(lines[4]).toBe("| 乙 | 二 |");
  });

  it("悬停列上点「＋列」→ 插在那一列右边", () => {
    const view = createEditor();
    const from = Number(view.dom.querySelector<HTMLElement>(".cm-md-table-wrap")?.dataset.blockFrom);
    expect(commandAddTableColumn(view, { column: 0 }, from + 1)).toBe(true);
    expect(view.state.doc.toString().split("\n")[0]).toBe("| 名称 |  | 说明 |");
  });

  it("删行删的是悬停的那一行", () => {
    const view = createEditor();
    const from = Number(view.dom.querySelector<HTMLElement>(".cm-md-table-wrap")?.dataset.blockFrom);
    expect(commandRemoveTableRow(view, { row: 2 }, from + 1)).toBe(true);
    expect(view.state.doc.toString()).not.toContain("甲");
    expect(view.state.doc.toString()).toContain("乙");
  });

  it("删列删的是悬停的那一列", () => {
    const view = createEditor();
    const from = Number(view.dom.querySelector<HTMLElement>(".cm-md-table-wrap")?.dataset.blockFrom);
    expect(commandRemoveTableColumn(view, { column: 1 }, from + 1)).toBe(true);
    const lines = view.state.doc.toString().split("\n");
    expect(lines[0]).toBe("| 名称 |");
    expect(lines[2]).toBe("| 甲 |");
  });

  it("对齐写进分隔行，不是只改渲染出来的 style", () => {
    const view = createEditor();
    const from = Number(view.dom.querySelector<HTMLElement>(".cm-md-table-wrap")?.dataset.blockFrom);
    expect(commandSetTableAlign(view, "center", { column: 1 }, from + 1)).toBe(true);
    expect(view.state.doc.toString().split("\n")[1]).toBe("| --- | :-: |");
  });

  it("取消对齐回到 ---", () => {
    const view = createEditor();
    const from = Number(view.dom.querySelector<HTMLElement>(".cm-md-table-wrap")?.dataset.blockFrom);
    commandSetTableAlign(view, "right", { column: 0 }, from + 1);
    expect(commandSetTableAlign(view, null, { column: 0 }, from + 1)).toBe(true);
    expect(view.state.doc.toString().split("\n")[1]).toBe("| --- | --- |");
  });

  it("光标不在表内时不发事务（工具栏不会误伤别的表）", () => {
    const view = createEditor("正文一句话\n\n| a |\n| --- |\n| 1 |");
    expect(findEditableTable(view)).toBeNull();
    expect(commandAddTableRow(view)).toBe(false);
    expect(view.state.doc.toString()).toBe("正文一句话\n\n| a |\n| --- |\n| 1 |");
  });

  it("一次操作 = 撤销栈里的一条", () => {
    const view = createEditor();
    const from = Number(view.dom.querySelector<HTMLElement>(".cm-md-table-wrap")?.dataset.blockFrom);
    commandAddTableRow(view, { row: 2 }, from + 1);
    expect(view.state.doc.toString().split("\n")).toHaveLength(5);

    undo(view);
    // 撤一次就该完全回到原样；拆成多个事务的话这里会只撤掉一半
    expect(view.state.doc.toString()).toBe(DOC);
  });
});
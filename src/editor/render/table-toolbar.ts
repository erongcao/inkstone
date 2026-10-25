/**
 * 表格工具栏：渲染态表格上方的一排小按钮（增删行列 / 对齐）。
 *
 * ## 为什么工具栏挂在**渲染出来的 `<table>`** 上，而不是命令面板独占
 *
 * 渲染态下整张表是一个块级 widget，光标在表外（`findEditableTable` 按光标找表会扑空），
 * 所以工具栏必须自己知道「用户指的是哪一行哪一列」——靠 **mouseover 时记下的单元格坐标**。
 *
 * 展开态（光标进表 → 表格切成源码行）下工具栏整个消失：
 * 那时用户已经在改 Markdown 文本了，再摆一排图形按钮反而干扰。
 * 这是「两种形态各给各的入口」，不是功能缺失。
 *
 * ## 分工：这一层只造 DOM，不碰文档
 *
 * 按钮只带 `data-table-action`，真正的事务在
 * `live-preview/index.ts` 的 mousedown 分发里做——那里才拿得到 `EditorView`。
 * hover 状态同理，写回 wrapper 的 `dataset`，不触发任何重渲染。
 *
 * ## 行列坐标用**几何行号**（0 表头 / 1 分隔行 / 2+ 数据行）
 *
 * 与 `table-edit.ts` 同一套约定，少一次换算少一处错。
 * 标签上给用户看的是「第 2 行」这种人类说法，由 `rowLabel` 负责翻译。
 */

import { t } from "@/i18n";

/** 工具栏动作。值直接进 `data-table-action`。 */
export const TABLE_ACTIONS = [
  "row-add",
  "row-del",
  "col-add",
  "col-del",
  "align-left",
  "align-center",
  "align-right",
  "align-default",
] as const;

export type TableAction = (typeof TABLE_ACTIONS)[number];

interface ToolbarButton {
  action: TableAction;
  label: string;
  title: string;
}

const BUTTONS: ToolbarButton[] = [
  { action: "row-add", label: "＋行", title: "在下方插入一行" },
  { action: "row-del", label: "－行", title: "删除这一行" },
  { action: "col-add", label: "＋列", title: "在右侧插入一列" },
  { action: "col-del", label: "－列", title: "删除这一列" },
  { action: "align-left", label: "左", title: "这一列左对齐" },
  { action: "align-center", label: "中", title: "这一列居中对齐" },
  { action: "align-right", label: "右", title: "这一列右对齐" },
  { action: "align-default", label: "默认", title: "取消这一列的对齐设置" },
];

const ALIGN_ACTIONS: readonly string[] = ["align-left", "align-center", "align-right"];

/** 工具栏 DOM 上的标记属性（分发时用来区分「点工具栏」与「点表格」） */
export const TOOLBAR_ATTR = "data-table-toolbar";
/** 单元格坐标属性：`data-cell-row` / `data-cell-col`，值是几何行列号 */
export const CELL_ROW_ATTR = "data-cell-row";
export const CELL_COL_ATTR = "data-cell-col";

/**
 * 造一排工具栏。
 *
 * `contenteditable="false"` 是必须的：块级 widget 默认不可编辑，
 * 但工具栏里有 `<button>`，浏览器可能把光标放进去，之后打字就丢了
 * ——和「未闭合围栏吞输入」是同一类问题。
 */
export function createTableToolbar(): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "cm-md-table-bar";
  bar.setAttribute(TOOLBAR_ATTR, "");
  bar.contentEditable = "false";

  const pos = document.createElement("span");
  pos.className = "cm-md-table-bar__pos";
  bar.appendChild(pos);

  const rowGroup = group(bar, t("＋行/－行"));
  const colGroup = group(bar, t("＋列/－列"));
  const alignGroup = group(bar, t("对齐"));

  for (const { action, label, title } of BUTTONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-md-table-bar__btn";
    button.dataset.tableAction = action;
    button.textContent = t(label);
    button.title = t(title);
    button.setAttribute("aria-label", t(title));

    if (action.startsWith("row-")) rowGroup.appendChild(button);
    else if (action.startsWith("col-")) colGroup.appendChild(button);
    else alignGroup.appendChild(button);
  }

  return bar;
}

function group(bar: HTMLElement, label: string): HTMLElement {
  const g = document.createElement("span");
  g.className = "cm-md-table-bar__group";
  g.setAttribute("role", "group");
  g.setAttribute("aria-label", label);
  bar.appendChild(g);
  return g;
}

/** 给单元格打坐标标记。表头 row=0，数据行 2 起，与几何行号一致。 */
export function markCell(cell: HTMLElement, row: number, col: number): void {
  cell.setAttribute(CELL_ROW_ATTR, String(row));
  cell.setAttribute(CELL_COL_ATTR, String(col));
}

/**
 * 把 hover 位置翻译成给用户看的标签。
 *
 * 几何行号里 0 是表头、1 是分隔行（用户根本看不见），所以从 2 开始才叫「第 1 行」。
 */
export function rowLabel(geometryRow: number, columns: number): string {
  const where =
    geometryRow === 0 ? t("表头") : t("第 {row} 行", { row: geometryRow - 1 });
  return t("{where} · 第 {columns} 列", { where, columns });
}

/** 把 hover 状态写回工具栏（纯 DOM，不触发重渲染） */
export function paintToolbar(
  bar: HTMLElement,
  geometryRow: number,
  columns: number,
): void {
  const pos = bar.querySelector(".cm-md-table-bar__pos");
  if (pos) pos.textContent = rowLabel(geometryRow, columns);
}

/**
 * 按当前状态启用/禁用按钮。
 *
 * 表头不能删行、只剩一列不能删列——按钮直接 disabled，
 * 好过点下去什么都没发生（用户会以为功能坏了）。
 */
export function syncToolbarState(
  bar: HTMLElement,
  opts: { geometryRow: number; columnCount: number; align: string | null },
): void {
  const setDisabled = (action: string, disabled: boolean): void => {
    const button = bar.querySelector<HTMLButtonElement>(
      `[data-table-action="${action}"]`,
    );
    if (button) button.disabled = disabled;
  };
  setDisabled("row-del", opts.geometryRow < 2);
  setDisabled("col-del", opts.columnCount <= 1);

  for (const action of ALIGN_ACTIONS) {
    const button = bar.querySelector<HTMLButtonElement>(
      `[data-table-action="${action}"]`,
    );
    if (button)
      button.classList.toggle("is-active", button.dataset.tableAction === opts.align);
  }
  setDisabled("align-default", opts.align === null);
}

/** 读出按钮上的动作；不是工具栏元素则返回 null */
export function actionOf(target: HTMLElement | null): TableAction | null {
  const button = target?.closest?.("[data-table-action]") as HTMLElement | null;
  const action = button?.dataset.tableAction;
  return action ? (action as TableAction) : null;
}

/** 高亮 hover 的那一行/列（让用户看得见工具栏指的是哪儿） */
export function highlightHover(table: HTMLElement, row: number, col: number): void {
  for (const cell of table.querySelectorAll("[data-highlight]")) {
    cell.removeAttribute("data-highlight");
  }
  const cells = table.querySelectorAll<HTMLElement>("[data-cell-row]");
  for (const cell of cells) {
    if (
      Number(cell.getAttribute(CELL_ROW_ATTR)) === row ||
      Number(cell.getAttribute(CELL_COL_ATTR)) === col
    ) {
      cell.setAttribute("data-highlight", "");
    }
  }
}

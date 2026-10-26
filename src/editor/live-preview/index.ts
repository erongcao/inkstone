/**
 * Live Preview 扩展（CodeMirror 6）。
 *
 * 把「Markdown 源码编辑器」变成「Typora 式混合编辑器」：
 *   - 编辑器里存的是**纯 Markdown 文本**（单一真相源，永不漂移）
 *   - 视觉上的渲染由装饰器（Decoration）完成
 *   - 源码模式 = 关掉这组装饰器，文本原样显示
 *
 * 这个设计带来三个「白送」的能力：
 *   1. 源码 ↔ 实时模式切换 = 同一个编辑器切装饰器 → 光标、滚动、撤销栈天然保持
 *   2. 标记符是真实文本 → 可以像 Typora 一样直接编辑 `**`
 *   3. 中文输入法由 CM6 的成熟文本编辑逻辑处理，不需要自己操心
 *
 * 三种显示策略（调研依据见 docs/editors-comparison.md）：
 *   - `live`   标记隐藏，光标进入才显露（Typora）
 *   - `dimmed` 标记始终可见但弱化着色（Ulysses）
 *   - `source` 纯源码，不做渲染（Typora 源码模式 / Bear 通用模式）
 */

import { Decoration, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { buildLivePreviewDecorations } from "./decorations";
import {
  livePreviewField,
  setDisplayMode,
  refreshRendering,
  getSyntaxTree,
  initialFeaturesFacet,
} from "./state";
import { registerBlockRenderer } from "../render/registry";
import { codeBlockRenderer } from "../render/code-block";
import { mathBlockRenderer } from "../render/math-block";
import { tableRenderer } from "../render/table";
import { findTaskItems, taskToggleChange } from "../render/task-list";
import { onMathRendererReady } from "../render/math-loader";
import { onDiagramRendered } from "../render/mermaid-loader";
import { mermaidBlockRenderer } from "../render/mermaid";
import {
  CELL_COL_ATTR,
  CELL_ROW_ATTR,
  TOOLBAR_ATTR,
  actionOf,
  highlightHover,
  paintToolbar,
  syncToolbarState,
} from "../render/table-toolbar";
import {
  columnAlignAt,
  commandAddTableColumn,
  commandAddTableRow,
  commandRemoveTableColumn,
  commandRemoveTableRow,
  commandSetTableAlign,
  findEditableTable,
} from "../render/table-operations";
import type { MarkerDisplayMode } from "@/settings/schema";
import { DEFAULT_FEATURES, type MarkdownFeatures } from "@/parser/features";

/**
 * Live Preview 装饰器。
 *
 * 为什么走 `EditorView.decorations` facet 而不是 ViewPlugin：
 *   CM6 明确规定**块级装饰器**（`Decoration.replace({ block: true })`）
 *   不能通过插件提供——插件的装饰器不参与文档高度计算，
 *   而块级 widget 会改变行高，必须走 facet 这条静态路径。
 *   实测报错：`RangeError: Block decorations may not be specified via plugins`。
 *
 * `decorations.from(field, get)` 的 get 只接受一个字段作为依赖，
 * 所以 `livePreviewField` 把语法树、显示策略、光标位置收在一起（见 state.ts）。
 * 字段值每次事务都返回新对象 → 装饰器每次都重算，行为与 ViewPlugin 版一致。
 */
const livePreviewDecorations = EditorView.decorations.from(
  livePreviewField,
  ({ source, cursor, mode, tree, features }) => {
    // 源码模式：不做任何渲染
    if (mode === "source") return Decoration.none;
    return buildLivePreviewDecorations(source, cursor, mode, tree, features);
  },
);

/**
 * KaTeX 按需加载完成 → 强制装饰器重算。
 *
 * 问题的形状：文档一个字没变，但公式块的 DOM 必须从「源码」换成「渲染后」。
 * 而 `livePreviewField.update` 在「无文档变更 + 光标没动 + 模式没变」时会
 * `return value` 短路掉，字段值身份不变，CM6 就不会重跑装饰器映射
 *（实测表现：公式一直停在源码形态，直到用户敲下一个字符才刷新）。
 * 所以只能用一个显式 effect 打破短路（见 `state.ts` 的 `refreshRendering`）。
 *
 * 用 ViewPlugin 而不是模块级变量：这里需要拿到 `EditorView` 才能 dispatch，
 * 而扩展工厂返回的是 Extension，拿不到实例。
 */
const mathReadinessWatcher = ViewPlugin.fromClass(
  class {
    private readonly unsubscribe: () => void;

    constructor(view: EditorView) {
      this.unsubscribe = onMathRendererReady(() => {
        view.dispatch({ effects: refreshRendering.of(null) });
      });
    }

    update(_update: ViewUpdate): void {
      /* 本插件不关心更新，只在构造时订阅一次 */
    }

    destroy(): void {
      this.unsubscribe();
    }
  },
);

/**
 * Mermaid 渲染完成 → 强制装饰器重算。
 *
 * 理由与 `mathReadinessWatcher` **完全相同**（文档没变、但块的 DOM 必须换），
 * 所以复用同一个 `refreshRendering` effect，而不是另造一个。
 *
 * 差别是 mermaid 会**反复**触发（每次一段新代码渲染完都通知一次），
 * 所以额外加一层节流：250ms 内多次通知只重算一次。
 * 没有这层的话，一篇文档里十张图会触发十轮装饰器重算。
 */
const mermaidReadinessWatcher = ViewPlugin.fromClass(
  class {
    private readonly unsubscribe: () => void;
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(view: EditorView) {
      this.unsubscribe = onDiagramRendered(() => {
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          this.timer = null;
          view.dispatch({ effects: refreshRendering.of(null) });
        }, 250);
      });
    }

    update(_update: ViewUpdate): void {
      /* 只在构造时订阅一次 */
    }

    destroy(): void {
      this.unsubscribe();
      if (this.timer !== null) clearTimeout(this.timer);
    }
  },
);

/**
 * 鼠标指的是哪个单元格（工具栏按钮自己不算）。
 *
 * 返回带 `data-cell-row` 的 `<td>`/`<th>`。
 */
function hoverCell(target: HTMLElement | null): HTMLElement | null {
  return target?.closest?.(`[${CELL_ROW_ATTR}]`) as HTMLElement | null;
}

/**
 * 执行一次表格工具栏动作。
 *
 * 位置来自 wrapper 上 `data-hover-row/col`（mouseover 时写的），
 * 文档位置来自 `data-block-from`（BlockWidget 写的表格起点）——
 * 渲染态下光标在表外，必须显式告诉命令层「是哪张表」。
 *
 * 点在按钮之间的空隙上（actionOf 返回 null）时不做任何事，也不吞事件。
 */
function runTableAction(
  view: EditorView,
  bar: HTMLElement,
  target: HTMLElement | null,
): void {
  const action = actionOf(target);
  if (!action) return;

  const wrap = bar.closest(".cm-md-table-wrap") as HTMLElement | null;
  if (!wrap) return;

  const blockFrom = Number(wrap.dataset.blockFrom);
  if (!Number.isFinite(blockFrom)) return;

  // 坐标缺失时**退到文档算出来的默认行列**，而不是静默什么都不做。
  // `tableRenderer.render` 已经预置过坐标，这里只是兜底：
  // 工具栏按钮点下去却毫无反应，用户只会当成功能坏了。
  const fallback = findEditableTable(view, blockFrom + 1);
  const row = Number.isFinite(Number(wrap.dataset.hoverRow))
    ? Number(wrap.dataset.hoverRow)
    : Math.max((fallback?.rows.length ?? 2) - 1, 2);
  const col = Number.isFinite(Number(wrap.dataset.hoverCol))
    ? Number(wrap.dataset.hoverCol)
    : Math.max((fallback?.columns ?? 1) - 1, 0);

  const at = blockFrom + 1;
  const where = { row, column: col };
  const ALIGN = {
    "align-left": "left",
    "align-center": "center",
    "align-right": "right",
  } as const;

  switch (action) {
    case "row-add":
      commandAddTableRow(view, where, at);
      break;
    case "row-del":
      commandRemoveTableRow(view, where, at);
      break;
    case "col-add":
      commandAddTableColumn(view, where, at);
      break;
    case "col-del":
      commandRemoveTableColumn(view, where, at);
      break;
    default:
      // `align-default` 不在 ALIGN 里 → undefined → 取消对齐
      commandSetTableAlign(view, ALIGN[action as keyof typeof ALIGN], where, at);
      break;
  }
}

/**
 * Live Preview 扩展。
 *
 * `features` 是**创建编辑器时**生效的开关：
 * 它被塞进一个 facet，`StateField.create` 从里面取——
 * 于是第一棵树就是按用户设置解析出来的，
 * 不会出现「先按默认规则渲染一帧、再纠正」的情况（理由见 state.ts）。
 *
 * 初值不通过 StateField 传入（StateField 没有 init 配置项），
 * 显示策略那部分由调用方在创建编辑器后派发一次 effect 设置——
 * 见 `createMarkdownEditor` 里的 `initialDisplayMode`。
 */
export function livePreview(features: MarkdownFeatures = DEFAULT_FEATURES): Extension {
  // 注册块级渲染器（幂等，重复调用会覆盖）
  // 顺序有意义：后面的渲染器会拿到前面已占用的区间并让开。
  // **mermaid 必须排在 code-block 前面**——两者匹配同一个 `FencedCode` 节点。
  registerBlockRenderer(mermaidBlockRenderer);
  registerBlockRenderer(codeBlockRenderer);
  registerBlockRenderer(mathBlockRenderer);
  registerBlockRenderer(tableRenderer);

  return [
    initialFeaturesFacet.of(features),
    livePreviewField,
    livePreviewDecorations,
    mathReadinessWatcher,
    mermaidReadinessWatcher,
    // 表格工具栏的 hover 定位：记住鼠标指的是哪一行哪一列
    EditorView.domEventHandlers({
      mouseover: (event, view) => {
        const cell = hoverCell(event.target as HTMLElement | null);
        if (!cell) return false;
        const wrap = cell.closest(".cm-md-table-wrap") as HTMLElement | null;
        if (!wrap) return false;

        const row = Number(cell.getAttribute(CELL_ROW_ATTR));
        const col = Number(cell.getAttribute(CELL_COL_ATTR));
        wrap.dataset.hoverRow = String(row);
        wrap.dataset.hoverCol = String(col);

        const table = wrap.querySelector(".cm-md-table") as HTMLElement | null;
        if (table) highlightHover(table, row, col);

        const bar = wrap.querySelector(`[${TOOLBAR_ATTR}]`) as HTMLElement | null;
        if (!bar) return false;
        paintToolbar(bar, row, col + 1);

        // 对齐状态与列数必须回**文档**里读，不能只看渲染出来的 DOM：
        // DOM 上的 text-align 是上一次渲染的结果，而 Markdown 里可能压根没写对齐。
        // `data-block-from` 是 BlockWidget 写在 wrapper 上的表格起点。
        const blockFrom = Number(wrap.dataset.blockFrom);
        const tableState = Number.isFinite(blockFrom)
          ? findEditableTable(view, blockFrom + 1)
          : null;
        syncToolbarState(bar, {
          geometryRow: row,
          columnCount: tableState?.columns ?? 0,
          align: tableState ? columnAlignAt(tableState, col) : null,
        });
        return false;
      },
    }),
    // 点击渲染后的块 → 把光标移进块内 → 该块切回源码编辑
    EditorView.domEventHandlers({
      mousedown: (event, view) => {
        const target = event.target as HTMLElement | null;

        // 表格工具栏：必须在 `data-block-from` 分支**之前**。
        // wrapper 上带着 `data-block-from`（BlockWidget 写的），
        // 顺序反了点工具栏就会把表格切回源码——等于按钮永远点不动。
        const bar = target?.closest?.(`[${TOOLBAR_ATTR}]`) as HTMLElement | null;
        if (bar) {
          event.preventDefault();
          runTableAction(view, bar, target);
          view.focus();
          return true;
        }

        // 任务列表勾选框：`[data-task-at]`
        // 这是**唯一**会改写文档内容的交互——而且必须走普通事务，
        // 这样它天然进撤销栈、能被协作与保存流程看见。
        const task = target?.closest?.("[data-task-at]") as HTMLElement | null;
        if (task) {
          const at = Number(task.dataset.taskAt);
          if (!Number.isFinite(at)) return false;
          event.preventDefault();
          toggleTaskAt(view, at);
          view.focus();
          return true;
        }

        // 脚注跳转：`[data-footnote-jump]`
        // 点引用跳定义、点定义跳回第一个引用。**只移动光标，不改文档**——
        // 脚注内容本来就躺在 Markdown 文本里，这里只是带用户过去。
        const footnote = target?.closest?.("[data-footnote-jump]") as HTMLElement | null;
        if (footnote) {
          const to = Number(footnote.dataset.footnoteJump);
          if (!Number.isFinite(to)) return false;
          event.preventDefault();
          view.dispatch({
            selection: { anchor: to + 1 },
            effects: EditorView.scrollIntoView(to + 1, { y: "center" }),
          });
          view.focus();
          return true;
        }

        // 图片：`[data-image-from]`
        // 点渲染出来的图 → 光标移回源码位置，图片切回 `![…](…)` 原文，
        // 这样路径可以直接编辑（也才可能发现图裂了）
        const image = target?.closest?.("[data-image-from]") as HTMLElement | null;
        if (image) {
          const from = Number(image.dataset.imageFrom);
          if (!Number.isFinite(from)) return false;
          event.preventDefault();
          view.dispatch({ selection: { anchor: from + 1 } });
          view.focus();
          return true;
        }

        // 行内公式：`[data-inline-from]`
        const inline = target?.closest?.("[data-inline-from]") as HTMLElement | null;
        if (inline) {
          const at = Number(inline.dataset.inlineFrom);
          if (!Number.isFinite(at)) return false;
          event.preventDefault();
          view.dispatch({ selection: { anchor: at + 1 } });
          view.focus();
          return true;
        }

        // 块级：`[data-block-from]`
        const block = target?.closest?.("[data-block-from]") as HTMLElement | null;
        if (!block) return false;
        const from = Number(block.dataset.blockFrom);
        if (!Number.isFinite(from)) return false;
        // 阻止默认行为（否则浏览器会放置原生选区）
        event.preventDefault();
        // 光标放到块的第一个字符之后——正好落在「块内」，
        // 装饰器重算后该块就展开成源码了
        view.dispatch({ selection: { anchor: from + 1 } });
        view.focus();
        return true;
      },
    }),
  ];
}

/** 编程式切换显示策略 */
export function setDisplayModeOf(view: EditorView, mode: MarkerDisplayMode): void {
  view.dispatch({ effects: setDisplayMode.of(mode) });
}

/**
 * 翻转某个位置的勾选框，并把改动**写回 Markdown 文本**。
 *
 * 为什么必须写回而不是只改 DOM：勾选状态是文档内容的一部分。
 * 只活在 widget 里的话，关掉文件就丢、复制到别处也是空的，
 * 而且永远不会被搜索/导出/打印看见——这会直接违反架构红线 1。
 *
 * 位置对不上（文档已被改动等）时静默返回，不做破坏性兜底。
 */
export function toggleTaskAt(view: EditorView, at: number): void {
  const state = view.state;
  const items = findTaskItems(getSyntaxTree(state), state.doc.toString());
  const item = items.find((it) => it.from === at);
  if (!item) return;
  const change = taskToggleChange(item);
  view.dispatch({ changes: { from: change.from, to: change.to, insert: change.insert } });
}

export { setDisplayMode };

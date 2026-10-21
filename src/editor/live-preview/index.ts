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
import { livePreviewField, setDisplayMode, refreshRendering } from "./state";
import { registerBlockRenderer } from "../render/registry";
import { codeBlockRenderer } from "../render/code-block";
import { mathBlockRenderer } from "../render/math-block";
import { onMathRendererReady } from "../render/math-loader";
import type { MarkerDisplayMode } from "@/settings/schema";

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
  ({ source, cursor, mode, tree }) => {
    // 源码模式：不做任何渲染
    if (mode === "source") return Decoration.none;
    return buildLivePreviewDecorations(source, cursor, mode, tree);
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
 * Live Preview 扩展。
 *
 * 初值不通过 StateField 传入（StateField 没有 init 配置项），
 * 而是由调用方在创建编辑器后派发一次 effect 设置——
 * 见 `createMarkdownEditor` 里的 `initialDisplayMode`。
 */
export function livePreview(): Extension {
  // 注册块级渲染器（幂等，重复调用会覆盖）
  registerBlockRenderer(codeBlockRenderer);
  registerBlockRenderer(mathBlockRenderer);

  return [
    livePreviewField,
    livePreviewDecorations,
    mathReadinessWatcher,
    // 点击渲染后的块 → 把光标移进块内 → 该块切回源码编辑
    EditorView.domEventHandlers({
      mousedown: (event, view) => {
        const target = event.target as HTMLElement | null;
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

export { setDisplayMode };

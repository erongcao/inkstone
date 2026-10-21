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

import {
  Decoration,
  ViewPlugin,
  type EditorView,
  type ViewUpdate,
  type DecorationSet,
} from "@codemirror/view";
import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { buildLivePreviewDecorations } from "./decorations";
import { syntaxTreeField } from "./syntax-tree";
import type { MarkerDisplayMode } from "@/settings/schema";

/** 切换标记符显示策略 */
export const setDisplayMode = StateEffect.define<MarkerDisplayMode>();

/** 当前显示策略（存在 state 里，切换是事务的一部分） */
const displayModeField = StateField.define<MarkerDisplayMode>({
  create: () => "live",
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setDisplayMode)) {
        return effect.value;
      }
    }
    return value;
  },
});

/**
 * Live Preview 视图插件。
 *
 * 为什么用 ViewPlugin 而不是 `EditorView.decorations.compute`？
 *
 *   `Facet.compute` 的文档原话是「your function is only called again for a new
 *   state when one of those parts changed」——它**只在依赖的字段变化时**才重算。
 *   而装饰器真正依赖的是「文档内容 + 光标位置」，这两个每次击键都在变，
 *   却不是任何一个 StateField。
 *
 *   如果把依赖写成「是否实时预览」（只在切换模式时变），
 *   装饰器就只会在初始化时算一次，之后再也不更新——这是实测踩过的坑。
 *
 *   ViewPlugin 的 `update()` 则由 CM6 在**每个事务**后调用，
 *   我们在这里显式决定何时重算，行为最清晰、也不依赖 CM6 的依赖追踪细节。
 */
class LivePreviewPlugin {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = computeDecorations(view);
  }

  update(update: ViewUpdate): void {
    // 两种情况需要重算：
    //   1. 有事务（打字、移动光标、切换模式）
    //   2. 视口变化（滚动）—— CM6 在 measure 循环里会用**空事务**创建
    //      一个 ViewUpdate 并通知插件，此时 `transactions.length === 0`
    //      但 `viewportChanged === true`（`viewportMoved` 表示是纯滚动而非
    //      文档变更导致的位置映射）。
    if (update.transactions.length > 0 || update.viewportChanged) {
      this.decorations = computeDecorations(update.view);
    }
  }
}

/** 根据当前状态算出装饰器集合；源码模式返回空集 */
function computeDecorations(view: EditorView): DecorationSet {
  const state = view.state;
  const mode = state.field(displayModeField);
  if (mode === "source") return Decoration.none;
  // 语法树由 `syntaxTreeField` 增量维护，命中即复用，不再全量重解析
  const tree = state.field(syntaxTreeField).tree;
  return buildLivePreviewDecorations(state, mode, tree);
}

const livePreviewPlugin = ViewPlugin.fromClass(LivePreviewPlugin, {
  decorations: (v) => v.decorations,
});

/**
 * Live Preview 扩展。
 *
 * 初值不通过 StateField 传入（StateField 没有 init 配置项），
 * 而是由调用方在创建编辑器后派发一次 effect 设置——
 * 见 `createMarkdownEditor` 里的 `initialDisplayMode`。
 */
export function livePreview(): Extension {
  return [displayModeField, syntaxTreeField, livePreviewPlugin];
}

/** 编程式切换显示策略 */
export function setDisplayModeOf(view: EditorView, mode: MarkerDisplayMode): void {
  view.dispatch({ effects: setDisplayMode.of(mode) });
}

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
 */

import {
  Decoration,
  ViewPlugin,
  type EditorView,
  type ViewUpdate,
  type DecorationSet,
} from "@codemirror/view";
import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { buildLivePreviewDecorations } from "./decorations";

/** 切换「实时预览」开关 */
export const setLivePreview = StateEffect.define<boolean>();

/** 是否处于实时预览模式 */
const livePreviewEnabled = StateField.define<boolean>({
  create: () => true,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setLivePreview)) {
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
 *   如果把依赖写成 `livePreviewEnabled`（只在切换模式时变），
 *   装饰器就只会在初始化时算一次，之后再也不更新——这是实测踩过的坑。
 *
 *   ViewPlugin 的 `update()` 则由 CM6 在**每个事务**后调用，
 *   我们在这里显式决定何时重算，行为最清晰、也不依赖 CM6 的依赖追踪细节。
 */
class LivePreviewPlugin {
  /** 注意类型是 DecorationSet（= RangeSet<Decoration>），不是单个 Decoration */
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = computeDecorations(view.state);
  }

  update(update: ViewUpdate): void {
    // 任何事务（打字、移动光标、切换模式）都可能导致装饰器失效
    if (update.transactions.length > 0) {
      this.decorations = computeDecorations(update.state);
    }
  }
}

/** 根据当前状态算出装饰器集合；源码模式返回空集 */
function computeDecorations(state: EditorState): DecorationSet {
  if (!state.field(livePreviewEnabled)) return Decoration.none;
  return buildLivePreviewDecorations(state);
}

const livePreviewPlugin = ViewPlugin.fromClass(LivePreviewPlugin, {
  decorations: (v) => v.decorations,
});

/**
 * Live Preview 扩展。
 */
export function livePreview(): Extension {
  return [livePreviewEnabled, livePreviewPlugin];
}

/** 编程式切换实时预览 */
export function setLivePreviewMode(view: EditorView, enabled: boolean): void {
  view.dispatch({ effects: setLivePreview.of(enabled) });
}

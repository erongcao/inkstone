/**
 * Live Preview 的编辑器状态。
 *
 * 为什么要把「语法树 / 显示策略 / 光标位置」放进**同一个** StateField：
 *   CM6 规定**块级装饰器**（`Decoration.replace({ block: true })`）
 *   **不能**通过 ViewPlugin 提供，必须走 `EditorView.decorations` facet。
 *   而 `EditorView.decorations.from(field, get)` 只接受**一个**字段作为依赖，
 *   `get` 也拿不到完整的 state。
 *
 *   所以把装饰器需要的全部输入收进一个字段：
 *   语法树（增量维护）+ 显示策略 + 光标位置 + 文档全文。
 *   字段值每次事务都返回新对象 → 装饰器每次都重算，
 *   行为与之前用 ViewPlugin 时完全一致。
 *
 *   （实测踩过的坑：`RangeError: Block decorations may not be specified via plugins`）
 *
 * 增量解析的原理见 AGENTS.md「Live Preview 性能」章节。
 */

import { StateEffect, StateField, type EditorState } from "@codemirror/state";
import { TreeFragment, type Tree } from "@lezer/common";
import { parseSyntax } from "./syntax";
import type { MarkerDisplayMode } from "@/settings/schema";

/** 切换标记符显示策略 */
export const setDisplayMode = StateEffect.define<MarkerDisplayMode>();

/** Live Preview 需要的全部状态 */
export interface LivePreviewState {
  /** 当前文档的语法树（增量维护） */
  tree: Tree;
  /** 供下一次增量解析复用的片段 */
  fragments: readonly TreeFragment[];
  /** 文档全文 */
  source: string;
  /** 主选区光标位置 */
  cursor: number;
  /** 标记符显示策略 */
  mode: MarkerDisplayMode;
}

/**
 * Live Preview 状态字段。
 *
 * 必须定义在**模块级**：`StateField.define(...)` 每次调用都会生成新的字段实例，
 * 在函数里定义会让 CM6 认为「字段集合变了」，所有依赖它的值都作废重算。
 */
export const livePreviewField = StateField.define<LivePreviewState>({
  create: (state) => {
    const source = state.doc.toString();
    const tree = parseSyntax(source);
    return {
      tree,
      fragments: TreeFragment.addTree(tree),
      source,
      cursor: state.selection.main.head,
      mode: "live",
    };
  },

  update: (value, tr) => {
    // 显示策略可能被 effect 改掉
    let mode = value.mode;
    for (const effect of tr.effects) {
      if (effect.is(setDisplayMode)) mode = effect.value;
    }

    const cursor = tr.state.selection.main.head;

    if (!tr.docChanged) {
      // 只是选区或模式变了：树与片段都保持不变
      if (cursor === value.cursor && mode === value.mode) return value;
      return { ...value, cursor, mode };
    }

    // 文档变了 → 增量解析
    const ranges: {
      fromA: number;
      toA: number;
      fromB: number;
      toB: number;
    }[] = [];
    tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
      ranges.push({ fromA, toA, fromB, toB });
    });

    // 按变更处切开旧片段：变更区间被挖空，其余部分保留给 parser 复用
    const fragments = TreeFragment.applyChanges(value.fragments, ranges);

    const source = tr.state.doc.toString();
    const tree = parseSyntax(source, fragments);

    return {
      tree,
      fragments: TreeFragment.addTree(tree),
      source,
      cursor,
      mode,
    };
  },
});

/** 从编辑器状态里取出当前语法树 */
export function getSyntaxTree(state: EditorState): Tree {
  return state.field(livePreviewField).tree;
}

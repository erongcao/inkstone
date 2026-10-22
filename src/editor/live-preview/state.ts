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

/**
 * 强制装饰器重算（不改变文档、选区或模式）。
 *
 * 存在的唯一理由：**块级渲染器的输出可能依赖编辑器之外的东西**。
 * 目前是 KaTeX——它按需异步加载，加载完成那一刻文档一个字都没变，
 * 但公式块的 DOM 必须从「源码形态」换成「渲染形态」。
 *
 * 为什么不能靠一个空事务：
 *   `update` 在 `!docChanged && 光标没动 && 模式没变` 时会 `return value`，
 *   字段值身份不变 → CM6 认为装饰器输入没变 → 根本不重算。
 *   所以需要一个显式 effect 来打破这个短路。
 */
export const refreshRendering = StateEffect.define<null>();

/**
 * 行内公式的定界符策略。
 *
 * `singleDollarTextMath: false` 时单个 `$` 不再是定界符——
 * 直接透传给 remark-math，所以**不是编辑器自造的规则**，
 * 编辑器视图与 HTML 导出认的是同一套（架构约束 C）。
 *
 * 这个选项必须进 StateField：它影响装饰器输出，
 * 而 `EditorView.decorations.from` 只认这一个字段作依赖。
 */
export const setMathOptions = StateEffect.define<{ singleDollarTextMath: boolean }>();

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
  /** 单个 `$` 是否作为行内公式定界符（透传给 remark-math，默认开） */
  singleDollarTextMath: boolean;
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
      singleDollarTextMath: true,
    };
  },

  update: (value, tr) => {
    // 显示策略可能被 effect 改掉；重算请求也要处理
    let mode = value.mode;
    let forced = false;
    let singleDollarTextMath = value.singleDollarTextMath;
    for (const effect of tr.effects) {
      if (effect.is(setDisplayMode)) mode = effect.value;
      if (effect.is(setMathOptions))
        singleDollarTextMath = effect.value.singleDollarTextMath;
      if (effect.is(refreshRendering)) forced = true;
    }

    const cursor = tr.state.selection.main.head;

    if (!tr.docChanged) {
      // 强制重算：返回**新对象**（身份变了）让 CM6 重跑装饰器映射。
      // 注意不能在这里提前 return value，那会把请求吞掉。
      if (forced) return { ...value, cursor, mode, singleDollarTextMath };
      // 只是选区、模式或公式策略变了：树与片段都保持不变
      if (
        cursor === value.cursor &&
        mode === value.mode &&
        singleDollarTextMath === value.singleDollarTextMath
      ) {
        return value;
      }
      return { ...value, cursor, mode, singleDollarTextMath };
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
      singleDollarTextMath,
    };
  },
});

/** 从编辑器状态里取出当前语法树 */
export function getSyntaxTree(state: EditorState): Tree {
  return state.field(livePreviewField).tree;
}

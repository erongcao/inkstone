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

import { StateEffect, StateField, Facet, type EditorState } from "@codemirror/state";
import { TreeFragment, type Tree } from "@lezer/common";
import { parseSyntax } from "./syntax";
import { getMarkdownParser } from "../markdown-language";
import type { MarkerDisplayMode } from "@/settings/schema";
import { DEFAULT_FEATURES, featuresKey, type MarkdownFeatures } from "@/parser/features";

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
 * Markdown 扩展开关变了。
 *
 * 换开关意味着换 parser（lezer 的扩展是**配置期**决定的），
 * 所以这个 effect 会让整篇文档重新解析——
 * `TreeFragment` 与 parser 绑定，跨 parser 复用片段会得到错误的树。
 */
export const setMarkdownFeatures = StateEffect.define<MarkdownFeatures>();

/**
 * 编辑器**创建时**生效的开关。
 *
 * ## 为什么需要它
 *
 * `StateField` 没有「初始值」配置项——`create` 只拿到 `EditorState`，
 * 拿不到扩展工厂的入参。而开关必须能在**创建那一刻**就生效：
 * 用户上次关掉了「表格」，这次打开应用，编辑器第一棵树就该是
 * 「不认表格」的那棵树。
 *
 * 早先的做法是「创建后再派发一次 effect」：
 * 那会让第一棵树用**默认 parser** 解析一遍，然后立刻整篇重解析——
 * 多余的一次全量解析，而且中间那一帧的装饰器是按错的规则算的
 * （表格已经渲染出来了，下一帧才消失）。
 *
 * 改成 facet 就没这个问题了：`Facet` 的值在**状态创建前**就算好了，
 * `StateField.create` 里 `state.facet(...)` 直接读得到。
 *
 * 为什么不用 `state.facet(language)` 反推 parser：
 * CM6 的 `language` facet 里那个 parser 是「我们的 parser + `parseCode`」，
 * 多了嵌入式代码解析——Live Preview 的树不能带它（代码块的内容结构会变）。
 */
export const initialFeaturesFacet = Facet.define<MarkdownFeatures, MarkdownFeatures>({
  combine: (values) => values[0] ?? DEFAULT_FEATURES,
});

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
  /** 当前的 Markdown 扩展开关 */
  features: MarkdownFeatures;
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
    // 开关从 facet 里取（编辑器创建时定的），不是写死的默认值。
    const features = state.facet(initialFeaturesFacet);
    const tree = parseSyntax(source, undefined, getMarkdownParser(features));
    return {
      tree,
      fragments: TreeFragment.addTree(tree),
      source,
      cursor: state.selection.main.head,
      mode: "live",
      features,
    };
  },

  update: (value, tr) => {
    // 显示策略可能被 effect 改掉；重算请求也要处理
    let mode = value.mode;
    let forced = false;
    let features = value.features;
    for (const effect of tr.effects) {
      if (effect.is(setDisplayMode)) mode = effect.value;
      if (effect.is(setMarkdownFeatures)) features = effect.value;
      if (effect.is(refreshRendering)) forced = true;
    }

    const cursor = tr.state.selection.main.head;
    // 按**内容**比，不按引用比。
    //
    // 设置面板每次改动都会 `featuresFromSettings` 出一个新对象，
    // 引用永远不同——按引用比的话，改任何一个开关都会触发整篇重解析。
    const featuresChanged = featuresKey(features) !== featuresKey(value.features);

    if (!tr.docChanged) {
      // 换开关 → 换 parser → 整篇重解析。
      //
      // 片段**不能**复用：`TreeFragment` 是与 parser 绑定的，
      // 拿旧 parser 的片段喂新 parser 会得到错误的树。
      if (featuresChanged) {
        const source = tr.state.doc.toString();
        const tree = parseSyntax(source, undefined, getMarkdownParser(features));
        return {
          tree,
          fragments: TreeFragment.addTree(tree),
          source,
          cursor,
          mode,
          features,
        };
      }
      // 强制重算：返回**新对象**（身份变了）让 CM6 重跑装饰器映射。
      // 注意不能在这里提前 return value，那会把请求吞掉。
      if (forced) return { ...value, cursor, mode, features };
      // 只是选区或模式变了：树与片段都保持不变
      if (cursor === value.cursor && mode === value.mode) {
        return value;
      }
      return { ...value, cursor, mode, features };
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
    const tree = parseSyntax(source, fragments, getMarkdownParser(features));

    return {
      tree,
      fragments: TreeFragment.addTree(tree),
      source,
      cursor,
      mode,
      features,
    };
  },
});

/** 从编辑器状态里取出当前语法树 */
export function getSyntaxTree(state: EditorState): Tree {
  return state.field(livePreviewField).tree;
}

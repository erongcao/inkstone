/**
 * 增量语法树：维护 lezer 的 Tree 与 fragment 列表。
 *
 * 为什么需要它：
 *   实测（`scripts/bench-decorations.ts`）—— Live Preview 装饰器管线里，
 *   **lezer 全量解析占 64%~72% 的耗时**（4000 行文档：解析 3.66ms / 全管线 5.19ms）。
 *   每击键全量重解析一棵 7000+ 节点的树，是这条管线最大的单点成本。
 *
 * 增量解析怎么做：
 *   lezer 的增量机制不是「TreeEditor」（**lezer 生态里根本没有这个类**，
 *   计划书原文写错了），而是三个 API 的组合：
 *     1. `TreeFragment.addTree(tree)`      —— 把一棵已解析的树登记成「可复用的片段」
 *     2. `TreeFragment.applyChanges(frags, ranges)` —— 按变更区间把片段切开，
 *                                          变更处挖空、其余保留
 *     3. `parser.parse(text, fragments)`    —— 解析时复用没被挖空的那部分旧树
 *   CM6 官方走的是同一条路（`@codemirror/language` 的 `ParseContext.changes`）。
 *
 * 正确性依据：
 *   `scripts/verify-incremental.ts` —— 900 轮随机编辑（插入标记符、插入结构化文本、
 *   删除片段）后，增量树与全量树**逐节点对比 0% 不一致**；性能 p95 0.07ms vs 2.74ms。
 *
 * 语义边界：
 *   这个树只服务「编辑视图的实时布局」（哪里是标记、哪里是正文）。
 *   渲染、导出、大纲、脚注编号的语义来源始终是 remark/mdast，两者职责不重叠。
 */

import { StateField, type EditorState } from "@codemirror/state";
import { TreeFragment, type Tree, type ChangedRange } from "@lezer/common";
import { parseSyntax } from "./syntax";

/** 增量语法树的状态：当前树 + 可复用的片段列表 */
export interface SyntaxTreeState {
  /** 当前文档的语法树 */
  tree: Tree;
  /** 供下一次增量解析复用的片段 */
  fragments: readonly TreeFragment[];
}

/**
 * 维护增量语法树的 StateField。
 *
 * 注意：必须定义在**模块级**。
 *   `StateField.define(...)` 每次调用都会生成一个**新的字段实例**，
 *   如果在函数里定义，每次重建扩展都会让 CM6 认为「字段集合变了」，
 *   所有依赖它的值都会被作废重算（这是 AGENTS.md 踩坑记录第 14 条）。
 */
export const syntaxTreeField = StateField.define<SyntaxTreeState>({
  create: (state) => {
    const tree = parseSyntax(state.doc.toString());
    return { tree, fragments: TreeFragment.addTree(tree) };
  },

  update: (value, tr) => {
    // 没有文档变更 → 树和片段都保持不变
    // （selection 变化、模式切换等事务不该触发重新解析）
    if (!tr.docChanged) return value;

    // 把 CM6 的变更区间翻译成 lezer 的 ChangedRange 格式
    const ranges: ChangedRange[] = [];
    tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
      ranges.push({ fromA, toA, fromB, toB });
    });

    // 按变更处切开旧片段：变更区间被挖空，其余部分保留给 parser 复用
    const fragments = TreeFragment.applyChanges(value.fragments, ranges);

    // 增量解析
    const tree = parseSyntax(tr.state.doc.toString(), fragments);

    // 重新登记整棵树为可复用片段
    // （`addTree` 总是产出「覆盖整篇的一个 fragment」，
    //   旧 fragment 里超出新树长度的部分会被一并保留）
    return { tree, fragments: TreeFragment.addTree(tree) };
  },
});

/** 从编辑器状态里取出当前语法树 */
export function getSyntaxTree(state: EditorState): Tree {
  return state.field(syntaxTreeField).tree;
}

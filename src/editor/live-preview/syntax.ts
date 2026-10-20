/**
 * 编辑视图的 Markdown 语法解析。
 *
 * 为什么用 lezer 而不是 remark：
 *   实测（scripts/bench-parser.ts）—— 1000 行文档 remark 全量解析 p95 ≈ 11ms、
 *   3000 行 ≈ 29ms，已经超出 16ms 的交互预算；而 lezer p95 分别为 1.05ms / 1.82ms。
 *   编辑视图要求每击键即时更新，只能用 lezer。
 *
 * 职责边界：
 *   - lezer：只负责「编辑视图的实时布局」（哪里是标记、哪里是正文）
 *   - remark/mdast：负责「语义」（渲染、导出、大纲、脚注编号）
 * 两者的一致性由 tests/parser-agreement.test.ts 在语料库上断言。
 */

import { parser as baseParser, GFM } from "@lezer/markdown";
import type { Tree, SyntaxNode, SyntaxNodeRef } from "@lezer/common";

/** 启用 GFM 扩展（表格、任务列表、删除线、自动链接） */
const gfmParser = baseParser.configure(GFM);

export type { Tree, SyntaxNode, SyntaxNodeRef };

/** 解析整篇文档 */
export function parseSyntax(source: string): Tree {
  return gfmParser.parse(source);
}

/** 遍历语法树的所有节点 */
export function walkSyntax(
  tree: Tree,
  visit: (node: SyntaxNode, parent: SyntaxNode | null) => void,
): void {
  tree.iterate({
    enter(ref) {
      // `iterate` 的回调参数是 SyntaxNodeRef（轻量引用），`ref.node` 才是完整节点
      visit(ref.node, ref.node.parent ?? null);
    },
  });
}

/** 找到某节点的父节点类型名 */
export function parentName(node: SyntaxNode): string | undefined {
  return node.node.parent?.type.name;
}

/**
 * 行内标记的类型定义。
 *
 * 每个条目描述一类「可隐藏的标记」：
 *   - `nodeType`：包含标记的语法节点（如 StrongEmphasis）
 *   - `markType`：该节点内的标记子节点类型（如 EmphasisMark）
 *   - `contentFrom/contentTo`：如何从标记节点算出正文区间
 */
export interface InlineMarkerSpec {
  /** 承载标记的节点类型 */
  nodeType: string;
  /** 标记本身在节点内的子节点类型 */
  markType: string;
  /** 节点内被标记包裹的内容类型（用于排除标记本身） */
  contentType?: string;
  /** 该标记对应的 CSS class（用于给正文加样式） */
  contentClass?: string;
}

/** 各类行内标记的规格 */
export const INLINE_MARKERS: InlineMarkerSpec[] = [
  {
    nodeType: "StrongEmphasis",
    markType: "EmphasisMark",
    contentType: "EmphasisMark",
    contentClass: "cm-md-strong",
  },
  {
    nodeType: "Emphasis",
    markType: "EmphasisMark",
    contentType: "EmphasisMark",
    contentClass: "cm-md-emphasis",
  },
  {
    nodeType: "InlineCode",
    markType: "CodeMark",
    contentType: "CodeMark",
    contentClass: "cm-md-inline-code",
  },
  {
    nodeType: "Strikethrough",
    markType: "StrikethroughMark",
    contentType: "StrikethroughMark",
    contentClass: "cm-md-strikethrough",
  },
  {
    nodeType: "Link",
    markType: "LinkMark",
    contentType: "LinkMark",
    contentClass: "cm-md-link",
  },
  {
    nodeType: "Image",
    markType: "LinkMark",
    contentType: "LinkMark",
    contentClass: "cm-md-image",
  },
];

/** 块级标记：标题的 #、列表的 -、引用的 > */
export const BLOCK_MARKERS: Record<string, string> = {
  HeaderMark: "cm-md-header-mark",
  ListMark: "cm-md-list-mark",
  QuoteMark: "cm-md-quote-mark",
};

/** 标题节点 → 渲染层级样式 */
export const HEADING_CLASSES: Record<string, string> = {
  ATXHeading1: "cm-md-heading-1",
  ATXHeading2: "cm-md-heading-2",
  ATXHeading3: "cm-md-heading-3",
  ATXHeading4: "cm-md-heading-4",
  ATXHeading5: "cm-md-heading-5",
  ATXHeading6: "cm-md-heading-6",
};

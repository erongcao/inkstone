/**
 * 题注的**编辑层**实现（lezer 版）。
 *
 * ## 为什么有第二个实现
 *
 * 语义层（remark / mdast）那版在 `src/parser/captions.ts`。
 * 但编辑视图要的是**每击键都准**的位置，
 * 而 remark 全量解析 1000 行 p95 ≈ 11ms——超出交互预算。
 *
 * 这与脚注、表格、数学公式是同一个套路：
 * **位置与识别走 lezer，语义由对拍测试钉死在 remark 上**
 * （见 `tests/captions.test.ts`，那里逐条比对两版的结果）。
 *
 * ## 哪些规则是**共用**的
 *
 * 标记怎么认（`matchCaptionMarker`）、编号怎么算（`formatCaptionNumber`）
 * ——这两条规则**只有一份实现**，就在 `src/parser/captions.ts` 里。
 * 本文件只负责「哪个段落挨着哪个图片 / 表格」，
 * 而那取决于语法树长什么样，本来就只能各看各的。
 *
 * 所以两版可能分叉的地方只有一处：**结构判定**。
 * 对拍测试盯的就是它。
 */

import type { SyntaxNode, Tree } from "@lezer/common";
import {
  captionPrefix,
  formatCaptionNumber,
  matchCaptionMarker,
  type Caption,
  type CaptionKind,
  type CaptionOptions,
} from "@/parser/captions";

/**
 * 块级节点类型。
 *
 * 用来把「兄弟节点」限定成块——lezer 的容器节点里混着标记节点
 * （引用块里的 `QuoteMark`、列表项里的 `ListMark`），
 * 它们不是兄弟块，不该参与「谁挨着谁」的判定。
 *
 * ⚠️ 这张表必须与 mdast 那侧的容器/块划分**对齐**：
 * 少一个类型，两版对「前一个兄弟是谁」的判断就会不同。
 */
const BLOCK_TYPES = new Set([
  "Paragraph",
  "Task",
  "ATXHeading1",
  "ATXHeading2",
  "ATXHeading3",
  "ATXHeading4",
  "ATXHeading5",
  "ATXHeading6",
  "SetextHeading1",
  "SetextHeading2",
  "Blockquote",
  "BulletList",
  "OrderedList",
  "ListItem",
  "FencedCode",
  "CodeBlock",
  "HTMLBlock",
  "HorizontalRule",
  "Table",
]);

/** 能装块级子节点的容器（对应 mdast 那侧的 root / blockquote / list / listItem） */
const CONTAINER_TYPES = new Set([
  "Document",
  "Blockquote",
  "BulletList",
  "OrderedList",
  "ListItem",
]);

/** 扫描状态 */
interface ScanState {
  source: string;
  options: CaptionOptions;
  captions: Caption[];
  /** 当前章号；0 = 还没进过任何一章 */
  chapter: number;
  /** 本章内图的计数 */
  figureCount: number;
  /** 本章内表的计数 */
  tableCount: number;
}

/**
 * 在语法树里找题注。
 *
 * @param tree    编辑器的语法树
 * @param source  文档全文（标记按**源码**匹配，与 mdast 那版一致）
 * @param options 编号方式
 */
export function findCaptions(
  tree: Tree,
  source: string,
  options: CaptionOptions,
): Caption[] {
  const state: ScanState = {
    source,
    options,
    captions: [],
    chapter: 0,
    figureCount: 0,
    tableCount: 0,
  };
  walkContainer(tree.topNode, state, true);
  return state.captions;
}

/**
 * 取一个节点的全部直接子节点。
 *
 * 不能用 `node.getChildren()`——那个 API **必须**给类型名，
 * 不给就一个都取不到（上游 `getChildren` 内部是 `cur.type.is(type)`，
 * `type` 为 undefined 时恒为 false）。
 * 所以这里用游标自己走一遍（与 `live-preview/decorations.ts` 里的
 * `childrenOfType` 同一套写法）。
 */
function childNodes(node: SyntaxNode): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  const cursor = node.cursor();
  if (cursor.firstChild()) {
    do {
      result.push(cursor.node);
    } while (cursor.nextSibling());
  }
  return result;
}

/**
 * 扫一个容器的块级子节点。
 *
 * 递归是**就地**进行的（在块自己的位置上往下走），
 * 所以处理顺序就是文档顺序——编号必须按文档顺序分配。
 *
 * @param isRoot 这个容器是不是文档根（只有根下的一级标题算一章）
 */
function walkContainer(node: SyntaxNode, state: ScanState, isRoot: boolean): void {
  const blocks = childNodes(node).filter((child) => BLOCK_TYPES.has(child.type.name));

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const name = block.type.name;

    if (isRoot && (name === "ATXHeading1" || name === "SetextHeading1")) {
      state.chapter++;
      // 只有「按章重编」才需要清零——连续模式下编号是全篇连续的
      // （理由与 mdast 那版一致，见 `parser/captions.ts`）。
      if (state.options.numbering === "chapter") {
        state.figureCount = 0;
        state.tableCount = 0;
      }
      continue;
    }

    if (name === "Paragraph" || name === "Task") {
      const caption = matchCaption(block, blocks, i, state);
      if (caption) {
        state.captions.push(caption);
        continue;
      }
    }

    if (CONTAINER_TYPES.has(name)) {
      walkContainer(block, state, false);
    }
  }
}

/**
 * 段落内容的起点。
 *
 * 任务列表项在 lezer 里是 `Task` 节点（不是 `Paragraph`），
 * 它的内容起点在 `[ ]` 标记**之后**——
 * mdast 那边的段落位置也是从标记之后算起的，两边要对齐。
 */
export function captionContentStart(node: SyntaxNode): number {
  if (node.type.name !== "Task") return node.from;
  const marker = childNodes(node).find((child) => child.type.name === "TaskMarker");
  return marker ? marker.to : node.from;
}

/** 判断一个段落是不是题注 */
function matchCaption(
  node: SyntaxNode,
  siblings: SyntaxNode[],
  index: number,
  state: ScanState,
): Caption | null {
  const from = captionContentStart(node);
  const raw = state.source.slice(from, node.to);
  const marker = matchCaptionMarker(raw);
  if (!marker) return null;

  const target = findTarget(siblings, index, marker.kind);
  if (target === null) return null;

  const count = marker.kind === "figure" ? ++state.figureCount : ++state.tableCount;
  const number = formatCaptionNumber(state.chapter, count, state.options.numbering);

  return {
    kind: marker.kind,
    label: marker.label,
    text: raw.slice(marker.length),
    number,
    prefix: captionPrefix(marker.label, number),
    from,
    to: node.to,
    markerFrom: from,
    markerTo: from + marker.length,
    targetFrom: target,
  };
}

/**
 * 找出与题注段落相邻的图片 / 表格。
 *
 * 规则与 mdast 那版**逐条相同**：先看前一个兄弟，再看后一个；
 * 图只配图片、表只配表格。
 */
function findTarget(
  siblings: SyntaxNode[],
  index: number,
  kind: CaptionKind,
): number | null {
  for (const i of [index - 1, index + 1]) {
    const sibling = siblings[i];
    if (!sibling) continue;
    if (kind === "table") {
      if (sibling.type.name === "Table") return sibling.from;
    } else if (isImageParagraph(sibling)) {
      return sibling.from;
    }
  }
  return null;
}

/** 这个段落是不是「只有一张图片」的段落 */
function isImageParagraph(node: SyntaxNode): boolean {
  const name = node.type.name;
  if (name !== "Paragraph" && name !== "Task") return false;
  // 任务项里的 `[ ]` 标记不算内容
  const children = childNodes(node).filter((child) => child.type.name !== "TaskMarker");
  return children.length === 1 && children[0].type.name === "Image";
}

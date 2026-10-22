/**
 * AI 上下文切片。
 *
 * 语义来源必须是 **mdast 而不是 lezer**（架构约束 C）：
 * 「什么算一个段落」「什么算一个章节」是**语义**判断，
 * 导出/大纲/AI 都应该认同一套边界。用 lezer 会让编辑器认一套、
 * 导出认另一套。
 *
 * 性能上这样做没问题，理由和「为什么编辑器每击键用 lezer」正好相反：
 *   - 编辑器：**每击键**都要重算 → 11ms/1000 行的 remark 解析吃不消 → 用 lezer
 *   - AI：**用户点一次跑一次** → 同样 11ms 在点击的语境里完全不可感知 → 用 remark
 */

import type { Node, Parent, Root } from "mdast";
import { parseMarkdownSync } from "@/parser/markdown-loader";
import type { ParseOptions } from "@/parser/markdown";

/** 切片范围 */
export interface Slice {
  from: number;
  to: number;
}

/** 切片种类 */
export type ContextKind = "selection" | "paragraph" | "section" | "document";

/** 一次上下文切片的结果 */
export interface ContextSlice extends Slice {
  kind: ContextKind;
  /** 送进模型的 Markdown 文本 */
  text: string;
  /** 切片在原文中的标题（section / paragraph 才有），用于给模型上下文 */
  title?: string;
}

export interface SliceInput {
  source: string;
  cursor: number;
  /** 主选区；为空表示没有选区 */
  selection?: Slice | null;
  kind: ContextKind;
  options?: ParseOptions;
}

/** 取顶层子节点 */
function childrenOf(node: Node): Node[] {
  const parent = node as Parent;
  return Array.isArray(parent.children) ? parent.children : [];
}

/** 节点的起止偏移 */
function spanOf(node: Node): Slice | null {
  if (!node.position) return null;
  const from = node.position.start.offset;
  const to = node.position.end.offset;
  if (from === undefined || to === undefined) return null;
  return { from, to };
}

/** 取出某个范围的实际文本（去掉首尾空白） */
function textOf(source: string, slice: Slice): string {
  return source.slice(slice.from, slice.to).trim();
}

/** 标题节点 + 它的层级 */
function headingOf(node: Node): { depth: number; slice: Slice } | null {
  if (node.type !== "heading") return null;
  const slice = spanOf(node);
  if (!slice) return null;
  return { depth: (node as { depth?: number }).depth ?? 1, slice };
}

/**
 * 找出光标所在的**顶层块**（段落 / 标题 / 列表 / 表格 / 代码块……）。
 *
 * 只看顶层子节点：嵌套在列表里的段落不该被单独切出来，
 * 否则用户在一个长列表项里点一下，AI 只看到那一小段，语义是断的。
 */
function blockAt(root: Root, offset: number): Node | null {
  for (const child of childrenOf(root)) {
    const slice = spanOf(child);
    if (!slice) continue;
    if (offset >= slice.from && offset <= slice.to) return child;
  }
  return null;
}

/**
 * 找出光标所在的**章节**：从最近的前置标题开始，到下一个同级或更高级标题为止。
 *
 * 「同级或更高级」是关键：如果只看同级，`## 小节` 会把 `# 一级标题` 的内容截断，
 * 而用户显然期望拿到的是整个 `#` 章节。
 */
function sectionAt(
  root: Root,
  source: string,
  offset: number,
): { slice: Slice; title: string } | null {
  const tops = childrenOf(root);

  // 找光标之前最近的标题
  let startNode: Node | null = null;
  let startDepth = Infinity;
  for (const child of tops) {
    const slice = spanOf(child);
    const heading = headingOf(child);
    if (!slice) continue;
    if (heading && slice.from <= offset) {
      startNode = child;
      startDepth = heading.depth;
    }
  }

  const from = startNode ? (spanOf(startNode)?.from ?? 0) : 0;
  const headingText = startNode ? textOf(source, spanOf(startNode)!) : "";

  // 找下一个深度 <= startDepth 的标题，作为结束点
  let to = source.length;
  for (const child of tops) {
    const slice = spanOf(child);
    const heading = headingOf(child);
    if (!slice || slice.from <= from) continue;
    if (heading && heading.depth <= startDepth) {
      to = slice.from;
      break;
    }
  }

  return { slice: { from, to }, title: headingText };
}

/**
 * 切出一次 AI 上下文。
 *
 * @returns 解析器未就绪、或范围无效时返回 null
 */
export function sliceContext(input: SliceInput): ContextSlice | null {
  const { source, cursor, selection, kind, options } = input;

  // 文档级与选区级都不需要解析
  if (kind === "document") {
    const text = source.trim();
    return text ? { kind, from: 0, to: source.length, text } : null;
  }
  if (kind === "selection") {
    if (!selection) return null;
    const text = textOf(source, selection);
    return text ? { kind, ...selection, text } : null;
  }

  const root = parseMarkdownSync(source, options);
  if (!root) return null;

  if (kind === "paragraph") {
    const block = blockAt(root, cursor);
    if (!block) return null;
    const slice = spanOf(block);
    if (!slice) return null;
    const text = textOf(source, slice);
    if (!text) return null;
    const heading = headingOf(block);
    return {
      kind,
      ...slice,
      text,
      // 光标正好在标题上时，把标题一并带上——否则模型不知道这段是什么
      ...(heading ? { title: text } : undefined),
    };
  }

  // section
  const section = sectionAt(root, source, cursor);
  if (!section) return null;
  const text = textOf(source, section.slice);
  if (!text) return null;
  return { kind, ...section.slice, text, title: section.title };
}

/**
 * 没有选区时，从「段落」降级到「章节」；再不行用文档。
 *
 * Typora 这类工具的行为：不选区时给光标所在段落；
 * 段落太短（< 最小字符数）时自动扩到章节——
 * 一句话拿去改写基本没有上下文。
 */
export function resolveContext(input: SliceInput, minChars = 40): ContextSlice | null {
  const hasSelection = Boolean(input.selection && textOf(input.source, input.selection!));
  if (hasSelection || input.kind === "document") {
    return sliceContext({ ...input, kind: hasSelection ? "selection" : input.kind });
  }

  const paragraph = sliceContext({ ...input, kind: "paragraph" });
  if (paragraph && paragraph.text.length >= minChars) return paragraph;

  const section = sliceContext({ ...input, kind: "section" });
  if (!section) return paragraph;
  if (!paragraph) return section;
  // 章节一定包含光标所在段落，所以段落更长只可能是切片异常——保守返回章节
  return paragraph.text.length > section.text.length ? paragraph : section;
}

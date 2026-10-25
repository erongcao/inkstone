/**
 * 文档索引：大纲 + 字数统计。
 *
 * 两个功能共用**一次**防抖的 mdast 解析。
 *
 * 为什么用 mdast 而不是 lezer（架构约束 C）：
 *   大纲的标题集合、字数统计的「正文」都得是**语义**层面的——
 *   `**粗体**` 里的星号不是正文、代码块里的内容不该算进正文字数。
 *   lezer 不提供「剥掉标记后的纯文本」这件事。
 *
 * 为什么防抖（而编辑器每击键都重算）：
 *   remark 全量解析 1000 行 p95 ≈ 11ms。大纲面板不需要逐击键刷新，
 *   停手 250ms 之后刷新一次，肉眼看不出差别，但把平均开销降到接近零。
 *   **不要**为此改用 lezer——那会重新引入「编辑器认一套、导出认另一套」。
 */

import { useSyncExternalStore } from "react";
import type { Node, Parent } from "mdast";
import type { MarkdownAst } from "@/parser/markdown";
import { parseMarkdownSync, primeMarkdownParser } from "@/parser/markdown-loader";
import { countWords } from "./stats";

/** 大纲里的一项 */
export interface OutlineItem {
  /** 标题层级 1–6 */
  depth: number;
  /** 标题正文（已剥掉 `#` 与行内标记） */
  text: string;
  /** 标题在源码中的范围 */
  from: number;
  to: number;
  /** 标题所在行号（1 起） */
  line: number;
}

/** 一次索引的结果 */
export interface DocumentIndex {
  outline: OutlineItem[];
  stats: { chars: number; words: number };
}

/** 空文档的索引 */
export const EMPTY_INDEX: DocumentIndex = { outline: [], stats: { chars: 0, words: 0 } };

/** 取一个 mdast 节点的纯文本（递归收集 text / inlineCode / 公式的值） */
function plainText(node: Node): string {
  const parent = node as Parent;
  if (Array.isArray(parent.children)) {
    return parent.children.map((child) => plainText(child)).join("");
  }
  const value = (node as { value?: string }).value;
  return value ?? "";
}

/**
 * 是否是「算正文字数」时应该跳过的块。
 *
 * 只跳 **代码块**：贴一段 50 行配置不该让字数暴涨几百，那是配置文件不是散文。
 *
 * **行内代码要算**——`把 \`foo()\` 传进去` 里的 `foo()` 是作者写进句子的词，
 * Word / Typora 也都算。把它排掉反而会让统计失真。
 */
function isCountableBlock(node: Node): boolean {
  return node.type !== "code";
}

/**
 * 收集正文文本（跳过代码块）。
 *
 * 注意收的是**所有带 value 的叶节点**，不只是 `text`：
 * `inlineMath`（公式）也有 value，内容是作者写的，不该被漏掉。
 * 之前只认 `text`，结果公式内容整个从统计里消失了。
 */
function collectBodyText(node: Node, parts: string[]): void {
  const parent = node as Parent;
  if (!Array.isArray(parent.children)) return;
  for (const child of parent.children) {
    if (!isCountableBlock(child)) continue;
    collectBodyText(child, parts);
    const value = (child as { value?: unknown }).value;
    if (typeof value === "string") parts.push(value);
  }
}

/**
 * 建立索引。
 *
 * @returns 解析器还没加载完、或解析失败时返回 null
 */
export function buildIndex(source: string): DocumentIndex | null {
  const tree = parseMarkdownSync(source);
  if (!tree) return null;
  return buildIndexFromTree(tree);
}

/**
 * 从**已解析**的 mdast 树建立索引。
 *
 * 与 `buildIndex` 的区别：后者走 `parseMarkdownSync`——解析器没加载完时返回 null。
 * 而导出是一次性动作（用户点一下），不该因为「remark 的懒加载 chunk 还没到」
 * 就把词数算成 0。所以导出侧用**静态导入**的 `parseMarkdown` 先解析，再调这里。
 *
 * 拆成两个函数是为了不重复实现「标题收集 + 正文字数统计」那二十行。
 */
export function buildIndexFromTree(tree: MarkdownAst): DocumentIndex {
  const outline: OutlineItem[] = [];
  for (const child of tree.children) {
    if (child.type !== "heading" || !child.position) continue;
    const from = child.position.start.offset;
    const to = child.position.end.offset;
    if (from === undefined || to === undefined) continue;
    outline.push({
      depth: child.depth,
      // 标题正文要剥掉行内标记：`## **加粗** 标题` → "加粗 标题"
      // 空标题在这里保持空串（语义原值），占位文案由 UI 决定——
      // 否则「没有标题」和「标题是空的」在数据层就分不出来了
      text: plainText(child).trim(),
      from,
      to,
      line: child.position.start.line,
    });
  }

  const body: string[] = [];
  collectBodyText(tree, body);

  return { outline, stats: countWords(body.join("")) };
}

/** 停手多久之后重建索引（毫秒） */
const DEBOUNCE_MS = 250;

/**
 * 索引是**共享 store**而不是组件内 state。
 *
 * 原因：大纲面板与状态栏都要用它，各算一次就是两次 remark 解析。
 * 共享 store 保证同一份内容只解析一次，订阅者拿到的也是同一个对象。
 */
let snapshot: { source: string; index: DocumentIndex | null } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/**
 * 请求为某份内容建立索引。
 *
 * 防抖在这里做：连续调用只会跑最后一次。
 * 解析器未就绪时不排空，而是**重试**——
 * remark 管线是懒加载的，文档打开时它可能还没下载完。
 */
export function requestIndex(source: string): void {
  // 先把解析器**加载请求发出去**。
  // 不这么做的话：`parseMarkdownSync` 在未加载时永远返回 null，
  // 下面那个「重试」就变成了空转——没有任何人去触发 dynamic import。
  // （实测：只靠 html-loader / math-loader 顺带加载时，
  //   两个都没跑过的路径下大纲会永远停在加载态。）
  primeMarkdownParser();

  if (snapshot?.source === source && snapshot.index !== null) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const index = buildIndex(source);
    snapshot = { source, index };
    emit();
    // 解析器还没就绪 → 过一会儿再来一次
    if (index === null) requestIndex(source);
  }, DEBOUNCE_MS);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): DocumentIndex | null {
  return snapshot?.index ?? null;
}

/**
 * 订阅文档索引。
 *
 * 返回 `null` 表示「索引还没算出来」（解析器未加载 / 还在防抖窗口里）。
 * 界面必须把它和「文档确实没有标题」区分开——
 * 前者是加载态，后者是空状态，混为一谈会让用户以为文档坏了。
 */
export function useDocumentIndex(): DocumentIndex | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

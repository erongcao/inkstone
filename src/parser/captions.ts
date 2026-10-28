/**
 * 题注（图题 / 表题）与自动编号。
 *
 * ## 题注长什么样
 *
 * 一个**段落**，内容以题注标记开头，且**紧邻**一个图片或表格：
 *
 *     ![架构图](arch.png)
 *     图：系统总体架构
 *
 *     表：用户角色一览
 *     | 角色 | 权限 |
 *     | --- | --- |
 *     | 管理员 | 全部 |
 *
 * 标记 = 「标签 + 冒号」：图用 `图` / `圖` / `Figure` / `Fig`，
 * 表用 `表` / `Table`；冒号全角半角都认，冒号后可以跟空格。
 *
 * ## 为什么要把标记写进正文
 *
 * 架构红线 1：**单一真相源是 Markdown 文本**。
 * 题注是作者写的内容，必须留在文档里；
 * 而**编号是渲染层算出来的**，只出现在渲染结果里，**绝不回写源文**。
 *
 * 源文里那个「图：」永远只是「图：」——
 * 编号会随文档改动自动重排，而用户的文件一个字节都不会被改。
 *
 * ## 编号规则
 *
 * - 图与表**各自**计数，互不干扰。
 * - `chapter`（默认）：**顶层的一级标题**算一章，章内重新计数 → `图 1-1`；
 *   第一个一级标题之前的内容没有章号 → `图 1`。
 * - `continuous`：全篇连续 → `图 1`、`图 2`。
 *
 * 「顶层」指不在引用块、列表项里的标题——章节是文档骨架，
 * 引用块里偶然出现的一级标题不该把后面的编号全部重置。
 *
 * ## 本模块是**语义层**的实现
 *
 * 导出（HTML / PDF / Word）走这里；
 * 编辑器的 Live Preview 走 `src/editor/render/captions.ts`（lezer 版）。
 *
 * 两版的**标记规则与编号规则是同一份代码**（就在本文件里，
 * `matchCaptionMarker` / `formatCaptionNumber`），
 * 只有「哪个段落挨着哪个图片 / 表格」要按各自的语法树去找——
 * 那部分由 `tests/captions.test.ts` 的**对拍测试**钉死。
 *
 * 这不是「解析规则有两套」：标记怎么认、编号怎么算，只有一份实现。
 */

import type { Nodes, Paragraph, Parent, Root, Text } from "mdast";
import type { CaptionNumbering } from "@/settings/schema";

/** 题注的种类：图 / 表 */
export type CaptionKind = "figure" | "table";

/** 题注选项 */
export interface CaptionOptions {
  /** 编号方式：按章重编 / 全篇连续 */
  numbering: CaptionNumbering;
}

/** 一条题注 */
export interface Caption {
  /** 图还是表 */
  kind: CaptionKind;
  /** 标签（「图」「表」「Figure」「Table」…） */
  label: string;
  /** 题注文字（不含标记；行内标记按源码原样保留） */
  text: string;
  /** 编号文本（「1」「1-1」） */
  number: string;
  /** 渲染出的完整前缀（「图 1-1 」，末尾带一个空格） */
  prefix: string;
  /** 题注段落整体的起点 */
  from: number;
  /** 题注段落整体的终点 */
  to: number;
  /** 标记区间的起点 */
  markerFrom: number;
  /** 标记区间的终点 */
  markerTo: number;
  /** 关联的图片 / 表格的起点 */
  targetFrom: number;
}

/* ── 标记 ── */

/**
 * 图的题注标签（小写比较）。
 *
 * 「圖」是繁体——用户切到繁体界面时写的就是它，
 * 而界面语言与文档语言本来就是两回事（文档可能一直是简体的）。
 */
const FIGURE_LABELS = new Set(["图", "圖", "figure", "fig"]);

/** 表的题注标签（小写比较） */
const TABLE_LABELS = new Set(["表", "table"]);

/**
 * 题注标记 = 「标签 + 冒号」。
 *
 * 标签里不允许有空白与冒号，所以「图形：说明」这种句子不会被误认成题注
 * ——它的标签是「图形」，不在已知标签表里，直接否掉。
 *
 * 冒号后允许跟空格／制表符：它们属于标记的一部分，
 * 渲染时被编号前缀替换掉，不会留下两个空格。
 */
const MARKER_PATTERN = /^([^：:\s]{1,12})([：:])[ \t]*/;

/** 一次标记匹配的结果 */
export interface MarkerMatch {
  /** 图还是表 */
  kind: CaptionKind;
  /** 规范化后的标签（「figure」→「Figure」） */
  label: string;
  /** 标记占用的字符数（含冒号与其后的空白） */
  length: number;
}

/**
 * 判断一段文字是不是以题注标记开头。
 *
 * @param text 段落的**源码**开头（不是渲染后的文字）
 */
export function matchCaptionMarker(text: string): MarkerMatch | null {
  const m = MARKER_PATTERN.exec(text);
  if (!m) return null;
  const lower = m[1].toLowerCase();
  if (FIGURE_LABELS.has(lower)) {
    return { kind: "figure", label: normalizeLabel(lower), length: m[0].length };
  }
  if (TABLE_LABELS.has(lower)) {
    return { kind: "table", label: normalizeLabel(lower), length: m[0].length };
  }
  return null;
}

/** 把标签规范化成「该长什么样」 */
function normalizeLabel(lower: string): string {
  switch (lower) {
    case "figure":
      return "Figure";
    case "fig":
      return "Fig";
    case "table":
      return "Table";
    default:
      // 「图」/「圖」：中文没有大小写，原样保留
      return lower;
  }
}

/* ── 编号 ── */

/**
 * 编号文本。
 *
 * @param chapter 当前章号（0 = 还没进过任何一章）
 * @param count   本章内（或全篇内）的计数
 */
export function formatCaptionNumber(
  chapter: number,
  count: number,
  numbering: CaptionNumbering,
): string {
  if (numbering === "continuous") return String(count);
  // 没有章号时不带前缀：「图 1」而不是「图 0-1」
  return chapter > 0 ? `${chapter}-${count}` : String(count);
}

/** 渲染出的前缀（「图 1-1 」，末尾一个空格把编号与题注文字分开） */
export function captionPrefix(label: string, number: string): string {
  return `${label} ${number} `;
}

/* ── mdast 实现 ── */

/**
 * mdast 里能装块级子节点的容器。
 *
 * 只有这些容器内部的段落才可能是题注——
 * 表格单元格里塞一个「图：说明」不构成题注（没有「紧邻的图片」可言）。
 */
const MD_CONTAINER_TYPES = new Set([
  "root",
  "blockquote",
  "list",
  "listItem",
  "footnoteDefinition",
]);

/** 扫描过程中的状态 */
interface ScanState {
  source: string;
  options: CaptionOptions;
  /** 找到的题注（按文档顺序） */
  found: FoundCaption[];
  /** 当前章号；0 = 还没进过任何一章 */
  chapter: number;
  /** 本章内图的计数 */
  figureCount: number;
  /** 本章内表的计数 */
  tableCount: number;
}

/** 一条题注 + 它所在的段落节点 */
interface FoundCaption {
  caption: Caption;
  paragraph: Paragraph;
}

/**
 * 从 mdast 树里收集题注。
 *
 * @param tree    语义树
 * @param source  源码（用来按**原文**匹配标记，见下）
 * @param options 编号方式
 */
export function collectCaptions(
  tree: Root,
  source: string,
  options: CaptionOptions,
): Caption[] {
  return scanCaptions(tree, source, options).map((item) => item.caption);
}

/** 收集题注，并保留段落节点引用（`applyCaptions` 要用） */
function scanCaptions(
  tree: Root,
  source: string,
  options: CaptionOptions,
): FoundCaption[] {
  const state: ScanState = {
    source,
    options,
    found: [],
    chapter: 0,
    figureCount: 0,
    tableCount: 0,
  };
  scanContainer(tree.children, state, true);
  return state.found;
}

/**
 * 扫一个容器（root / 引用块 / 列表项…）的子节点。
 *
 * @param isRoot 这个容器是不是根——只有根下的一级标题才算「一章」
 */
function scanContainer(children: Nodes[], state: ScanState, isRoot: boolean): void {
  for (let i = 0; i < children.length; i++) {
    const node = children[i];

    if (node.type === "heading") {
      // 章 = 顶层的一级标题
      if (isRoot && node.depth === 1) {
        state.chapter++;
        // 只有「按章重编」才需要清零——连续模式下编号是全篇连续的，
        // 遇到一级标题就归零的话，第二章的图会从 1 重新开始。
        if (state.options.numbering === "chapter") {
          state.figureCount = 0;
          state.tableCount = 0;
        }
      }
      continue;
    }

    if (node.type === "paragraph") {
      const found = matchParagraph(node, children, i, state);
      if (found) {
        state.found.push(found);
        continue;
      }
    }

    const parent = node as Parent;
    if (Array.isArray(parent.children) && MD_CONTAINER_TYPES.has(node.type)) {
      scanContainer(parent.children, state, false);
    }
  }
}

/**
 * 判断一个段落是不是题注。
 *
 * 返回 null 表示不是——不是题注的段落不消耗编号。
 */
function matchParagraph(
  node: Paragraph,
  siblings: Nodes[],
  index: number,
  state: ScanState,
): FoundCaption | null {
  const from = node.position?.start.offset;
  const to = node.position?.end.offset;
  if (from === undefined || to === undefined) return null;

  // 标记按**源码**匹配（不是按 mdast 的 text 值）：
  // 两个实现（mdast / lezer）必须对同一份源码给出一致的结论，
  // 而 lezer 那边只有源码可用。代价是「\图：说明」这种转义写法
  // 不算题注——少见，且两边一致。
  const raw = state.source.slice(from, to);
  const marker = matchCaptionMarker(raw);
  if (!marker) return null;

  const target = findTarget(siblings, index, marker.kind);
  if (target === null) return null;

  const count = marker.kind === "figure" ? ++state.figureCount : ++state.tableCount;
  const number = formatCaptionNumber(state.chapter, count, state.options.numbering);
  const label = marker.label;

  return {
    paragraph: node,
    caption: {
      kind: marker.kind,
      label,
      text: raw.slice(marker.length),
      number,
      prefix: captionPrefix(label, number),
      from,
      to,
      markerFrom: from,
      markerTo: from + marker.length,
      targetFrom: target,
    },
  };
}

/**
 * 找出与题注段落相邻的图片 / 表格。
 *
 * 规则：**先看前一个兄弟，再看后一个**。
 *
 * 为什么这个顺序对两种排法都成立：
 *   - 图题在图**下面**（中文习惯）：`图` `图：说明` → 前一个是图片 ✓
 *   - 表题在表**上面**（中文习惯）：`表：说明` `表` → 后一个是表格 ✓
 *
 * 而「图：说明」夹在图片与表格中间时，靠**种类**消歧：
 * 前一个是图片 → 归图片；前一个不是图片才看后一个。
 * 所以「图：说明」「表：说明」挨着挨着也不会认错。
 *
 * @returns 关联对象的起点；没有则 null
 */
function findTarget(siblings: Nodes[], index: number, kind: CaptionKind): number | null {
  for (const i of [index - 1, index + 1]) {
    const sibling = siblings[i];
    if (!sibling) continue;
    if (kind === "table") {
      if (sibling.type === "table") return sibling.position?.start.offset ?? null;
    } else if (isImageParagraph(sibling)) {
      return sibling.position?.start.offset ?? null;
    }
  }
  return null;
}

/** 这个段落是不是「只有一张图片」的段落 */
function isImageParagraph(node: Nodes): boolean {
  if (node.type !== "paragraph") return false;
  const children = (node as Paragraph).children;
  return children.length === 1 && children[0].type === "image";
}

/* ── 改写 ── */

/**
 * 把题注写进树里：段落正文换成「编号前缀 + 题注文字」，并加上题注样式类。
 *
 * 为什么要**改写**而不是另加节点：
 * 题注在屏幕与导出里都只是**一段文字**（只是长得像题注），
 * 不该在导出产物里冒出 `<figcaption>` 这种结构——
 * 那会让「屏幕是段落、导出是 figure」变成另一种不一致。
 *
 * 段落正文被就地改写，所以这棵树**只能用一次**——
 * 调用方要保证传进来的是一棵一次性解析出来的树
 * （与 `applyAlerts` / `applyImageSizes` 同样的要求）。
 */
export function applyCaptions(
  tree: Root,
  source: string,
  options: CaptionOptions,
): Caption[] {
  const found = scanCaptions(tree, source, options);
  for (const { caption, paragraph } of found) {
    const first = paragraph.children[0];
    // 标记在段落最开头，所以第一个子节点必然是承载它的那段文字。
    // 不是 text（比如段落以 `**图：**` 开头）说明标记不在开头——
    // 那种写法本来就不会被 `matchCaptionMarker` 认出来。
    if (!first || first.type !== "text") continue;
    const text = first as Text;
    const markerLength = caption.markerTo - caption.markerFrom;
    text.value = caption.prefix + text.value.slice(markerLength);

    // 题注样式类：靠 mdast 的标准扩展点 `data.hProperties` 带进 hast
    // （机制与 `parser/heading-anchors.ts` 里的锚点 id 一样）。
    const data = (paragraph.data ?? {}) as { hProperties?: Record<string, unknown> };
    paragraph.data = {
      ...data,
      hProperties: {
        ...data.hProperties,
        // hast 的 `className` 是**数组**（`hast-util-to-html` 会用空格连接），
        // 写成字符串的话类型对不上，序列化出来的 class 也不稳。
        className: ["ink-caption"],
      },
    };
  }
  return found.map((item) => item.caption);
}

/**
 * 把题注写进**源码**（给 pandoc 那条链路用）。
 *
 * pandoc 收的是 Markdown 源码，它不认识「图：」这种约定——
 * 所以这里把标记替换成编号前缀，让 Word / EPUB 里也有编号。
 *
 * 从后往前替换：前面的偏移量才不会因为后面的替换而失效。
 */
export function applyCaptionsToSource(source: string, captions: Caption[]): string {
  let result = source;
  for (const caption of [...captions].reverse()) {
    result =
      result.slice(0, caption.markerFrom) +
      caption.prefix +
      result.slice(caption.markerTo);
  }
  return result;
}

/**
 * 逐行扫描工具。
 *
 * 为什么需要它：
 *   实测 `@lezer/markdown` 的 GFM 扩展**不识别 GFM 表格与任务列表**
 *   （`dump-lezer-tree.ts` 验证：表格被解析成普通 `Paragraph`），
 *   数学公式（`$$…$$`）更是不在 CommonMark 语法里。
 *   而这些结构在语义层是 remark 的地盘（remark-gfm / remark-math 支持）。
 *
 *   编辑视图要的是「每击键都快」，不能为了找表格就跑一遍 remark
 *   （1000 行 p95 ≈ 11ms，超出交互预算）。
 *   折中：这些块级结构用**行扫描**识别——O(行数)，
 *   1000 行约 0.1ms，比 lezer 全量解析还快一个数量级。
 */

import type { Tree } from "@lezer/common";

/** 文档的一行 */
export interface Line {
  /** 行首在文档中的位置 */
  from: number;
  /** 行尾（不含换行符）在文档中的位置 */
  to: number;
  /** 行内容（不含换行符） */
  text: string;
  /** 是否是最后一行 */
  last: boolean;
}

/**
 * 把源码切成行。
 *
 * 保留每行的位置信息，这样扫描出来的结果可以直接当文档区间用。
 */
export function scanLines(source: string): Line[] {
  const lines: Line[] = [];
  let from = 0;
  while (from <= source.length) {
    const newline = source.indexOf("\n", from);
    if (newline === -1) {
      const text = source.slice(from);
      if (text.length > 0 || lines.length === 0) {
        lines.push({ from, to: source.length, text, last: true });
      }
      break;
    }
    lines.push({
      from,
      to: newline,
      text: source.slice(from, newline),
      last: false,
    });
    from = newline + 1;
  }
  return lines;
}

/** 一行是不是空行 */
export function isBlank(line: Line): boolean {
  return line.text.trim().length === 0;
}

/** 去掉行首的空白 */
export function trimStart(text: string): string {
  return text.replace(/^[ \t]+/, "");
}

/** 去掉行尾的空白 */
export function trimEnd(text: string): string {
  return text.replace(/[ \t]+$/, "");
}

/**
 * lezer 认识、但**不该**被行扫描当成 Markdown 结构的块。
 *
 * 关键点是这两类知识是互补的：
 *   - lezer 认识代码块与 HTML 块（实测节点名 `FencedCode` / `CodeBlock` / `HTMLBlock`）
 *   - lezer **不认识**公式与 GFM 表格（`$$\nx^2\n$$` 在它眼里就是一个普通 `Paragraph`）
 *
 * 所以「用 lezer 划禁区 + 用行扫描找它不认识的结构」两者不打架，
 * 而且行扫描必须先划禁区，否则代码块里的 `$$`、`$x$` 全都会被误判。
 */
const SKIP_NODE_TYPES = new Set(["FencedCode", "CodeBlock", "HTMLBlock"]);

/** 一个文档区间 */
export interface Interval {
  from: number;
  to: number;
}

/** 从语法树里划出「行扫描不能进入」的区间 */
export function collectSkipRanges(tree: Tree): Interval[] {
  const ranges: Interval[] = [];
  tree.iterate({
    enter(ref) {
      if (SKIP_NODE_TYPES.has(ref.type.name)) {
        ranges.push({ from: ref.from, to: ref.to });
        return false; // 不再进入子树
      }
      return true;
    },
  });
  return ranges;
}

/**
 * 构造「这个位置是不是禁区」的判定函数。
 *
 * 用**游标**而不是 `Array.some`：`ranges` 按位置递增，扫描也顺序前进，
 * 指针只前进不回退，整体 O(行数 + 禁区数)。
 */
export function makeSkipTest(ranges: readonly Interval[]): (pos: number) => boolean {
  let index = 0;
  return (pos) => {
    while (index < ranges.length && ranges[index].to <= pos) index++;
    return index < ranges.length && pos >= ranges[index].from && pos < ranges[index].to;
  };
}

/** 判断某个区间是否与禁区集合有交集（用于剔除被块级渲染器占用的区间） */
export function overlapsAny(range: Interval, ranges: readonly Interval[]): boolean {
  for (const r of ranges) {
    if (r.from >= range.to) return false; // ranges 有序，后面更不可能相交
    if (r.to > range.from) return true;
  }
  return false;
}

/**
 * 剥掉所有非空行的**公共**前导空白。
 *
 * 必须按公共前缀剥，不能逐行 `trimStart()`：
 * LaTeX 的 `\begin{align}` 靠行间的**相对**缩进对齐（`&=` 的列要对齐），
 * 逐行 trim 会把对齐彻底抹平。实测 remark-math 也是剥公共前缀的。
 */
export function dedent(content: string): string {
  const lines = content.split("\n");
  let min = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const indent = line.length - line.trimStart().length;
    if (indent < min) min = indent;
  }
  if (!Number.isFinite(min) || min === 0) return content;
  return lines.map((line) => line.slice(min)).join("\n");
}

/** 去掉结尾的换行符（`\r\n` 也要处理——`scanLines` 只按 `\n` 切分） */
export function stripTrailingNewline(text: string): string {
  return text.replace(/\r?\n$/, "");
}

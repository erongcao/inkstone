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

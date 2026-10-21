/**
 * 块级数学公式：`$$ … $$`。
 *
 * 为什么必须行扫描而不能用语法树：
 *   实测 `dump-lezer-tree.ts`，`$$\nx^2\n$$` 在 lezer 里就是一个普通 `Paragraph`
 *   —— 数学公式不在 CommonMark 里，`@lezer/markdown` 完全不认识。
 *   语义层的 `remark-math` 认识，但编辑器要的是「每击键都快」，
 *   1000 行 remark p95 ≈ 11ms，超出交互预算（见 `scan.ts` 的说明）。
 *
 * 行扫描的误判风险与对策：
 *   `$$` 也可能出现在代码块里、HTML 块里。
 *   对策是**先用 lezer 把这些区间标出来再扫描**——
 *   lezer 认识围栏代码块与 HTML 块（实测节点名 `FencedCode` / `CodeBlock` / `HTMLBlock`），
 *   而它不认识公式，所以「lezer 划出禁区 + 行扫描找公式」两者互补、不会互相打架。
 *
 * 未闭合的 `$$` **不算公式块**——这与 remark-math 的 `mathFlow` 一致：
 * 没闭合的 `$$` 就是普通文本。宁可少渲染，也不要凭空吞掉用户的行。
 */

import type { Tree } from "@lezer/common";
import { scanLines, type Line } from "./scan";
import { renderMathSync } from "./math-loader";
import type { BlockMatch, BlockRenderer, BlockRenderResult } from "./types";

/** lezer 认识、但内容不该被当成公式的块 */
const SKIP_NODE_TYPES = new Set(["FencedCode", "CodeBlock", "HTMLBlock"]);

/**
 * 开定界符：`$$` 在行首（允许最多 3 个前导空格，CommonMark 的块级缩进上限）。
 *
 * 4 个及以上空格就不是块级公式，而是缩进代码块了。
 */
const MATH_OPEN = /^ {0,3}\$\$/;

/** 闭定界符：整行只有 `$$`（允许尾部空白） */
const MATH_CLOSE = /^ {0,3}\$\$\s*$/;

/** 一个文档区间 */
interface Interval {
  from: number;
  to: number;
}

/** 从语法树里划出「不能出现公式」的区间 */
function collectSkipRanges(tree: Tree): Interval[] {
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
 * 判断一个位置是否落在禁区里。
 *
 * 用**游标**而不是 `Array.some`：`ranges` 是按位置递增的，
 * 扫描是顺序前进的，指针只前进不回退，整体 O(行数 + 禁区数)。
 */
function makeSkipTest(ranges: Interval[]): (pos: number) => boolean {
  let index = 0;
  return (pos) => {
    while (index < ranges.length && ranges[index].to <= pos) index++;
    return index < ranges.length && pos >= ranges[index].from && pos < ranges[index].to;
  };
}

/**
 * 支持的写法（判定规则与 remark-math 的 `math` 节点对齐，均为实测）：
 *
 *   1. 定界符独占两行（主流写法）
 *      ```
 *      $$
 *      x^2 + y^2 = z^2
 *      $$
 *      ```
 *   2. 开标记行带内容 + 闭合行
 *      `$$x^2` … `$$`
 *   3. 单行 `$$x^2$$`
 *
 * 三条实测得到的语义事实（改动前请先复现，别凭直觉）：
 *   - **未闭合的 `$$` 会一路吞到文档末尾**（`$$\nx^2\n\n后面` → math 的 value 是
 *     `"x^2\n\n后面"`）。和围栏代码块未闭合时的行为一样。所以这里必须照做，
 *     否则编辑器显示源码、导出却按公式渲染，两边对不上。
 *   - **公共缩进会被剥掉**，但行内的相对缩进保留。
 *     实测 3 格缩进的 `\begin{align}` 剥成 0 格，而 `y = a &= b` 与 `z &= c`
 *     的对齐空格原样保留——LaTeX 的对齐环境**依赖**这个相对缩进，
 *     所以只能剥公共前缀，不能逐行 trim。
 *   - **`$$…$$` 写在行中不是块级公式**（`结尾 $$y^2$$ 结束` → `paragraph(text, inlineMath, text)`）。
 *     它属于行内公式，由行内渲染器负责，本渲染器不管。
 */
export function findMathBlocks(tree: Tree, source: string): BlockMatch[] {
  const matches: BlockMatch[] = [];
  // 绝大多数文档里根本没有 `$$`，先做一次原生字符串快筛，
  // 省掉整趟行扫描（1000 行约 0.1ms，但没必要白跑）
  if (!source.includes("$$")) return matches;

  const lines = scanLines(source);
  const isSkipped = makeSkipTest(collectSkipRanges(tree));

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isSkipped(line.from)) {
      i++;
      continue;
    }

    const open = MATH_OPEN.exec(line.text);
    if (!open) {
      i++;
      continue;
    }

    // 注意：`$$` 前面可能有 0~3 个空格，切片必须按**匹配长度**，
    // 不能硬编码 slice(2)——否则带缩进的写法会切出半个 `$`，
    // 被误判成「单行闭合」而切出错误的区间。
    const fenceLength = open[0].length;
    const afterFence = line.text.slice(fenceLength);
    const alone = afterFence.trim().length === 0;

    // ---- 情况 3：单行 `$$…$$`（闭定界符就在本行，且其后只有空白）----
    const closeAt = afterFence.lastIndexOf("$$");
    if (!alone && closeAt !== -1 && afterFence.slice(closeAt + 2).trim().length === 0) {
      matches.push({
        from: line.from,
        to: line.from + fenceLength + closeAt + 2,
        kind: "math",
        content: afterFence.slice(0, closeAt),
      });
      i++;
      continue;
    }

    // ---- 向下找闭合行（情况 1 / 2 通用）----
    let close = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (isSkipped(lines[j].from)) continue;
      if (MATH_CLOSE.test(lines[j].text)) {
        close = j;
        break;
      }
    }

    if (close !== -1) {
      // 正文起点：`$$` 独占一行 → 从下一行开始（行尾空白丢掉）；
      // `$$` 后面带内容 → 从紧跟 `$$` 处开始（同一行的正文要保留）。
      const contentFrom = alone ? line.to + 1 : line.from + fenceLength;
      matches.push({
        from: line.from,
        to: lines[close].to,
        kind: "math",
        content: stripTrailingNewline(
          dedent(source.slice(contentFrom, lines[close].from)),
        ),
      });
      i = close + 1;
      continue;
    }

    // 没找到闭合行：
    //   - `$$` 独占一行 → 按 remark-math 的行为一路吞到文末
    //   - `$$` 后面带内容 → 不认。micromark 在这个角落的行为没验证过，
    //     与其猜一个可能吞掉整篇文档的规则，不如老实退回源码。
    if (alone) {
      matches.push({
        from: line.from,
        to: source.length,
        kind: "math",
        content: dedent(source.slice(line.to + 1)).replace(/\n+$/, ""),
      });
      break;
    }
    i++;
  }

  return matches;
}

/** 去掉结尾的换行符（`\r\n` 也要处理——`scanLines` 只按 `\n` 切分） */
function stripTrailingNewline(text: string): string {
  return text.replace(/\r?\n$/, "");
}

/**
 * 剥掉所有非空行的**公共**前导空白。
 *
 * 必须按公共前缀剥，不能逐行 `trimStart()`：
 * `\begin{align}` 里各行的对齐靠的是**相对**缩进，逐行 trim 会把对齐彻底抹平，
 * 公式会渲染成错位的样子（实测 remark-math 是剥公共前缀的）。
 */
function dedent(content: string): string {
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

/** 公式块渲染器 */
export const mathBlockRenderer: BlockRenderer = {
  id: "math-block",

  find(tree, source) {
    return findMathBlocks(tree, source);
  },

  render(match) {
    // KaTeX 还没加载完 → 返回 null，装饰器管线会跳过它，
    // 公式块保持源码形态；加载完成后由 `onMathRendererReady` 触发重算。
    const html = renderMathSync(match.content);
    if (html === null) return null;

    const dom = document.createElement("div");
    dom.className = "cm-md-math";
    dom.innerHTML = html;
    return {
      dom,
      key: `math:${match.content}`,
    } satisfies BlockRenderResult;
  },
};

/** 供测试用：暴露行类型，避免测试里重复 import */
export type { Line };

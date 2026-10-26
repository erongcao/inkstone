/**
 * 行内数学公式：`$x^2$` 与 `$$x^2$$`。
 *
 * 为什么**逐行**解析而不是整篇 remark：
 *   实测 remark 全量解析 1000 行 p95 ≈ 11ms，每击键都跑会直接吃掉交互预算。
 *   而 micromark 的**行内公式不能跨行**（实测 `开头 $x^2\n+ y^2$ 结尾`
 *   全文解析也不产生 `inlineMath`），所以对「行内公式」这个子问题，
 *   逐行解析与全文解析是**等价**的。
 *
 *   这个等价性不是口头保证：`tests/inline-math.test.ts` 有一组**对拍**用例，
 *   拿 13 份语料 + 一批刁钻片段，逐个对比逐行结果与全文解析结果，
 *   必须逐字节一致。任何改动先过那组对拍。
 *
 * 两种提速手段：
 *   1. 整篇快速筛：文档里没有 `$` 就直接返回，连行扫描都不跑
 *   2. 只解析含 `$` 的行（绝大多数文档行内公式很少）
 *
 * 禁区由 lezer 划（代码块 / HTML 块，见 `scan.ts` 的说明），
 * 另外还要剔除已被**块级渲染器**占用的区间——
 * 行首的 `$$x^2$$` remark 判成 `inlineMath`，但块级渲染器也认它，
 * 两边撞车会让同一段文本既被替换成块级 widget 又被替换成行内 widget。
 */

import type { Node, Parent } from "mdast";
import type { Tree } from "@lezer/common";
import { parseInlineSync, renderMathSync } from "./math-loader";
import { resolveFeatures, type MarkdownFeatures } from "@/parser/features";
import {
  collectSkipRanges,
  makeSkipTest,
  overlapsAny,
  scanLines,
  type Interval,
} from "./scan";

/** 一个行内公式 */
export interface InlineMathMatch extends Interval {
  /** 定界符内部的 TeX（不含 `$`） */
  tex: string;
}

export interface InlineMathOptions {
  /**
   * 要启用的扩展。
   *
   * 这里只需要两件事：`inlineMath` 决定**找不找**（关了就直接不找），
   * `inlineMathSingleDollar` 决定单个 `$` 算不算定界符。
   */
  features?: Partial<MarkdownFeatures>;
  /** 已被块级渲染器占用的区间，行内渲染必须让开 */
  blockRanges?: readonly Interval[];
}

/** 从 mdast 里收集 `inlineMath` 节点（不进入 `inlineCode` 等子树） */
function collectInlineMath(node: Node, out: InlineMathMatch[], offsetBase: number): void {
  const parent = node as Parent;
  if (Array.isArray(parent.children)) {
    for (const child of parent.children) collectInlineMath(child, out, offsetBase);
    return;
  }
  if (node.type !== "inlineMath" || !node.position) return;
  // mdast 的 position.offset 在类型上是可选的，但 remark 一定给（我们刚 parse 出来的树）
  const start = node.position.start.offset;
  const end = node.position.end.offset;
  if (start === undefined || end === undefined) return;
  out.push({
    from: offsetBase + start,
    to: offsetBase + end,
    tex: (node as unknown as { value: string }).value,
  });
}

/**
 * 把 TeX 渲染成行内公式 HTML。
 *
 * KaTeX 还没就绪时返回 null —— 调用方据此不生成装饰器，
 * 行内公式保持源码形态，加载完成后由 `onMathRendererReady` 触发重算。
 */
export function renderInlineMath(tex: string, mhchem = true): string | null {
  return renderMathSync(tex, { displayMode: false, mhchem });
}

/**
 * 找出文档里所有行内公式。
 *
 * 区间含定界符本身（与 remark 的 `position` 一致），
 * 所以可以直接拿来做「替换 `$x$$` 整段」的装饰器。
 */
export function findInlineMath(
  tree: Tree,
  source: string,
  options: InlineMathOptions = {},
): InlineMathMatch[] {
  const matches: InlineMathMatch[] = [];
  // 绝大多数文档里根本没有 `$`，先做一次原生字符串快筛
  if (!source.includes("$")) return matches;

  const features = resolveFeatures(options.features);
  // 行内公式整个关掉 → 根本不找。
  //
  // 解析层那边也会把公式还原成字面文本（`remarkMathOff`），
  // 所以这里其实是个快筛——但它省掉整篇逐行解析，值得放在最前面。
  if (!features.inlineMath) return matches;

  const skipRanges: Interval[] = [
    ...collectSkipRanges(tree),
    ...(options.blockRanges ?? []),
  ];
  const isSkipped = makeSkipTest(skipRanges);

  for (const line of scanLines(source)) {
    if (isSkipped(line.from) || !line.text.includes("$")) continue;

    // 逐行解析。补一个换行是为了让 remark 把这一行当成完整的段落
    // （没有结尾换行时最后一行会被当作「文档结束」，行为一致但更保险）。
    //
    // 管线还没加载完（remark 与 KaTeX 在同一个按需 chunk 里）时直接放弃这一轮，
    // 不退回任何「轻量正则」——那会变成编辑器自造的规则，红线 C 就破了。
    // 加载完成会触发 refreshRendering，那时再补上。
    const lineTree = parseInlineSync(`${line.text}\n`, {
      features: { inlineMathSingleDollar: features.inlineMathSingleDollar },
    });
    if (lineTree === null) return [];

    const found: InlineMathMatch[] = [];
    collectInlineMath(lineTree as unknown as Node, found, line.from);
    for (const hit of found) {
      // 兜底：块级区间可能跨行，逐行的 skip 判定只看了行首位置
      if (overlapsAny(hit, options.blockRanges ?? [])) continue;
      matches.push(hit);
    }
  }

  return matches;
}

/**
 * 行内公式定位的护栏测试。
 *
 * 最重要的一组是 **对拍（差分测试）**：
 * `findInlineMath` 为了性能只逐行解析含 `$` 的行，
 * 而不是整篇跑 remark。这个优化成立的前提是
 * 「micromark 的行内公式不能跨行，所以逐行解析与全文解析等价」。
 *
 * 对拍就是把这个前提**变成可执行的断言**：
 * 对 13 份语料 + 一批刁钻片段，逐个对比
 * 「逐行结果」与「全文 remark 解析结果」，必须逐字节一致。
 * 任何改动（加规则、换解析器、改选项透传）都先过这组。
 */

import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Node, Parent } from "mdast";
import { parseSyntax } from "@/editor/live-preview/syntax";
import { buildLivePreviewDecorations } from "@/editor/live-preview/decorations";
import { parseMarkdown, type ParseOptions } from "@/parser/markdown";
import type { MarkdownFeatures } from "@/parser/features";
import { ensureMathRenderer } from "@/editor/render/math-loader";
import { findMathBlocks, mathBlockRenderer } from "@/editor/render/math-block";
import { codeBlockRenderer } from "@/editor/render/code-block";
import { registerBlockRenderer, clearBlockRenderers } from "@/editor/render/registry";
import { findInlineMath, type InlineMathMatch } from "@/editor/render/inline-math";

const CORPUS_DIR = join(process.cwd(), "tests", "corpus");
const corpusFiles = readdirSync(CORPUS_DIR)
  .filter((f) => f.endsWith(".md"))
  .sort();

/** 用**全文** remark 解析收集 inlineMath —— 作为对拍的基准 */
function fullDocumentInlineMath(source: string, options: ParseOptions): InlineMathMatch[] {
  const out: InlineMathMatch[] = [];
  const walk = (node: Node): void => {
    const parent = node as Parent;
    if (Array.isArray(parent.children)) {
      for (const child of parent.children) walk(child);
      return;
    }
    if (node.type !== "inlineMath" || !node.position) return;
    out.push({
      from: node.position.start.offset,
      to: node.position.end.offset,
      tex: (node as { value: string }).value,
    });
  };
  walk(parseMarkdown(source, options) as unknown as Node);
  return out;
}

// 行内定位走的是懒加载的 remark 管线（和 KaTeX 同一个 chunk），
// 没加载完时 `findInlineMath` 会返回空数组——所以先把它加载好再测。
beforeAll(async () => {
  await ensureMathRenderer();
});

/** 剔除被块级渲染器占用的区间后，两边才应当一致 */
function withoutBlockRanges(
  matches: InlineMathMatch[],
  blockRanges: { from: number; to: number }[],
): InlineMathMatch[] {
  return matches.filter(
    (m) => !blockRanges.some((b) => m.from < b.to && b.from < m.to),
  );
}

describe("对拍：逐行解析 ≡ 全文解析", () => {
  it.each(corpusFiles)("语料 %s 的行内公式位置完全一致", (file) => {
    const source = readFileSync(join(CORPUS_DIR, file), "utf8");
    const tree = parseSyntax(source);
    const blockRanges = findMathBlocks(tree, source).map(({ from, to }) => ({ from, to }));

    for (const singleDollarTextMath of [true, false]) {
      const expected = withoutBlockRanges(
        fullDocumentInlineMath(source, {
          features: { inlineMathSingleDollar: singleDollarTextMath },
        }),
        blockRanges,
      );
      const actual = findInlineMath(tree, source, {
        features: { inlineMathSingleDollar: singleDollarTextMath },
        blockRanges,
      });
      expect(actual, `${file}（singleDollarTextMath=${singleDollarTextMath}）`).toEqual(expected);
    }
  });

  const tricky: [string, string][] = [
    ["跨行不是公式", "开头 $x^2\n+ y^2$ 结尾"],
    ["列表项内", "- 项目里的 $x^2$ 公式"],
    ["嵌套列表", "1. 一级 $a$\n   - 二级 $b$"],
    ["引用内", "> 引用里的 $x^2$ 公式"],
    ["引用里的列表", "> - 引用列表 $c$"],
    ["表格单元", "| a | b |\n| --- | --- |\n| $x^2$ | y |"],
    ["表格里多个", "| a | b |\n| --- | --- |\n| $x$ | $y$ |"],
    ["段落续行", "第一行没有公式\n第二行有 $x^2$ 公式"],
    ["围栏代码块内", "```\n$x$\n```"],
    ["围栏代码块带语言", "```js\nconst a = $b$;\n```"],
    ["缩进代码块内", "    $x$"],
    ["HTML 块内", "<div>\n$x$\n</div>"],
    ["转义美元", "价格 \\$5 到 \\$10"],
    ["同一行多个", "a $x$ 和 $y$ 还有 $z$"],
    ["货币区间（会误判）", "价格 $5 到 $10 元"],
    ["单个金额", "只要 $5 就好"],
    ["前后空格", "写 $ x^2 $ 不好"],
    ["紧贴标点", "（$x^2$）"],
    ["紧贴中文", "公式$x^2$结束"],
    ["行首单块", "$$x^2$$"],
    ["独占块", "$$\nx^2\n$$"],
    ["块里有美元", "$$\n\\$x\n$$"],
    ["空公式", "`` 和 $$ 和 $ $"],
    ["标题里的公式", "# 标题 $x^2$"],
    ["Setext 标题", "标题 $x$\n====="],
    ["水平线后", "---\n\n$x$"],
    ["引用块多段", "> $a$\n>\n> $b$"],
  ];

  it.each(tricky)("%s", (_name, source) => {
    const tree = parseSyntax(source);
    const blockRanges = findMathBlocks(tree, source).map(({ from, to }) => ({ from, to }));

    for (const singleDollarTextMath of [true, false]) {
      const expected = withoutBlockRanges(
        fullDocumentInlineMath(source, {
          features: { inlineMathSingleDollar: singleDollarTextMath },
        }),
        blockRanges,
      );
      const actual = findInlineMath(tree, source, {
        features: { inlineMathSingleDollar: singleDollarTextMath },
        blockRanges,
      });
      expect(actual, `${source}（singleDollarTextMath=${singleDollarTextMath}）`).toEqual(expected);
    }
  });
});

describe("定位结果本身的正确性", () => {
  it("区间含定界符，tex 不含定界符", () => {
    const source = "行内 $x^2$ 结束";
    const hits = findInlineMath(parseSyntax(source), source);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toEqual({ from: 3, to: 8, tex: "x^2" });
    expect(source.slice(hits[0].from, hits[0].to)).toBe("$x^2$");
  });

  it("多个公式各自独立", () => {
    const source = "a $x$ 和 $y$ 还有 $z$";
    const hits = findInlineMath(parseSyntax(source), source);
    expect(hits.map((h) => h.tex)).toEqual(["x", "y", "z"]);
  });

  it("文档里没有 $ 时走快速筛，零匹配", () => {
    const source = "只有普通 Markdown。\n\n第二段。";
    expect(findInlineMath(parseSyntax(source), source)).toEqual([]);
  });

  it("代码块内的 $x$ 不算行内公式", () => {
    const source = "```\n$x$\n```";
    expect(findInlineMath(parseSyntax(source), source)).toEqual([]);
  });

  it("行内代码里的 $x$ 不算行内公式", () => {
    const source = "用 `$x$` 这种写法";
    expect(findInlineMath(parseSyntax(source), source)).toEqual([]);
  });
});

describe("singleDollarTextMath 开关", () => {
  it("默认开：单 $ 是定界符", () => {
    const source = "行内 $x^2$ 结束";
    const hits = findInlineMath(parseSyntax(source), source);
    expect(hits).toHaveLength(1);
  });

  it("关掉后：单 $ 不再是定界符", () => {
    const source = "行内 $x^2$ 结束";
    const hits = findInlineMath(parseSyntax(source), source, {
      features: { inlineMathSingleDollar: false },
    });
    expect(hits).toEqual([]);
  });

  it("关掉后：价格区间不再被误判（这是关它的主要动机）", () => {
    const source = "价格 $5 到 $10 元";
    expect(
      findInlineMath(parseSyntax(source), source, {
      features: { inlineMathSingleDollar: true },
    }),
    ).toHaveLength(1);
    expect(
      findInlineMath(parseSyntax(source), source, {
      features: { inlineMathSingleDollar: false },
    }),
    ).toEqual([]);
  });

  it("关掉后：$$…$$ 在行内仍然是行内公式（所以关掉不等于失去行内公式）", () => {
    const source = "行内 $$x^2$$ 结束";
    const hits = findInlineMath(parseSyntax(source), source, {
      features: { inlineMathSingleDollar: false },
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].tex).toBe("x^2");
  });
});

describe("与块级渲染器的区间互斥", () => {
  it("行首 $$x^2$$ 归块级，行内渲染让开", () => {
    const source = "$$x^2$$\n\n正文 $y$ 结束";
    const tree = parseSyntax(source);
    const blockRanges = findMathBlocks(tree, source).map(({ from, to }) => ({ from, to }));
    const hits = findInlineMath(tree, source, { blockRanges });

    // 块级独占 [0,7)，行内只应拿到第二个公式
    expect(blockRanges).toEqual([{ from: 0, to: 7 }]);
    expect(hits).toHaveLength(1);
    expect(hits[0].tex).toBe("y");
  });

  it("行中 $$…$$（不是块级）归行内渲染", () => {
    const source = "前面 $$x^2$$ 后面";
    const tree = parseSyntax(source);
    const blockRanges = findMathBlocks(tree, source).map(({ from, to }) => ({ from, to }));
    expect(blockRanges).toEqual([]);
    const hits = findInlineMath(tree, source, { blockRanges });
    expect(hits).toHaveLength(1);
    expect(hits[0].tex).toBe("x^2");
  });

  it("跨行的块级区间也会让开（逐行的 skip 只看行首，必须再兜一次底）", () => {
    const source = "$$\nx^2\n$$\n\n正文 $y$";
    const tree = parseSyntax(source);
    const blockRanges = findMathBlocks(tree, source).map(({ from, to }) => ({ from, to }));
    const hits = findInlineMath(tree, source, { blockRanges });
    expect(hits.map((h) => h.tex)).toEqual(["y"]);
  });
});

describe("装饰器管线集成", () => {
  // 装饰器管线只认「已注册的渲染器集合」，这里必须先把两个渲染器注册进去，
  // 否则块级那一路根本不会跑，测出来的「不重叠」是假的。
  beforeEach(() => {
    clearBlockRenderers();
    registerBlockRenderer(codeBlockRenderer);
    registerBlockRenderer(mathBlockRenderer);
  });

  /** 收集「被替换成 widget」的区间（含行内与块级） */
  function replacedRanges(
    source: string,
    cursor: number,
    features?: Partial<MarkdownFeatures>,
  ) {
    const set = buildLivePreviewDecorations(
      source,
      cursor,
      "live",
      parseSyntax(source),
      features,
    );
    const out: { from: number; to: number; block: boolean }[] = [];
    const it = set.iter();
    while (it.value !== null) {
      const spec = it.value.spec as { widget?: unknown; block?: boolean };
      if (spec.widget) out.push({ from: it.from, to: it.to, block: spec.block === true });
      it.next();
    }
    return out;
  }

  it("光标在公式外 → 行内公式被替换成 widget", async () => {
    await ensureMathRenderer();
    const source = "行内 $x^2$ 结束";
    const hit = findInlineMath(parseSyntax(source), source)[0];
    const range = replacedRanges(source, 0).find((r) => r.from === hit.from && !r.block);
    expect(range).toBeDefined();
    expect(range!.to).toBe(hit.to);
  });

  it("光标在公式内 → 露出 $…$ 源码（不替换）", async () => {
    await ensureMathRenderer();
    const source = "行内 $x^2$ 结束";
    const hit = findInlineMath(parseSyntax(source), source)[0];
    const inside = hit.from + 2;
    expect(replacedRanges(source, inside).find((r) => r.from === hit.from)).toBeUndefined();
  });

  it("关掉单 $ 之后，同一份文档不再产生行内装饰器", async () => {
    await ensureMathRenderer();
    const source = "行内 $x^2$ 结束";
    const hit = findInlineMath(parseSyntax(source), source, {
      features: { inlineMathSingleDollar: false },
    });
    expect(hit).toEqual([]);
    expect(
      replacedRanges(source, 0, { inlineMathSingleDollar: false }).find((r) => r.from === 3),
    ).toBeUndefined();
  });

  it("同一区间不会被块级与行内同时替换（行首 $$…$$ 只出块级）", async () => {
    await ensureMathRenderer();
    const source = "$$x^2$$";
    const ranges = replacedRanges(source, 0);
    const covering = ranges.filter((r) => r.from === 0 && r.to === 7);
    expect(covering).toHaveLength(1);
    expect(covering[0].block).toBe(true);
  });
});
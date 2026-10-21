/**
 * 块级公式的护栏测试。
 *
 * 覆盖三件事：
 *   1. `$$…$$` 的**定位**——这是行扫描出来的，最容易出错的就是误判：
 *      代码块里的 `$$`、HTML 块里的 `$$`、行中的 `$$` 都必须**不**算块级公式
 *   2. **展开判定**——与代码块共用同一套「光标在块外才渲染」契约
 *   3. 渲染**降级**——KaTeX 没就绪时返回 null（块保持源码），而不是抛异常
 *
 * 定位规则不是拍脑袋定的，每一条都对着 `parseMarkdown`（remark-math）实测过，
 * 见 `math-block.ts` 顶部的说明。改规则前请先复现，别凭直觉。
 */

import { describe, expect, it, beforeEach, beforeAll, vi } from "vitest";
import { parseSyntax } from "@/editor/live-preview/syntax";
import { buildLivePreviewDecorations } from "@/editor/live-preview/decorations";
import { findMathBlocks, mathBlockRenderer } from "@/editor/render/math-block";
import { codeBlockRenderer } from "@/editor/render/code-block";
import { registerBlockRenderer, clearBlockRenderers } from "@/editor/render/registry";
import { ensureMathRenderer, renderMathSync } from "@/editor/render/math-loader";

const DOC = ["前文段落。", "", "$$", "x^2 + y^2 = z^2", "$$", "", "后文段落。"].join("\n");

/** 收集装饰器里「块级替换」的部分 */
function blockRanges(source: string, cursor: number) {
  const set = buildLivePreviewDecorations(source, cursor, "live", parseSyntax(source));
  const out: { from: number; to: number; block: boolean }[] = [];
  const it = set.iter();
  while (it.value !== null) {
    const spec = it.value.spec as { widget?: unknown; block?: boolean };
    if (spec.widget) out.push({ from: it.from, to: it.to, block: spec.block === true });
    it.next();
  }
  return out;
}

beforeEach(() => {
  clearBlockRenderers();
  registerBlockRenderer(mathBlockRenderer);
});

// 下面所有需要真实 DOM 输出的用例都依赖 KaTeX，先加载
beforeAll(async () => {
  await ensureMathRenderer();
});

describe("公式块定位", () => {
  it("认得独占两行的 $$ 定界符", () => {
    const blocks = findMathBlocks(parseSyntax(DOC), DOC);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("math");
    expect(blocks[0].content).toBe("x^2 + y^2 = z^2");
    expect(DOC.slice(blocks[0].from, blocks[0].to)).toBe("$$\nx^2 + y^2 = z^2\n$$");
  });

  it("认得行首的单行 $$…$$", () => {
    const doc = "$$y^2$$\n\n后面。";
    const blocks = findMathBlocks(parseSyntax(doc), doc);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toBe("y^2");
    expect(doc.slice(blocks[0].from, blocks[0].to)).toBe("$$y^2$$");
  });

  it("认得开标记带内容 + 闭合行的写法", () => {
    const doc = ["$$x^2", "y^2 = z^2", "$$", ""].join("\n");
    const blocks = findMathBlocks(parseSyntax(doc), doc);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toBe("x^2\ny^2 = z^2");
  });

  it("行中的 $$…$$ 不是块级公式（remark-math 判为 inlineMath）", () => {
    const doc = "结尾 $$y^2$$ 结束";
    expect(findMathBlocks(parseSyntax(doc), doc)).toHaveLength(0);
  });

  it("未闭合的 $$ 一路吞到文末（与 remark-math 的 math 节点一致）", () => {
    const doc = "$$\nx^2\n\n后面还有正文段落。";
    const blocks = findMathBlocks(parseSyntax(doc), doc);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toBe("x^2\n\n后面还有正文段落。");
    expect(blocks[0].to).toBe(doc.length);
  });

  it("围栏代码块里的 $$ 不是公式", () => {
    const doc = ["前文", "", "```", "$$", "x^2", "$$", "```", ""].join("\n");
    expect(findMathBlocks(parseSyntax(doc), doc)).toHaveLength(0);
  });

  it("缩进代码块里的 $$ 不是公式（4 空格起是缩进代码块）", () => {
    const doc = ["前文", "", "    $$", "    x^2", ""].join("\n");
    expect(findMathBlocks(parseSyntax(doc), doc)).toHaveLength(0);
  });

  it("HTML 块里的 $$ 不是公式", () => {
    const doc = ["<div>", "$$", "x^2", "$$", "</div>"].join("\n");
    expect(findMathBlocks(parseSyntax(doc), doc)).toHaveLength(0);
  });

  it("同一份文档里可以有多组公式，且互不吞并", () => {
    const doc = ["$$", "a", "$$", "", "文字", "", "$$", "b", "$$"].join("\n");
    const blocks = findMathBlocks(parseSyntax(doc), doc);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].content).toBe("a");
    expect(blocks[1].content).toBe("b");
  });

  it("文档里没有 $$ 时走快筛，零匹配", () => {
    expect(findMathBlocks(parseSyntax("只有普通 Markdown。\n\n第二段。"), "只有普通 Markdown。\n\n第二段。")).toHaveLength(0);
  });

  it("行首最多允许 3 个空格", () => {
    const indented = ["   $$", "   x", "   $$"].join("\n");
    const blocks = findMathBlocks(parseSyntax(indented), indented);
    expect(blocks).toHaveLength(1);
    expect(indented.slice(blocks[0].from, blocks[0].to)).toBe("   $$\n   x\n   $$");
  });

  it("剥掉公共缩进，但保留行内的相对缩进（LaTeX 对齐环境靠它）", () => {
    const plain = ["$$", "\\begin{align}", "y = a &= b \\\\", "z   &= c", "\\end{align}", "$$"].join(
      "\n",
    );
    expect(findMathBlocks(parseSyntax(plain), plain)[0].content).toBe(
      "\\begin{align}\ny = a &= b \\\\\nz   &= c\n\\end{align}",
    );

    // 整体再缩进 3 格：公共缩进应被剥回原样，相对缩进不动
    const indented = plain
      .split("\n")
      .map((l) => (l.length ? "   " + l : l))
      .join("\n");
    expect(findMathBlocks(parseSyntax(indented), indented)[0].content).toBe(
      "\\begin{align}\ny = a &= b \\\\\nz   &= c\n\\end{align}",
    );
  });
});

describe("展开判定", () => {
  it("光标在块外 → 公式被替换成 widget", () => {
    const block = blockRanges(DOC, 0).find((r) => r.block);
    expect(block).toBeDefined();
    expect(block!.from).toBe(DOC.indexOf("$$"));
  });

  it("光标在块内 → 显示源码", () => {
    const inside = DOC.indexOf("x^2") + 2;
    expect(blockRanges(DOC, inside).find((r) => r.block)).toBeUndefined();
  });
});

describe("KaTeX 的就绪与降级", () => {
  it("未就绪时 render 返回 null（块保持源码，而不是崩掉）", async () => {
    // 用一个全新的模块实例，保证它的 math-loader 也从未加载过
    vi.resetModules();
    const fresh = await import("@/editor/render/math-block");
    const result = fresh.mathBlockRenderer.render(
      { from: 0, to: 3, kind: "math", content: "x" },
      "",
    );
    expect(result).toBeNull();
  });

  it("就绪后能产出 KaTeX HTML（含 MathML 无障碍标注）", () => {
    const html = renderMathSync("x^2");
    expect(html).not.toBeNull();
    expect(html).toContain("katex");
    expect(html).toContain("annotation");
  });

  it("非法 TeX 不抛异常，而是渲染成错误标记（用户正在打字，中间状态本就非法）", () => {
    const html = renderMathSync("\\frac{1");
    expect(html).not.toBeNull();
    expect(html).toContain("katex-error");
  });

  it("render 返回真实 DOM 与内容指纹", () => {
    const result = mathBlockRenderer.render(
      { from: 0, to: 10, kind: "math", content: "x^2" },
      "",
    );
    expect(result).not.toBeNull();
    expect(result!.dom.className).toBe("cm-md-math");
    expect(result!.key).toBe("math:x^2");
  });

  it("公式块不与代码块产生重叠区间", () => {
    const doc = ["```", "$$", "x", "$$", "```", "", "$$", "y", "$$"].join("\n");
    clearBlockRenderers();
    // 同时注册两个渲染器，检查两条管线的区间不相交
    registerBlockRenderer(codeBlockRenderer);
    registerBlockRenderer(mathBlockRenderer);
    const ranges = blockRanges(doc, 0).filter((r) => r.block);
    for (const a of ranges) {
      for (const b of ranges) {
        if (a === b) continue;
        expect(a.to <= b.from || b.to <= a.from).toBe(true);
      }
    }
    expect(ranges).toHaveLength(2);
  });
});
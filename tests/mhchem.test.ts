/**
 * mhchem（化学扩展）开关的护栏测试。
 *
 * ## 这个开关的语义
 *
 * KaTeX **内置** mhchem——`\ce{H2O}` 直接就能渲染成化学式，
 * 不需要额外插件。所以「关掉 mhchem」不是「装没装插件」的问题，
 * 而是「要不要让它生效」的问题。
 *
 * 关掉之后，`\ce{…}` 应该显示成**字面文本**——
 * 不是空白，也不是报错，更不是「悄悄变成别的意思」。
 *
 * ## 为什么单��一个文件
 *
 * mhchem 的开关要穿过**四条路径**：
 * 编辑器内的行内公式、编辑器内的块级公式、复制出去的 HTML、导出的 HTML。
 * 四条路径必须给出**同一个结果**——否则「所见即所得」当场破功。
 *
 * 它们的共同收口是 `renderMath`（见 `src/editor/render/math-render.ts`），
 * 所以测试也从那里切进去。
 */

import { describe, expect, it, beforeAll } from "vitest";
import { markdownToHtml } from "@/parser/html";
import { ensureMathRenderer } from "@/editor/render/math-loader";
import { stripMhchem } from "@/editor/render/mhchem";

beforeAll(async () => {
  await ensureMathRenderer();
});

describe("stripMhchem：把化学命令降级成字面文本", () => {
  it("`\\ce{…}` 被换成 `\\verb` 包裹的原文", () => {
    const out = stripMhchem("\\ce{H2O}");
    expect(out).toContain("\\verb");
    expect(out).toContain("ce{H2O}");
  });

  it("`\\pu{…}` 同样处理", () => {
    const out = stripMhchem("\\pu{123 kJ}");
    expect(out).toContain("\\verb");
    expect(out).toContain("pu{123 kJ}");
  });

  it("普通公式不受影响", () => {
    expect(stripMhchem("x^2 + y^2")).toBe("x^2 + y^2");
  });

  it("没有 mhchem 命令时原样返回", () => {
    expect(stripMhchem("E = mc^2")).toBe("E = mc^2");
  });

  it("花括号可以嵌套", () => {
    const out = stripMhchem("\\ce{H2{O}}");
    expect(out).toContain("\\verb");
    expect(out).toContain("H2{O}");
  });

  it("命令后面没有花括号就不动它", () => {
    expect(stripMhchem("\\ce")).toBe("\\ce");
  });

  it("花括号没闭合就不动它", () => {
    expect(stripMhchem("\\ce{H2O")).toBe("\\ce{H2O");
  });

  it("分隔符不会与内容冲突", () => {
    // 内容里已经有 `|` 时要换一个分隔符，否则 `\\verb` 会被拆错
    const out = stripMhchem("\\ce{A|B}");
    expect(out).toContain("\\verb");
  });
});

describe("导出：mhchem 开关两边的结果不同", () => {
  it("开着 → 渲染成化学式", () => {
    const html = markdownToHtml("$\\ce{H2O}$", { features: { mhchem: true } });
    expect(html).toContain("katex");
    // mhchem 的化学式会带上自己的类名
    expect(html).toContain("mord");
  });

  it("关掉 → `\\ce{…}` 变成字面文本", () => {
    const html = markdownToHtml("$\\ce{H2O}$", { features: { mhchem: false } });
    expect(html).toContain("katex");
    // 字面文本里能看到原样的 `\ce{H2O}`
    expect(html).toContain("\\ce");
  });

  it("关掉 mhchem 不影响普通公式", () => {
    const html = markdownToHtml("$E=mc^2$", { features: { mhchem: false } });
    expect(html).toContain("katex");
    expect(html).not.toContain("\\ce");
  });
});

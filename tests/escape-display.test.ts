/**
 * 转义（`\*` / `\\`）在编辑器里的显示。
 *
 * ## 为什么这是一个 bug 而不是「特性」
 *
 * 语义层（remark）那边转义是**解开**的：`a \* b` 的正文是 `a * b`，
 * 导出成 HTML 也是 `a * b`。
 * 而 lezer 的 `Escape` 节点照原文覆盖「反斜杠 + 字符」，
 * 编辑器若原样显示，用户看到的是 `a \* b`——
 * **屏幕上是反斜杠、导出是星号**，架构约束 C（屏幕与导出必须一致）的一个实际破口。
 *
 * 所以编辑器要藏掉反斜杠，只留被转义的字符；
 * 光标进入该转义时恢复原文（和行内标记一个规矩）。
 *
 * 这条修复**不限于下标 / 上标**——普通文本里的 `\*` 同样对不上，
 * 一起修掉才对（同一个成因，分开修就会漏）。
 */

import { describe, expect, it } from "vitest";
import { buildLivePreviewDecorations } from "@/editor/live-preview/decorations";
import { parseSyntax } from "@/editor/live-preview/syntax";
import { markdownToHtml } from "@/parser/html";
import type { MarkerDisplayMode } from "@/settings/schema";

interface Deco {
  from: number;
  to: number;
  kind: "replace" | "mark";
  cls?: string;
}

/** 把装饰器集合摊平成可断言的数组 */
function collect(doc: string, cursor: number, mode: MarkerDisplayMode = "live"): Deco[] {
  const set = buildLivePreviewDecorations(doc, cursor, mode, parseSyntax(doc));
  const out: Deco[] = [];
  const it = set.iter();
  while (it.value !== null) {
    const spec = it.value.spec as { widget?: unknown; class?: string };
    out.push({
      from: it.from,
      to: it.to,
      kind: spec.widget ? "replace" : "mark",
      cls: spec.class,
    });
    it.next();
  }
  return out;
}

/** 被隐藏（零宽 widget 顶替）的区间 */
function hiddenRanges(doc: string, cursor: number, mode: MarkerDisplayMode = "live") {
  return collect(doc, cursor, mode)
    .filter((d) => d.kind === "replace")
    .map((d) => [d.from, d.to]);
}

/** 被弱化（dimmed 模式）的区间与 class */
function dimmedRanges(doc: string, cursor: number, mode: MarkerDisplayMode = "live") {
  return collect(doc, cursor, mode)
    .filter((d) => d.kind === "mark" && d.cls === "cm-md-marker")
    .map((d) => [d.from, d.to]);
}

describe("转义：编辑器显示与导出一致", () => {
  it("反斜杠被藏掉，只留被转义的字符", () => {
    // 文档：a \* b
    //       0123456
    // 反斜杠在 [2,3)
    expect(hiddenRanges("a \\* b", 0)).toEqual([[2, 3]]);
  });

  it("光标进入转义时恢复原文（能直接编辑那个反斜杠）", () => {
    // 光标落在转义内部（2 与 3 之间）→ 不藏
    expect(hiddenRanges("a \\* b", 3)).toEqual([]);
    // 光标紧跟在被转义字符之后 → 恢复原文（与行内标记的规矩一致）
    expect(hiddenRanges("a \\* b", 4)).toEqual([]);
    // 光标在转义之前 → 照旧藏
    expect(hiddenRanges("a \\* b", 2)).toEqual([[2, 3]]);
  });

  it("转义的反斜杠（`\\\\`）也藏：屏幕上是一个反斜杠", () => {
    // 文档：a \\ b —— 两个字符是**一个**转义（被转义的是反斜杠本身）
    expect(hiddenRanges("a \\\\ b", 0)).toEqual([[2, 3]]);
  });

  it("行内代码里的反斜杠**不动**（代码跨度不解析转义）", () => {
    // 文档：`a \* b` —— 反斜杠在 [3,4)，是代码的一部分
    // （藏掉的是两端的反引号，那是行内代码的标记，与转义无关）
    const hidden = hiddenRanges("`a \\* b`", 0);
    expect(hidden).toContainEqual([0, 1]);
    expect(hidden).toContainEqual([7, 8]);
    expect(hidden).not.toContainEqual([3, 4]);
  });

  it("链接地址里的反斜杠不动（URL 不解析转义）", () => {
    // 文档：[t](u\*x) —— 反斜杠在 [5,6)
    const hidden = hiddenRanges("[t](u\\*x)", 0);
    expect(hidden).not.toContainEqual([5, 6]);
  });

  it("dimmed 模式：反斜杠弱化显示，不隐藏", () => {
    expect(dimmedRanges("a \\* b", 0, "dimmed")).toEqual([[2, 3]]);
    expect(hiddenRanges("a \\* b", 0, "dimmed")).toEqual([]);
  });

  it("下标里的转义：编辑器显示 `~x`，与导出一致", () => {
    // 文档：~\~x~ —— 内容里的 `~` 是转义过的
    // 语义层解开后内容是 `~x`，导出是 <sub>~x</sub>
    expect(markdownToHtml("~\\~x~")).toContain("<sub>~x</sub>");
    // 编辑器里藏掉的是：[0,1) 与 [4,5) 是下标标记，
    // [1,2) 是那个反斜杠 → 屏幕上呈现为 `~x`
    expect(hiddenRanges("~\\~x~", 0)).toEqual([
      [0, 1],
      [1, 2],
      [4, 5],
    ]);
  });
});

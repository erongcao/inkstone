/**
 * GFM 表格的护栏测试。
 *
 * 最重要的是**对拍组**：`findTables` 用行扫描识别表格，
 * 必须与语义层的 `remark-gfm`（mdast 的 `table` 节点）**逐字节一致**。
 * 判定规则只要和 remark-gfm 有偏差，就会出现
 * 「编辑器渲染成表格、导出却是段落」的分裂（架构约束 C）。
 */

import { describe, expect, it, beforeAll } from "vitest";
import type { Node, Parent } from "mdast";
import { parseSyntax } from "@/editor/live-preview/syntax";
import { parseMarkdown } from "@/parser/markdown";
import { ensureHtmlRenderer } from "@/parser/html-loader";
import { findTables, parseDelimiterRow, tableRenderer } from "@/editor/render/table";
import { findMathBlocks } from "@/editor/render/math-block";
import { registerBlockRenderer, clearBlockRenderers } from "@/editor/render/registry";
import { codeBlockRenderer } from "@/editor/render/code-block";
import { mathBlockRenderer } from "@/editor/render/math-block";

type Align = "left" | "center" | "right" | null;

/**
 * 用全文 remark-gfm 解析收集表格 —— 对拍的基准。
 *
 * **只比对结构**（区间 / 对齐 / 每行列数），不比对单元格文本：
 *   remark 的 `tableCell` 遇到 `**粗**` 这种行内标记时没有 `value`，
 *   强行去拼文本只会让测试去纠结「转义保留」和「两端空白」这些
 *   与契约无关的细节。单元格**内容**的正确性由下面的渲染用例单独保证。
 */
function remarkTables(
  source: string,
): { from: number; to: number; align: Align[]; cols: number[] }[] {
  const out: { from: number; to: number; align: Align[]; cols: number[] }[] = [];
  const walk = (node: Node): void => {
    const parent = node as Parent;
    if (node.type === "table" && node.position) {
      const cols: number[] = [];
      for (const row of (node as unknown as { children: Node[] }).children) {
        cols.push((row as unknown as { children: Node[] }).children.length);
      }
      const from = node.position.start.offset;
      const to = node.position.end.offset;
      // mdast 的 `offset` 是可选的（unist 的类型如此），但 micromark 一定会给
      if (from === undefined || to === undefined) return;
      out.push({
        from,
        to,
        align: (node as unknown as { align: Align[] }).align,
        cols,
      });
      return;
    }
    if (Array.isArray(parent.children)) for (const c of parent.children) walk(c);
  };
  walk(parseMarkdown(source) as unknown as Node);
  return out;
}

beforeAll(async () => {
  await ensureHtmlRenderer();
});

describe("对拍：行扫描 ≡ remark-gfm", () => {
  const cases: [string, string][] = [
    ["标准表格", "| 名称 | 说明 |\n| --- | --- |\n| 甲 | 乙 |"],
    ["省略首尾竖线", "名称 | 说明\n--- | ---\n甲 | 乙"],
    ["省略尾部竖线", "| 名称 | 说明\n| --- | --- |\n甲 | 乙"],
    ["对齐标记", "| a | b | c | d |\n| :-- | :-: | --: | --- |\n| 1 | 2 | 3 | 4 |"],
    ["分隔行列数不符（不是表格）", "| a | b |\n| --- |\n| 1 | 2 |"],
    ["没有分隔行", "| a | b |\n| 1 | 2 |"],
    ["分隔行不合法", "| a | b |\n| -- | xx |\n| 1 | 2 |"],
    ["只有一个破折号", "| a | b |\n| - | - |\n| 1 | 2 |"],
    ["数据行少一列", "| a | b | c |\n| --- | --- | --- |\n| 1 | 2 |"],
    ["数据行多一列", "| a | b |\n| --- | --- |\n| 1 | 2 | 3 |"],
    ["转义竖线", "| a | b |\n| --- | --- |\n| x \\| y | z |"],
    ["空单元格", "| a | b |\n| --- | --- |\n|  | z |"],
    ["表格前后有段落", "前文\n\n| a |\n| --- |\n| 1 |\n\n后文"],
    ["表格后紧跟普通文本（GFM 会吸收成行）", "| a |\n| --- |\n| 1 |\n普通文本"],
    ["表格后紧跟标题（中断）", "| a |\n| --- |\n| 1 |\n# 标题"],
    ["表格后紧跟列表（中断）", "| a |\n| --- |\n| 1 |\n- 项目"],
    ["表格后紧跟引用（中断）", "| a |\n| --- |\n| 1 |\n> 引用"],
    ["表格后紧跟围栏代码（中断）", "| a |\n| --- |\n| 1 |\n```\nx\n```"],
    ["表格后接带竖线的行", "| a |\n| --- |\n| 1 |\nx | y"],
    ["连续两张表", "| a |\n| --- |\n| 1 |\n\n| b |\n| --- |\n| 2 |"],
    ["表格在列表里", "- 项目\n\n  | a |\n  | --- |\n  | 1 |"],
    ["表格在引用里", "> | a |\n> | --- |\n> | 1 |"],
    ["单元格里有行内标记", "| a | b |\n| --- | --- |\n| **粗** | `代码` |"],
    ["单元格里有链接", "| a |\n| --- |\n| [文字](http://x) |"],
    ["只有表头没有数据行", "| a | b |\n| --- | --- |"],
    ["分隔行用空格", "| a | b |\n| - - | - - |\n| 1 | 2 |"],
  ];

  it.each(cases)("%s", (_name, source) => {
    const actual = findTables(parseSyntax(source), source).map((t) => ({
      from: t.from,
      to: t.to,
      align: t.align,
      cols: t.rows.map((r) => r.length),
    }));
    expect(actual).toEqual(remarkTables(source));
  });
});

describe("分隔行解析", () => {
  it("识别四种对齐", () => {
    expect(parseDelimiterRow("| --- | :--- | ---: | :---: |")).toEqual([
      null,
      "left",
      "right",
      "center",
    ]);
  });

  it("不合法时返回 null", () => {
    expect(parseDelimiterRow("| xx | --- |")).toBeNull();
    expect(parseDelimiterRow("|  | --- |")).toBeNull();
    expect(parseDelimiterRow("普通文本")).toBeNull();
  });
});

describe("渲染", () => {
  it("产出 thead + tbody，并按分隔行设置对齐", () => {
    clearBlockRenderers();
    registerBlockRenderer(tableRenderer);
    const source = "| a | b | c |\n| :-- | :-: | --: |\n| 1 | 2 | 3 |";
    const table = findTables(parseSyntax(source), source)[0];
    const result = tableRenderer.render(table as never, source);
    expect(result).not.toBeNull();
    const html = result!.dom.innerHTML;
    expect(html).toContain("<thead>");
    expect(html).toContain("<tbody>");
    expect(html).toContain("text-align: left");
    expect(html).toContain("text-align: center");
    expect(html).toContain("text-align: right");
  });

  it("单元格内的行内 Markdown 被渲染（与导出同一套语义）", () => {
    const source = "| a |\n| --- |\n| **粗** 和 `码` |";
    const table = findTables(parseSyntax(source), source)[0];
    const result = tableRenderer.render(table as never, source);
    expect(result!.dom.innerHTML).toContain("<strong>粗</strong>");
    expect(result!.dom.innerHTML).toContain("<code>码</code>");
  });

  it("列数不足时补空单元格", () => {
    const source = "| a | b |\n| --- | --- |\n| 只有一列 |";
    const table = findTables(parseSyntax(source), source)[0];
    const result = tableRenderer.render(table as never, source);
    expect(result!.dom.querySelectorAll("tbody tr td")).toHaveLength(2);
  });
});

describe("与其它渲染器的区间互斥", () => {
  it("代码块里的表格不是表格", () => {
    const source = "```\n| a |\n| --- |\n| 1 |\n```";
    expect(findTables(parseSyntax(source), source)).toEqual([]);
  });

  it("公式块里的表格语法要让开（$$ 块在语义上不是表格）", () => {
    const source = "$$\n| a |\n| --- |\n$$\n";
    // lezer 不认数学，所以这不是 lezer 的禁区；
    // 必须靠 blockRanges（块级渲染器已占用的区间）让开
    const tree = parseSyntax(source);
    const blockRanges = findMathBlocks(tree, source).map(({ from, to }) => ({
      from,
      to,
    }));
    expect(findTables(tree, source, { blockRanges })).toEqual([]);
    // 不给 blockRanges 时它确实会被误判——这就是该参数存在的理由
    expect(findTables(tree, source).length).toBeGreaterThan(0);
  });

  it("代码块渲染器与表格渲染器同时注册时不抛异常", () => {
    clearBlockRenderers();
    registerBlockRenderer(codeBlockRenderer);
    registerBlockRenderer(mathBlockRenderer);
    registerBlockRenderer(tableRenderer);
    expect(() =>
      findTables(parseSyntax("| a |\n| --- |\n| 1 |"), "| a |\n| --- |\n| 1 |"),
    ).not.toThrow();
  });
});

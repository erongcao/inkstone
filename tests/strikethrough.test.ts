/**
 * 删除线的定界符：只认 `~~`，不认单 `~`。
 *
 * 这是一条**修出来的 bug**的回归测试。
 *
 * 原来 remark 侧用的是 GFM 的默认 `singleTilde: true`
 * （github.com 认单波浪号，但 GFM 规范本身不允许），
 * 而编辑视图的 lezer 那侧只认成对的 `~~`。
 * 于是同一段文字两层给出不同结论，后果有两个：
 *
 *   - 「下标」命令插的 `~下标~`，编辑器里是字面文本，
 *     **导出却变成删除线**（`<del>下标</del>`）
 *   - 化学式 `H~2~O` 导出后变成 `H<del>2</del>O`
 *
 * 而且 Typora 的 `~x~` 是**下标**不是删除线——
 * 把单波浪号当删除线本身就与 Typora 不兼容。
 */

import { describe, expect, it } from "vitest";
import type { Node, Parent } from "mdast";
import { parseMarkdown } from "@/parser/markdown";
import { markdownToHtml } from "@/parser/html";

/** 取段落里直接子节点的类型 */
function childTypes(source: string): string[] {
  const tree = parseMarkdown(source) as unknown as Node;
  const paragraph = tree.children[0] as Parent;
  if (!Array.isArray(paragraph.children)) return [];
  return paragraph.children.map((c) => c.type);
}

describe("删除线：只认成对的 ~~", () => {
  it("`~~删除~~` 是删除线", () => {
    expect(childTypes("~~删除~~")).toEqual(["delete"]);
  });

  it("`~单波浪~` 不是删除线（是普通文本）", () => {
    expect(childTypes("~单波浪~")).toEqual(["text"]);
  });

  it("`~x~` 不被当成删除线，导出也不会出现 <del>", () => {
    expect(markdownToHtml("~单波浪~")).not.toContain("<del>");
    expect(markdownToHtml("~单波浪~")).toContain("~单波浪~");
  });

  it("`~~x~~` 导出仍是 <del>", () => {
    expect(markdownToHtml("~~双波浪~~")).toContain("<del>双波浪</del>");
  });

  it("化学式 H~2~O 不会被吃掉波浪号", () => {
    const html = markdownToHtml("H~2~O 是水。");
    expect(html).not.toContain("<del>");
    expect(html).toContain("H~2~O");
  });
});

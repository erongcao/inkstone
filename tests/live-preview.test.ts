/**
 * Live Preview 装饰器单测。
 *
 * 这些用例是 M1 选型的护栏：Typora 式体验的核心契约就是
 *   「光标不在结构内 → 标记被替换隐藏」
 *   「光标进入结构 → 标记重新可见可编辑」
 * 一旦装饰器逻辑回归，CI 会立刻报警。
 *
 * 注意：这里断言的是**装饰器的存在与区间**，而不是屏幕像素——
 * 像素级验证留给浏览器端的手工/截图测试。
 */

import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { buildLivePreviewDecorations } from "@/editor/live-preview/decorations";

interface Deco {
  from: number;
  to: number;
  kind: "replace" | "mark";
  cls?: string;
}

/** 把装饰器集合摊平成可断言的数组 */
function collect(doc: string, cursor: number): Deco[] {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
  });
  const set = buildLivePreviewDecorations(state);
  const out: Deco[] = [];
  // 注意：`RangeSet.iter()` 返回的是 RangeCursor，它**不是可迭代对象**，
  // 必须手动 next() 推进，value 为 null 表示遍历结束。
  const it = set.iter();
  while (it.value !== null) {
    // 注意两点：
    //   1. 装饰器的 spec 是**扁平**结构 —— `Decoration.mark({class})` 的 spec
    //      就是 `{class}`，不存在 `spec.mark.class` 这种嵌套。
    //   2. `Decoration.replace({widget})` 的 spec 里**没有** `replace` 键，
    //      它靠 `widget` 字段来区分；所以判别方式是看 `spec.widget`。
    const spec = it.value.spec as {
      widget?: unknown;
      class?: string;
    };
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

/** 只取「隐藏标记」的替换装饰区间 */
function hiddenRanges(doc: string, cursor: number): [number, number][] {
  return collect(doc, cursor)
    .filter((d) => d.kind === "replace")
    .map((d) => [d.from, d.to] as [number, number]);
}

/** 只取带指定 class 的标记装饰 */
function marksWithClass(doc: string, cursor: number, cls: string): Deco[] {
  return collect(doc, cursor).filter((d) => d.kind === "mark" && d.cls?.includes(cls));
}

describe("Live Preview 装饰器", () => {
  it("光标在结构外时隐藏加粗标记", () => {
    // 光标放在「后」字上，确实在加粗结构之外
    const doc = "**粗体** 后";
    expect(hiddenRanges(doc, doc.length)).toEqual([
      [0, 2],
      [4, 6],
    ]);
  });

  it("光标进入加粗结构后标记重新可见", () => {
    const doc = "**粗体**";
    // 光标落在「粗」字上
    expect(hiddenRanges(doc, 3)).toEqual([]);
  });

  it("光标紧贴开始标记之前时不展开（左开）", () => {
    const doc = "**粗体**";
    // 位置 0 恰在结构起点之前 → 结构保持折叠
    expect(hiddenRanges(doc, 0)).toEqual([
      [0, 2],
      [4, 6],
    ]);
  });

  it("光标紧跟结束标记之后时展开（右闭，与 Typora 一致）", () => {
    const doc = "**粗体**";
    // 位置 6 恰在结构终点 → 视为仍在结构内
    expect(hiddenRanges(doc, 6)).toEqual([]);
  });

  it("加粗正文被加上样式 class", () => {
    const doc = "**粗体** 后";
    const marks = marksWithClass(doc, doc.length, "cm-md-strong");
    expect(marks.length).toBe(1);
    expect(marks[0].from).toBe(2);
    expect(marks[0].to).toBe(4);
  });

  it("隐藏链接的括号与网址，只保留文字", () => {
    //     0         1   2         3
    //     0123456789012345678901234
    const doc = '[文字](https://a.com "标题") 后';
    const hidden = hiddenRanges(doc, doc.length);
    // `[`、`]`、`(`、`)`、URL、标题全部隐藏
    expect(hidden).toContainEqual([0, 1]);
    expect(hidden).toContainEqual([3, 4]);
    expect(hidden).toContainEqual([4, 5]);
    expect(hidden).toContainEqual([5, 18]);
    expect(hidden).toContainEqual([19, 23]);
    expect(hidden).toContainEqual([23, 24]);
  });

  it("隐藏行内代码的反引号", () => {
    const doc = "`code` 后";
    expect(hiddenRanges(doc, doc.length)).toEqual([
      [0, 1],
      [5, 6],
    ]);
  });

  it("隐藏斜体标记", () => {
    const doc = "*斜体* 后";
    expect(hiddenRanges(doc, doc.length)).toEqual([
      [0, 1],
      [3, 4],
    ]);
  });

  it("隐藏删除线标记", () => {
    const doc = "~~删掉~~ 后";
    expect(hiddenRanges(doc, doc.length)).toEqual([
      [0, 2],
      [4, 6],
    ]);
  });

  it("光标进入删除线结构后标记重新可见", () => {
    const doc = "~~删掉~~";
    expect(hiddenRanges(doc, 3)).toEqual([]);
  });

  it("块级标记（标题 #）只是弱化，不隐藏", () => {
    const doc = "# 标题";
    expect(hiddenRanges(doc, doc.length)).toEqual([]);
    expect(marksWithClass(doc, doc.length, "cm-md-header-mark").length).toBe(1);
  });

  it("光标进入标题所在块时块级标记切换为 active 态", () => {
    const doc = "# 标题";
    expect(marksWithClass(doc, 3, "cm-md-block-mark--active").length).toBe(1);
  });

  it("光标不在标题内时块级标记不是 active 态", () => {
    const doc = "# 标题\n\n正文";
    expect(marksWithClass(doc, 6, "cm-md-block-mark--active").length).toBe(0);
  });

  it("普通文本不产生任何装饰器", () => {
    expect(collect("就是一段普通文字", 3)).toEqual([]);
  });
});

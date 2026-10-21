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
import { EditorView } from "@codemirror/view";
import { history, undo, redo } from "@codemirror/commands";
import { buildLivePreviewDecorations } from "@/editor/live-preview/decorations";
import { parseSyntax } from "@/editor/live-preview/syntax";
import { livePreviewField } from "@/editor/live-preview/state";
import { livePreview, setDisplayModeOf } from "@/editor/live-preview";
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

describe("标记符显示策略", () => {
  /** 取指定模式下的替换装饰（隐藏标记）区间 */
  function replaced(doc: string, cursor: number, mode: MarkerDisplayMode): [number, number][] {
    return collect(doc, cursor, mode)
      .filter((d) => d.kind === "replace")
      .map((d) => [d.from, d.to] as [number, number]);
  }

  it("弱化模式下标记不隐藏，只加弱化 class", () => {
    const doc = "**粗体** 后";
    // 没有任何替换装饰 → 标记始终可见
    expect(replaced(doc, doc.length, "dimmed")).toEqual([]);
    // 但标记区间被标记上了 cm-md-marker
    const dimmed = collect(doc, doc.length, "dimmed").filter(
      (d) => d.cls === "cm-md-marker",
    );
    expect(dimmed).toHaveLength(2);
    expect(dimmed[0].from).toBe(0);
    expect(dimmed[0].to).toBe(2);
  });

  it("弱化模式下正文照样渲染（加粗样式保留）", () => {
    const doc = "**粗体** 后";
    expect(marksWithClass(doc, doc.length, "cm-md-strong").length).toBe(1);
  });

  it("弱化模式下光标位置不影响标记显隐", () => {
    const doc = "**粗体**";
    // 光标在结构内
    expect(collect(doc, 3, "dimmed").filter((d) => d.cls === "cm-md-marker")).toHaveLength(2);
    // 光标在结构外
    expect(collect(doc, 0, "dimmed").filter((d) => d.cls === "cm-md-marker")).toHaveLength(2);
  });

  it("弱化模式同样处理链接的括号与网址", () => {
    const doc = "[文字](https://a.com) 后";
    const dimmed = collect(doc, doc.length, "dimmed").filter((d) => d.cls === "cm-md-marker");
    // `[`、`]`、`(`、`)`、URL —— 5 段
    expect(dimmed).toHaveLength(5);
    expect(replaced(doc, doc.length, "dimmed")).toEqual([]);
  });

  it("实时预览模式仍然隐藏标记（回归保护）", () => {
    const doc = "**粗体** 后";
    expect(replaced(doc, doc.length, "live")).toEqual([
      [0, 2],
      [4, 6],
    ]);
  });
});

describe("Live Preview 与撤销栈", () => {
  /** 建一个带 Live Preview 的编辑器 */
  function createEditor(doc: string, cursor: number) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = new EditorView({
      state: EditorState.create({
        doc,
        selection: { anchor: cursor },
        extensions: [history(), livePreview()],
      }),
      parent: host,
    });
    return { view, dispose: () => {
      view.destroy();
      host.remove();
    } };
  }

  /** 当前状态下被隐藏的标记区间 */
  function hiddenRanges(view: EditorView): [number, number][] {
    const lp = view.state.field(livePreviewField);
    const set = buildLivePreviewDecorations(lp.source, lp.cursor, "live", lp.tree);
    const out: [number, number][] = [];
    const cursor = set.iter();
    while (cursor.value !== null) {
      if (cursor.value.spec.widget) out.push([cursor.from, cursor.to]);
      cursor.next();
    }
    return out;
  }

  it("撤销后装饰器按撤销后的状态重算", () => {
    const { view, dispose } = createEditor("**粗体** 后", 8);
    // 光标在结构外 → 标记隐藏
    expect(hiddenRanges(view)).toEqual([
      [0, 2],
      [4, 6],
    ]);

    // 删掉整个加粗结构 → 不再有标记可隐藏
    view.dispatch({ changes: { from: 0, to: 6, insert: "" }, userEvent: "delete.backward" });
    expect(view.state.doc.toString()).toBe(" 后");
    expect(hiddenRanges(view)).toEqual([]);

    // 撤销 → 文档回来了，装饰器也要跟着回来
    undo(view);
    expect(view.state.doc.toString()).toBe("**粗体** 后");
    view.dispatch({ selection: { anchor: 8 } });
    expect(hiddenRanges(view)).toEqual([
      [0, 2],
      [4, 6],
    ]);

    dispose();
  });

  it("撤销 / 重做能完整还原文档", () => {
    const { view, dispose } = createEditor("", 0);
    view.dispatch({
      changes: { from: 0, to: 0, insert: "**粗体**" },
      userEvent: "input.type",
    });
    expect(view.state.doc.toString()).toBe("**粗体**");

    undo(view);
    expect(view.state.doc.toString()).toBe("");

    redo(view);
    expect(view.state.doc.toString()).toBe("**粗体**");

    dispose();
  });

  it("切换显示模式不影响撤销栈", () => {
    const { view, dispose } = createEditor("**粗体**", 6);
    view.dispatch({
      changes: { from: 6, to: 6, insert: "尾巴" },
      userEvent: "input.type",
    });

    // 切到源码模式（只派发 effect，不改文档）
    setDisplayModeOf(view, "source");
    expect(view.state.doc.toString()).toBe("**粗体**尾巴");

    // 撤销仍然只回退文档修改，不受模式切换影响
    undo(view);
    expect(view.state.doc.toString()).toBe("**粗体**");

    dispose();
  });
});

describe("Live Preview：嵌套标记", () => {
  //     0         1   2         3   4         5
  //     0123456789012345678901234567890123456789
  //     **粗体里的 `代码`** 尾巴
  //     [0,2) 外层 **   [7,8) 内层反引号   [10,11) 内层反引号   [11,13) 外层 **
  const NESTED = "**粗体里的 `代码`** 尾巴";

  it("光标在结构外：两层标记都隐藏，内容照样渲染", () => {
    const hidden = collect(NESTED, NESTED.length)
      .filter((d) => d.kind === "replace")
      .map((d) => [d.from, d.to]);
    // 外层 ** 与内层反引号全部收起
    expect(hidden).toEqual([
      [0, 2],
      [7, 8],
      [10, 11],
      [11, 13],
    ]);
    // 两层内容都有样式
    const marks = collect(NESTED, NESTED.length);
    expect(marks.filter((d) => d.cls === "cm-md-strong")).toHaveLength(1);
    expect(marks.filter((d) => d.cls === "cm-md-inline-code")).toHaveLength(1);
  });

  it("光标在外层正文里：外层标记显露，内层仍保持渲染态", () => {
    // 光标落在「里」字上
    const hidden = collect(NESTED, 4)
      .filter((d) => d.kind === "replace")
      .map((d) => [d.from, d.to]);
    // 只有内层的反引号被收起
    expect(hidden).toEqual([
      [7, 8],
      [10, 11],
    ]);
  });

  it("光标进入内层代码：内层标记也显露", () => {
    // 光标落在「代」字上（行内代码内部）
    const hidden = collect(NESTED, 9)
      .filter((d) => d.kind === "replace")
      .map((d) => [d.from, d.to]);
    // 两层标记都不再隐藏
    expect(hidden).toEqual([]);
  });

  it("光标紧跟内层代码之后：内层重新收起，外层仍展开", () => {
    // 位置 12 = 外层闭标记内部（内层之外、外层之内）
    const hidden = collect(NESTED, 12)
      .filter((d) => d.kind === "replace")
      .map((d) => [d.from, d.to]);
    expect(hidden).toEqual([
      [7, 8],
      [10, 11],
    ]);
  });

  it("粗体在链接内：光标在链接文本里时两层标记都显露", () => {
    const doc = "[**文字**](https://a.com)";
    const hidden = collect(doc, 4)
      .filter((d) => d.kind === "replace")
      .map((d) => [d.from, d.to]);
    expect(hidden).toEqual([]);
  });

  it("粗体在链接内：光标在结构外时全部收起", () => {
    const doc = "[**文字**](https://a.com) 尾巴";
    const hidden = collect(doc, doc.length)
      .filter((d) => d.kind === "replace")
      .map((d) => [d.from, d.to]);
    // [ ] ( ) URL 与 ** 都收起
    expect(hidden).toEqual([
      [0, 1],
      [1, 3],
      [5, 7],
      [7, 8],
      [8, 9],
      [9, 22],
      [22, 23],
    ]);
  });
});

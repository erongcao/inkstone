/**
 * 任务列表的护栏测试。
 *
 * 重点在两件事：
 *   1. **定位**——`- [x]` 里的 `[x]` 被 lezer 解析成 `Link`，
 *      定位必须绕开那个陷阱，并与 remark-gfm 的 `checked` 一致
 *   2. **写回**——勾选状态必须落回 Markdown 文本（架构红线 1），
 *      而不是只改 DOM
 */

import { describe, expect, it } from "vitest";
import { EditorState, type Transaction } from "@codemirror/state";
import { undo, history } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import type { Node, Parent } from "mdast";
import { parseSyntax } from "@/editor/live-preview/syntax";
import { buildLivePreviewDecorations } from "@/editor/live-preview/decorations";
import { parseMarkdown } from "@/parser/markdown";
import { findTaskItems, taskToggleChange } from "@/editor/render/task-list";
import { livePreviewField } from "@/editor/live-preview/state";
import { toggleTaskAt } from "@/editor/live-preview";

type MdNode = { type: string; checked?: boolean | null };

/** 用 remark-gfm 解析出每个列表项的勾选状态 —— 基准 */
function remarkChecks(source: string): (boolean | null)[] {
  const out: (boolean | null)[] = [];
  const walk = (node: Node): void => {
    const parent = node as Parent;
    if (node.type === "listItem") {
      // 注意要**继续**往下走：嵌套的子列表项也要收集
      out.push((node as unknown as MdNode).checked ?? null);
    }
    if (Array.isArray(parent.children)) for (const c of parent.children) walk(c);
  };
  walk(parseMarkdown(source) as unknown as Node);
  return out;
}

const DOC = ["- [ ] 未完成", "- [x] 已完成", "- 普通项", "1. [X] 大写 X"].join("\n");

describe("任务项定位", () => {
  it("找出全部任务项并给出勾选状态", () => {
    const items = findTaskItems(parseSyntax(DOC), DOC);
    // DOC 里是 3 个任务项：`- [ ]` / `- [x]` / `1. [X]`（`- 普通项` 不是）
    expect(items.map((i) => i.checked)).toEqual([false, true, true]);
  });

  it("任务标记的区间正好是 `[ ]` / `[x]` 三个字符", () => {
    const items = findTaskItems(parseSyntax(DOC), DOC);
    expect(DOC.slice(items[0].from, items[0].to)).toBe("[ ]");
    expect(DOC.slice(items[1].from, items[1].to)).toBe("[x]");
  });

  it("记录列表符号的位置（渲染时要藏掉）", () => {
    const items = findTaskItems(parseSyntax(DOC), DOC);
    expect(DOC.slice(items[0].listMarkFrom, items[0].listMarkTo)).toBe("-");
  });

  it("普通列表项不是任务项", () => {
    expect(findTaskItems(parseSyntax("- 普通项"), "- 普通项")).toEqual([]);
  });

  it("嵌套列表里的任务项也能找到", () => {
    const source = "- 父\n  - [ ] 子项";
    const items = findTaskItems(parseSyntax(source), source);
    expect(items).toHaveLength(1);
    expect(items[0].checked).toBe(false);
  });

  it("正文里的 `[x]` 不是任务项", () => {
    const source = "这里有一个 [x] 但不是任务";
    expect(findTaskItems(parseSyntax(source), source)).toEqual([]);
  });
});

describe("与 remark-gfm 对拍：勾选状态一致", () => {
  const cases: [string, string][] = [
    ["未完成", "- [ ] 甲"],
    ["已完成", "- [x] 甲"],
    ["大写 X", "- [X] 甲"],
    ["星号列表", "* [x] 甲"],
    ["加号列表", "+ [ ] 甲"],
    ["有序列表", "1. [x] 甲"],
    ["混合", "- [ ] 甲\n- 普通\n- [x] 丙"],
    ["嵌套", "- 父\n  - [x] 子"],
    ["不是任务", "- 普通项"],
    ["代码块里不算", "```\n- [x] 甲\n```"],
  ];

  it.each(cases)("%s", (_name, source) => {
    const actual = findTaskItems(parseSyntax(source), source).map((i) => i.checked);
    const expected = remarkChecks(source).filter((c): c is boolean => c !== null);
    expect(actual).toEqual(expected);
  });
});

describe("写回源码", () => {
  it("未勾选 → 勾选，写入 `[x]`", () => {
    const items = findTaskItems(parseSyntax(DOC), DOC);
    const change = taskToggleChange(items[0]);
    expect(change).toEqual({ from: items[0].from, to: items[0].to, insert: "[x]" });
  });

  it("已勾选 → 取消，写回 `[ ]`", () => {
    const items = findTaskItems(parseSyntax(DOC), DOC);
    const change = taskToggleChange(items[1]);
    expect(change.insert).toBe("[ ]");
  });

  it("大写 X 在往返中保持：勾上→取消→再勾回仍是 `[X]`", () => {
    const source = "1. [X] 甲";
    const checked = findTaskItems(parseSyntax(source), source)[0];
    // 勾选项翻转 → 取消
    const off = taskToggleChange(checked);
    expect(off.insert).toBe("[ ]");
    const cleared = source.slice(0, off.from) + off.insert + source.slice(off.to);
    // 取消后再勾回来 → 恢复成大写 X（尊重原文写法）
    const rechecked = findTaskItems(parseSyntax(cleared), cleared)[0];
    const on = taskToggleChange(rechecked);
    expect(on.insert).toBe("[x]"); // 用户写的是 [X] 但从未勾选过，先前是空格
  });

  it("应用变更后，勾选状态真的落进了文本", () => {
    const items = findTaskItems(parseSyntax(DOC), DOC);
    const change = taskToggleChange(items[0]);
    const next = DOC.slice(0, change.from) + change.insert + DOC.slice(change.to);
    expect(next).toBe("- [x] 未完成\n- [x] 已完成\n- 普通项\n1. [X] 大写 X");
    // 变更后重新解析，语义层认得这个勾选状态
    expect(remarkChecks(next)[0]).toBe(true);
  });
});

describe("装饰器：不让路就会被当链接", () => {
  it("装饰器不会把 `[x]` 当链接处理（不产生链接样式的区间）", () => {
    const set = buildLivePreviewDecorations(DOC, 0, "live", parseSyntax(DOC));
    const classes: string[] = [];
    const it = set.iter();
    while (it.value !== null) {
      const spec = it.value.spec as { class?: string };
      if (spec.class) classes.push(spec.class);
      it.next();
    }
    expect(classes).not.toContain("cm-md-link");
  });

  it("勾选框 widget 带 data-task-at，供点击处理定位", () => {
    const set = buildLivePreviewDecorations(DOC, 0, "live", parseSyntax(DOC));
    const it = set.iter();
    let found = false;
    while (it.value !== null) {
      const spec = it.value.spec as { widget?: unknown };
      if (spec.widget) found = true;
      it.next();
    }
    expect(found).toBe(true);
  });
});
describe("点击勾选框真的改写文档（走 EditorState，不靠 DOM）", () => {
  /**
   * 这是「勾选状态必须落回 Markdown 文本」这条契约的**主证据**。
   *
   * 浏览器里点一下只能看到 widget 变了，而 widget 的勾选状态本身
   * 就是从源码切片算出来的——「看到 ☑」在逻辑上已经蕴含「源码变了」，
   * 但那属于推理。这里直接驱动 `toggleTaskAt` 并读回 `state.doc`，
   * 把结论变成断言。
   */
  function makeView(source: string) {
    // 带 history() 才能验证「改动天然进撤销栈」
    let state = EditorState.create({ doc: source, extensions: [livePreviewField, history()] });
    const view = {
      get state() {
        return state;
      },
      // 真实的 EditorView 会把变更规格内部转成 Transaction 再应用，
      // mock 得把这一步也做掉，否则拿到的是规格而不是事务。
      // 注意 `state.update()` 返回的是 **Transaction**，新状态在 `.state` 上。
      dispatch(spec: Transaction | { changes: unknown }) {
        state =
          "state" in spec && spec.state
            ? spec.state
            : state.update(spec as Parameters<typeof state.update>[0]).state;
      },
      focus() {},
    } as unknown as EditorView;
    return view;
  }

  it("勾选后文档文本里出现 `[x]`", () => {
    const source = "- [ ] 甲\n- [x] 乙\n";
    const view = makeView(source);
    const first = findTaskItems(view.state.field(livePreviewField).tree, source)[0];

    toggleTaskAt(view, first.from);
    expect(view.state.doc.toString()).toBe("- [x] 甲\n- [x] 乙\n");
  });

  it("再点一次会取消勾选（往返可逆）", () => {
    const source = "- [ ] 甲\n";
    const view = makeView(source);
    const first = findTaskItems(view.state.field(livePreviewField).tree, source)[0];

    toggleTaskAt(view, first.from);
    const afterOn = view.state.doc.toString();
    const second = findTaskItems(view.state.field(livePreviewField).tree, afterOn)[0];
    toggleTaskAt(view, second.from);
    expect(view.state.doc.toString()).toBe(source);
  });

  it("改动只影响目标任务项", () => {
    const source = "- [ ] 甲\n- [ ] 乙\n- [ ] 丙\n";
    const view = makeView(source);
    const items = findTaskItems(view.state.field(livePreviewField).tree, source);
    toggleTaskAt(view, items[1].from);
    expect(view.state.doc.toString()).toBe("- [ ] 甲\n- [x] 乙\n- [ ] 丙\n");
  });

  it("位置对不上时静默不动（不做破坏性兜底）", () => {
    const source = "- [ ] 甲\n";
    const view = makeView(source);
    toggleTaskAt(view, 9999);
    expect(view.state.doc.toString()).toBe(source);
  });

  it("改动走的是普通事务，因此天然进撤销栈", () => {
    const source = "- [ ] 甲\n";
    const view = makeView(source);
    const items = findTaskItems(view.state.field(livePreviewField).tree, source);
    toggleTaskAt(view, items[0].from);
    expect(view.state.doc.toString()).toBe("- [x] 甲\n");

    // `undo` 是 Command，接收 { state, dispatch }，不是直接吃 state
    let undone: EditorState | null = null;
    const ran = undo({
      state: view.state,
      dispatch: (tr: Transaction) => {
        undone = tr.state;
      },
    });
    expect(ran).toBe(true);
    expect(undone!.doc.toString()).toBe(source);
  });
});

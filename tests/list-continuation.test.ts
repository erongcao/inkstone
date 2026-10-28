/**
 * 列表续行与自动编号的护栏测试。
 *
 * 这类功能的特点是**看起来对但边界容易错**，所以重点覆盖：
 *   - 有序列表的序号推进（含 `3)` 这种括号式、两位数、起始不是 1）
 *   - 缩进原样带过去（嵌套不打平）
 *   - 任务列表续出**未勾选**的
 *   - 空列表项回车要**退出列表**而不是留空壳
 *   - 光标在行中间时回车**不该**续列表
 */

import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { gfmMarkdownLanguage } from "@/editor/markdown-language";
import {
  continuationText,
  continueListOnEnter,
  indentListItem,
  listContextAt,
  outdentListItem,
} from "@/editor/list-continuation";

/**
 * 起一个真实 EditorView。
 *
 * jsdom 没有 layout，CM6 的视口计算会崩——
 * 所以这里只做最小配置，并且**每次用完都 destroy**，
 * 否则未销毁的视图会在 rAF 里报 `getClientRects is not a function`。
 */
function withView<T>(doc: string, cursor: number, run: (view: EditorView) => T): T {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(cursor),
      // 必须和编辑器用**同一个** Language（含 GFM）。
      // 用裸 parser 的话 Task / TaskMarker 节点根本不存在，
      // 任务列表的续行与退出就会全部失效。
      extensions: [markdown({ base: gfmMarkdownLanguage })],
    }),
    parent: host,
  });
  try {
    return run(view);
  } finally {
    view.destroy();
    host.remove();
  }
}

/** 在光标处模拟按 Enter，返回新文档 */
function pressEnter(doc: string, cursor: number): string | null {
  return withView(doc, cursor, (view) => {
    const handled = continueListOnEnter(view);
    if (!handled) return null;
    return view.state.doc.toString();
  });
}

/** 在光标处模拟按 Tab */
function pressTab(doc: string, cursor: number): string | null {
  return withView(doc, cursor, (view) =>
    indentListItem(view) ? view.state.doc.toString() : null,
  );
}

/** 在光标处模拟按 Shift-Tab */
function pressShiftTab(doc: string, cursor: number): string | null {
  return withView(doc, cursor, (view) =>
    outdentListItem(view) ? view.state.doc.toString() : null,
  );
}

describe("列表上下文识别", () => {
  it("识别无序列表的符号与缩进", () => {
    withView("- 第一项", "- 第一项".length, (view) => {
      const ctx = listContextAt(view.state, "- 第一项".length);
      expect(ctx.outside).toBe(false);
      expect(ctx.mark).toBe("-");
      expect(ctx.number).toBeNull();
      expect(ctx.indent).toBe("");
    });
  });

  it("识别有序列表的序号与闭定界符", () => {
    withView("1. 第一项", 6, (view) => {
      const ctx = listContextAt(view.state, "1. 第一项".length);
      expect(ctx.number).toBe(1);
      expect(ctx.delimiter).toBe(".");
    });
  });

  it("括号式有序列表保留 `)`", () => {
    withView("3) 第三项", 6, (view) => {
      const ctx = listContextAt(view.state, "3) 第三项".length);
      expect(ctx.number).toBe(3);
      expect(ctx.delimiter).toBe(")");
      expect(continuationText(ctx)).toBe("4) ");
    });
  });

  it("拿到嵌套项的缩进", () => {
    withView("1. 一\n   - 嵌套", "1. 一\n   - 嵌套".length, (view) => {
      const ctx = listContextAt(view.state, "1. 一\n   - 嵌套".length);
      expect(ctx.mark).toBe("-");
      expect(ctx.indent).toBe("   ");
    });
  });

  it("识别任务项并读到勾选状态", () => {
    withView("- [x] 已完成", "- [x] 已完成".length, (view) => {
      const ctx = listContextAt(view.state, "- [x] 已完成".length);
      expect(ctx.taskFrom).not.toBeNull();
      expect(ctx.taskChecked).toBe(true);
    });
  });

  it("不在列表里时返回 outside", () => {
    withView("普通段落", 3, (view) => {
      expect(listContextAt(view.state, "普通段落".length).outside).toBe(true);
    });
  });
});

describe("回车续行：无序列表", () => {
  it("续出同样的符号", () => {
    expect(pressEnter("- 第一项", "- 第一项".length)).toBe("- 第一项\n- ");
  });

  it("星号和加号各自保持", () => {
    expect(pressEnter("* 第一项", "* 第一项".length)).toBe("* 第一项\n* ");
    expect(pressEnter("+ 第一项", "+ 第一项".length)).toBe("+ 第一项\n+ ");
  });

  it("缩进原样带过去（嵌套不打平）", () => {
    expect(pressEnter("1. 一\n   - 嵌套项", "1. 一\n   - 嵌套项".length)).toBe(
      "1. 一\n   - 嵌套项\n   - ",
    );
  });
});

describe("回车续行：有序列表自动编号", () => {
  it("序号 +1", () => {
    expect(pressEnter("1. 第一项", 6)).toBe("1. 第一项\n2. ");
  });

  it("从 3 开始也正确推进", () => {
    expect(pressEnter("3. 第三项", 6)).toBe("3. 第三项\n4. ");
  });

  it("两位数序号", () => {
    expect(pressEnter("10. 第十项", 7)).toBe("10. 第十项\n11. ");
  });

  it("括号式保留 `)`", () => {
    expect(pressEnter("3) 第三项", 6)).toBe("3) 第三项\n4) ");
  });

  it("不是从 1 开始也不会算错", () => {
    expect(pressEnter("7. 第七项", 6)).toBe("7. 第七项\n8. ");
  });
});

describe("回车续行：任务列表", () => {
  it("未勾选的续出未勾选的", () => {
    expect(pressEnter("- [ ] 待办", "- [ ] 待办".length)).toBe("- [ ] 待办\n- [ ] ");
  });

  it("**已勾选的续出未勾选的**——勾选状态不传染", () => {
    expect(pressEnter("- [x] 已完成", "- [x] 已完成".length)).toBe(
      "- [x] 已完成\n- [ ] ",
    );
  });

  it("有序任务列表同样不传染", () => {
    expect(pressEnter("1. [x] 已完成", "1. [x] 已完成".length)).toBe(
      "1. [x] 已完成\n2. [ ] ",
    );
  });
});

describe("回车：空列表项退出列表", () => {
  it("只有符号没有内容 → 删掉符号退出", () => {
    expect(pressEnter("- ", 2)).toBe("");
  });

  it("有序列表同理", () => {
    expect(pressEnter("1. ", 3)).toBe("");
  });

  it("空任务项也退出", () => {
    expect(pressEnter("- [ ] ", 6)).toBe("");
  });

  it("空项在列表中间也一样退出", () => {
    expect(pressEnter("- 第一项\n- ", "- 第一项\n- ".length)).toBe("- 第一项\n");
  });

  it("有内容的项不会被当成空项", () => {
    // 这里首项有内容，续行；不是退出
    expect(pressEnter("- 第一项", "- 第一项".length)).toBe("- 第一项\n- ");
  });
});

describe("回车：不该续行的情形", () => {
  it("光标在行中间 → 只换行，不续列表", () => {
    // 光标在「第一项」的中间
    expect(pressEnter("- 第一项", 4)).toBeNull();
  });

  it("普通段落回车 → 不接管", () => {
    expect(pressEnter("普通段落", 4)).toBeNull();
  });

  it("行尾有空白时也按「在末尾」处理", () => {
    // 「- 第一项  」，光标在文字后、空白前
    expect(pressEnter("- 第一项  ", "- 第一项".length)).toBe("- 第一项\n- ");
  });
});

describe("Tab / Shift-Tab", () => {
  it("Tab 给列表项加两格缩进", () => {
    expect(pressTab("- 第一项", "- 第一项".length)).toBe("  - 第一项");
  });

  it("Tab 可以叠加", () => {
    expect(pressTab("  - 第一项", "  - 第一项".length)).toBe("    - 第一项");
  });

  it("Shift-Tab 去掉两格", () => {
    expect(pressShiftTab("  - 第一项", "  - 第一项".length)).toBe("- 第一项");
  });

  it("Shift-Tab 在缩进不是 2 的倍数时也不留 1 空格（层级会变含糊）", () => {
    // 3 空格一次退到 0，而不是退到 1
    // （1 空格既不是顶层、也不够构成嵌套，层级会变含糊）
    // 注意：4 个空格起在 CommonMark 里已经是缩进代码块，不属于列表
    expect(pressShiftTab("   - 第一项", "   - 第一项".length)).toBe("- 第一项");
  });

  it("顶层列表项上 Shift-Tab 不处理（反缩进会变成新的顶层列表）", () => {
    expect(pressShiftTab("- 第一项", "- 第一项".length)).toBeNull();
  });

  it("4 个空格起是**缩进代码块**而不是列表项，两个键都不该碰它", () => {
    // CommonMark：4 空格缩进 = 缩进代码块。把它当列表项去缩进会破坏代码块语义。
    expect(pressTab("    不是列表", "    不是列表".length)).toBeNull();
    expect(pressShiftTab("    不是列表", "    不是列表".length)).toBeNull();
  });

  it("不在列表里时两个键都不处理", () => {
    expect(pressTab("普通段落", "普通段落".length)).toBeNull();
    expect(pressShiftTab("普通段落", "普通段落".length)).toBeNull();
  });

  it("缩进后光标跟着移动，不会跑到行首", () => {
    withView("- 第一项", "- 第一项".length, (view) => {
      const before = view.state.selection.main.head;
      indentListItem(view);
      expect(view.state.selection.main.head).toBe(before + 2);
    });
  });

  it("反缩进后光标同样跟着移动", () => {
    withView("  - 第一项", "  - 第一项".length, (view) => {
      outdentListItem(view);
      expect(view.state.selection.main.head).toBe("- 第一项".length);
    });
  });
});

describe("连续操作", () => {
  it("连按三次回车得到 1./2./3.", () => {
    withView("1. ", "1. ".length, (view) => {
      expect(continueListOnEnter(view)).toBe(true); // 空的 → 退出
      expect(view.state.doc.toString()).toBe("");
    });

    // 换个方式：先写内容再连按
    withView("1. 甲", "1. 甲".length, (view) => {
      continueListOnEnter(view);
      const doc2 = view.state.doc.toString();
      expect(doc2).toBe("1. 甲\n2. ");

      // 模拟「在新项里打字」。
      // 必须显式移动光标：CM6 的 inputHandler 会把光标推到插入文本之后，
      // 而裸 dispatch 默认把锚点映射到插入点**之前**——
      // 那样光标就停在「乙」前面，看起来像「不在项末尾」，续行被正确地拒绝了。
      view.dispatch({
        changes: { from: doc2.length, insert: "乙" },
        selection: { anchor: doc2.length + 1 },
      });
      continueListOnEnter(view);
      expect(view.state.doc.toString()).toBe("1. 甲\n2. 乙\n3. ");
    });
  });

  it("退出列表后回车不再续行", () => {
    withView("- 第一项\n- ", "- 第一项\n- ".length, (view) => {
      continueListOnEnter(view);
      expect(view.state.doc.toString()).toBe("- 第一项\n");
      expect(continueListOnEnter(view)).toBe(false);
    });
  });

  it("语法树在多次编辑后仍然可用（增量解析没坏）", () => {
    withView("1. 甲", "1. 甲".length, (view) => {
      continueListOnEnter(view);
      const at = view.state.selection.main.head;
      view.dispatch({
        changes: { from: at, insert: "乙" },
        selection: { anchor: at + 1 },
      });
      const head = view.state.selection.main.head;
      const ctx = listContextAt(view.state, head);
      expect(ctx.number).toBe(2);
      // syntaxTree 的缓存没有因为直接 dispatch 而失效
      expect(syntaxTree(view.state).resolveInner(head, -1).type.name).toBeTruthy();
    });
  });
});

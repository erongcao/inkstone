/**
 * 自动配对单测。
 *
 * 规则来源与核对过程见 src/editor/auto-pair.ts 的文件头注释：
 * Typora 官方文档 + 官方演示视频逐帧 + Typora Markdown Reference。
 *
 * 测试方式是**直接调用 CM6 的 inputHandler**——和 CM6 内部处理击键走的是同一条路，
 * 但不依赖 jsdom 的 DOM 变更事件（jsdom 那条路不可靠）。
 */

import { describe, expect, it, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import { autoPair } from "@/editor/auto-pair";
import { createMarkdownEditor } from "@/editor/MarkdownEditor";
import type { AutoPairMode } from "@/settings/schema";

/**
 * 模拟敲下一个字符。
 *
 * 走的是 CM6 自己的 inputHandler 分发逻辑：
 * 有扩展接管就由扩展处理，没接管就走默认插入。
 */
function typeInto(view: EditorView, ch: string): void {
  const sel = view.state.selection.main;
  const handled = view.state
    .facet(EditorView.inputHandler)
    .some((h) => h(view, sel.from, sel.to, ch, () => view.state.update({})));
  if (!handled) {
    // 没有被接管 → 走默认插入。
    // 必须显式给 selection：CM6 默认把光标映射到插入内容**之前**
    // （assoc = -1），只有真实输入路径（applyDefaultInsert）才会把光标
    // 推到插入内容之后。这里要模拟的正是真实输入路径。
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: ch },
      selection: { anchor: sel.from + ch.length },
    });
  }
}

interface Fixture {
  view: EditorView;
  type: (ch: string) => void;
  text: () => string;
  cursor: () => number;
  selection: () => { from: number; to: number };
  destroy: () => void;
}

const fixtures: Fixture[] = [];

function createEditor(
  doc: string,
  mode: AutoPairMode = "markdown",
  cursor: number = doc.length,
): Fixture {
  const host = document.createElement("div");
  document.body.appendChild(host);

  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [history(), autoPair(mode)],
    }),
    parent: host,
  });

  const fixture: Fixture = {
    view,
    type: (ch: string) => typeInto(view, ch),
    text: () => view.state.doc.toString(),
    cursor: () => view.state.selection.main.head,
    selection: () => {
      const s = view.state.selection.main;
      return { from: s.from, to: s.to };
    },
    destroy: () => {
      view.destroy();
      host.remove();
    },
  };

  fixtures.push(fixture);
  return fixture;
}

afterEach(() => {
  while (fixtures.length) fixtures.pop()!.destroy();
});

describe("自动配对：basic 级", () => {
  it("输入左括号自动补右括号，光标落在中间", () => {
    const f = createEditor("", "basic");
    f.type("(");
    expect(f.text()).toBe("()");
    expect(f.cursor()).toBe(1);
  });

  it("方括号与花括号同理", () => {
    const f = createEditor("", "basic");
    f.type("[");
    f.type("{");
    // 第二个配对插在第一个配对里面 → 嵌套
    expect(f.text()).toBe("[{}]");
    expect(f.cursor()).toBe(2);
  });

  it("成对引号自动补齐", () => {
    const f = createEditor("", "basic");
    f.type('"');
    expect(f.text()).toBe('""');
    expect(f.cursor()).toBe(1);
  });

  it("光标右侧紧邻自己插入的闭合符时直接越过", () => {
    const f = createEditor("", "basic");
    f.type("(");
    // 再敲一个 ) → 应当跳过而不是再插一个
    f.type(")");
    expect(f.text()).toBe("()");
    expect(f.cursor()).toBe(2);
  });

  it("basic 模式下不配对 Markdown 符号", () => {
    const f = createEditor("", "basic");
    f.type("*");
    f.type("`");
    f.type("$");
    expect(f.text()).toBe("*`$");
  });
});

describe("自动配对：markdown 级", () => {
  it("行内代码用反引号配对", () => {
    const f = createEditor("", "markdown");
    f.type("`");
    expect(f.text()).toBe("``");
    expect(f.cursor()).toBe(1);
  });

  it("行内公式用 $ 配对", () => {
    const f = createEditor("", "markdown");
    f.type("$");
    expect(f.text()).toBe("$$");
    expect(f.cursor()).toBe(1);
  });

  it("第一个星号配成斜体标记", () => {
    const f = createEditor("", "markdown");
    f.type("*");
    expect(f.text()).toBe("**");
    expect(f.cursor()).toBe(1);
  });

  it("紧接着再敲一个星号升级为粗体标记（Typora 官方视频行为）", () => {
    const f = createEditor("", "markdown");
    f.type("*");
    f.type("*");
    expect(f.text()).toBe("****");
    expect(f.cursor()).toBe(2);
  });

  it("敲完内容再敲星号是闭合，得到斜体", () => {
    const f = createEditor("", "markdown");
    f.type("*");
    f.type("a");
    f.type("*");
    expect(f.text()).toBe("*a*");
    expect(f.cursor()).toBe(3);
  });

  it("升级后敲完内容再敲星号得到粗体", () => {
    const f = createEditor("", "markdown");
    f.type("*");
    f.type("*");
    f.type("粗");
    f.type("*");
    expect(f.text()).toBe("**粗**");
    expect(f.cursor()).toBe(5);
  });

  it("下划线同样逐级升级", () => {
    const f = createEditor("", "markdown");
    f.type("_");
    f.type("_");
    expect(f.text()).toBe("____");
    expect(f.cursor()).toBe(2);
  });
});

describe("自动配对：官方规则的例外项", () => {
  it("波浪号裸输入不自动补闭合", () => {
    const f = createEditor("", "markdown");
    f.type("~");
    expect(f.text()).toBe("~");
  });

  it("等号裸输入不自动补闭合", () => {
    const f = createEditor("", "markdown");
    f.type("=");
    expect(f.text()).toBe("=");
  });

  it("脱字符裸输入不自动补闭合", () => {
    const f = createEditor("", "markdown");
    f.type("^");
    expect(f.text()).toBe("^");
  });

  it("选中文字后敲等号会包成高亮", () => {
    const f = createEditor("文字", "markdown", 0);
    f.view.dispatch({ selection: { anchor: 0, head: 2 } });
    f.type("=");
    expect(f.text()).toBe("==文字==");
  });

  it("选中文字后敲波浪号会包成删除线", () => {
    const f = createEditor("文字", "markdown", 0);
    f.view.dispatch({ selection: { anchor: 0, head: 2 } });
    f.type("~");
    expect(f.text()).toBe("~~文字~~");
  });

  it("选中文字后敲脱字符会包成上标", () => {
    const f = createEditor("文字", "markdown", 0);
    f.view.dispatch({ selection: { anchor: 0, head: 2 } });
    f.type("^");
    expect(f.text()).toBe("^文字^");
  });

  it("包裹后选区保持在被包裹的内容上", () => {
    const f = createEditor("文字", "markdown", 0);
    f.view.dispatch({ selection: { anchor: 0, head: 2 } });
    f.type("=");
    const sel = f.selection();
    expect(f.text().slice(sel.from, sel.to)).toBe("文字");
  });
});

describe("自动配对：上下文保护", () => {
  it("行首的星号照样配对（行首写粗体是最常见场景）", () => {
    const f = createEditor("", "markdown");
    f.type("*");
    expect(f.text()).toBe("**");
  });

  it("行首连敲两个星号升级为粗体", () => {
    const f = createEditor("", "markdown");
    f.type("*");
    f.type("*");
    expect(f.text()).toBe("****");
  });

  it("单词内部的星号不配对（避免破坏 2*3）", () => {
    const f = createEditor("23", "markdown", 1);
    f.type("*");
    expect(f.text()).toBe("2*3");
  });

  it("单词内部的下划线不配对（避免破坏 snake_case）", () => {
    const f = createEditor("ab", "markdown", 1);
    f.type("_");
    expect(f.text()).toBe("a_b");
  });

  it("中文词语中间的下划线也不配对", () => {
    const f = createEditor("你好", "markdown", 1);
    f.type("_");
    expect(f.text()).toBe("你_好");
  });

  it("光标右侧是普通字母时不配对", () => {
    const f = createEditor("abc", "markdown", 0);
    f.type("(");
    expect(f.text()).toBe("(abc");
  });

  it("光标右侧是空白时可以配对", () => {
    const f = createEditor("a ", "markdown", 2);
    f.type("(");
    expect(f.text()).toBe("a ()");
  });
});

describe("自动配对：开关与运行期切换", () => {
  it("off 模式不做任何配对", () => {
    const f = createEditor("", "off");
    f.type("(");
    f.type("*");
    expect(f.text()).toBe("(*");
  });

  it("运行时切换级别会立即生效（Compartment 重配置）", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = createMarkdownEditor({
      parent: host,
      doc: "",
      autoPairMode: "off",
    });

    // off：括号也不配对
    typeInto(editor.view, "(");
    expect(editor.view.state.doc.toString()).toBe("(");

    // 切到 markdown：星号开始配对（光标停在两个星号中间）
    editor.setAutoPairMode("markdown");
    typeInto(editor.view, "*");
    expect(editor.view.state.doc.toString()).toBe("(**");
    expect(editor.view.state.selection.main.head).toBe(2);

    // 切回 off：反引号不再配对
    editor.setAutoPairMode("off");
    editor.view.dispatch({ selection: { anchor: 3 } });
    typeInto(editor.view, "`");
    expect(editor.view.state.doc.toString()).toBe("(**`");

    editor.destroy();
    host.remove();
  });
});

describe("自动配对：撤销栈", () => {
  it("配对插入进撤销栈，可以整体撤销", () => {
    const f = createEditor("", "markdown");
    f.type("(");
    expect(f.text()).toBe("()");
    undo(f.view);
    expect(f.text()).toBe("");
  });

  it("连敲两次星号算一次撤销（CM6 按时间窗口合并连续输入）", () => {
    const f = createEditor("", "markdown");
    f.type("*");
    f.type("*");
    expect(f.text()).toBe("****");
    // 两次击键落在同一个合并窗口里 → 一次撤销全部回退，
    // 与在 VS Code 里连打两个字符后按一次 ⌘Z 的行为一致。
    undo(f.view);
    expect(f.text()).toBe("");
  });
});

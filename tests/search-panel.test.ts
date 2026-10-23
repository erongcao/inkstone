/**
 * 查找 / 替换面板接线的测试。
 *
 * 这里测的不是「CM6 的搜索功能对不对」（那是 CM6 自己的责任，
 * 它的测试比我写得更全），而是**我们的接线对不对**：
 * - 菜单动作能不能把面板叫出来
 * - 「查找」和「替换」两个入口的焦点落点是否不同
 * - 面板是不是真的挂在编辑器自己的 DOM 里（挂到 body 上就成了浮层，
 *   会被编辑器容器的 overflow 裁掉）
 */

import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { search } from "@codemirror/search";
import { openFindPanel, openReplacePanel } from "@/editor/search-panel";
import { createMarkdownEditor } from "@/editor/MarkdownEditor";
import { runCommand } from "@/editor/commands";

function createEditor(doc = "第一段。\n\n第二段。"): EditorView {
  const parent = document.body.appendChild(document.createElement("div"));
  return new EditorView({
    state: EditorState.create({
      doc,
      // 和真实编辑器一致：`search()` 必须在场，
      // 否则 `togglePanel` 效果没人消费，面板开不出来
      extensions: [search()],
    }),
    parent,
  });
}

function panelOf(view: EditorView): HTMLElement | null {
  return view.dom.querySelector<HTMLElement>(".cm-search");
}

describe("查找 / 替换面板接线", () => {
  it("面板默认不出现", () => {
    const view = createEditor();
    expect(panelOf(view)).toBeNull();
    view.destroy();
  });

  it("openFindPanel 打开面板", () => {
    const view = createEditor();
    openFindPanel(view);
    expect(panelOf(view)).not.toBeNull();
    view.destroy();
  });

  it("openFindPanel 把焦点落在查找框上", () => {
    const view = createEditor();
    openFindPanel(view);
    const searchInput = panelOf(view)?.querySelector<HTMLInputElement>(
      'input[name="search"]',
    );
    expect(searchInput).not.toBeNull();
    expect(view.root.activeElement).toBe(searchInput);
    view.destroy();
  });

  it("openReplacePanel 打开面板", () => {
    const view = createEditor();
    openReplacePanel(view);
    expect(panelOf(view)).not.toBeNull();
    view.destroy();
  });

  it("openReplacePanel 把焦点落在替换框上（不是查找框）", () => {
    const view = createEditor();
    openReplacePanel(view);
    const replaceInput = panelOf(view)?.querySelector<HTMLInputElement>(
      'input[name="replace"]',
    );
    const searchInput = panelOf(view)?.querySelector<HTMLInputElement>(
      'input[name="search"]',
    );
    expect(replaceInput).not.toBeNull();
    expect(view.root.activeElement).toBe(replaceInput);
    expect(view.root.activeElement).not.toBe(searchInput);
    view.destroy();
  });

  it("面板里两个输入框都在（查找 + 替换）", () => {
    const view = createEditor();
    openReplacePanel(view);
    const panel = panelOf(view);
    expect(panel?.querySelector('input[name="search"]')).not.toBeNull();
    expect(panel?.querySelector('input[name="replace"]')).not.toBeNull();
    view.destroy();
  });

  it("面板挂在编辑器自己的 DOM 里，不是浮在 body 上", () => {
    const view = createEditor();
    openFindPanel(view);
    expect(view.dom.contains(panelOf(view))).toBe(true);
    view.destroy();
  });

  it("重复调用不会叠出第二个面板", () => {
    const view = createEditor();
    openFindPanel(view);
    openReplacePanel(view);
    openFindPanel(view);
    expect(view.dom.querySelectorAll(".cm-search")).toHaveLength(1);
    view.destroy();
  });
});

/**
 * 用**真实编辑器**再验一遍。
 *
 * 上面的用例只测接线函数本身；这里测的是「用户真按了 ⌘F 会怎样」——
 * 真实编辑器里我们把 CM6 自带的 Mod-f 换成了自己的接线，
 * 如果哪天换回去，焦点就会重新掉回编辑器，这里会立刻报警。
 */
describe("查找 / 替换：真实编辑器里的入口", () => {
  function createRealEditor(): { view: EditorView; dispose: () => void } {
    const host = document.body.appendChild(document.createElement("div"));
    const editor = createMarkdownEditor({ parent: host, doc: "第一段。\n\n第二段。" });
    return {
      view: editor.view,
      dispose: () => {
        editor.destroy();
        host.remove();
      },
    };
  }

  /**
   * 按下修饰键 + f。
   *
   * 平台判断用的是和 CM6 **完全相同**的表达式（`/Mac/.test(nav.platform)`），
   * 因为 `Mod-` 到底绑定 ⌘ 还是 Ctrl 是按这个判的；
   * 用自己的判断方式（比如看 userAgent）会跟 CM6 判出不同结果，
   * 于是测试在没有 Mac 标记的 jsdom 里按错键、假失败。
   */
  function pressModF(view: EditorView): void {
    view.focus();
    const mac = /Mac/.test(navigator.platform);
    const event = new KeyboardEvent("keydown", {
      key: "f",
      code: "KeyF",
      bubbles: true,
      cancelable: true,
      ...(mac ? { metaKey: true } : { ctrlKey: true }),
    });
    view.contentDOM.dispatchEvent(event);
  }

  it("⌘F 打开面板，且焦点落在查找框（不是留在正文里）", () => {
    const { view, dispose } = createRealEditor();
    pressModF(view);

    const panel = view.dom.querySelector<HTMLElement>(".cm-search");
    expect(panel).not.toBeNull();
    expect(view.root.activeElement).toBe(
      panel?.querySelector<HTMLInputElement>('input[name="search"]'),
    );
    dispose();
  });

  it("命令表里的 find.open / find.replace 都能用（菜单与面板共用）", () => {
    const { view, dispose } = createRealEditor();

    expect(runCommand("find.open", view)).toBe(true);
    expect(view.dom.querySelector(".cm-search")).not.toBeNull();
    expect(view.root.activeElement).toBe(
      view.dom.querySelector<HTMLInputElement>('input[name="search"]'),
    );

    expect(runCommand("find.replace", view)).toBe(true);
    expect(view.root.activeElement).toBe(
      view.dom.querySelector<HTMLInputElement>('input[name="replace"]'),
    );
    dispose();
  });
});

import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import App from "../src/App";

/**
 * 交互冒烟测试
 *
 * 验证 React 事件链路确实打通：
 *   输入 → 文档状态更新 → 状态栏字数统计变化
 *   点击「设置」→ 设置面板打开
 *
 * 这类测试的价值在于：一旦将来某个 refactor 破坏了事件绑定或 store 订阅，
 * CI 会立刻报警，而不是等到手动点开应用才发现。
 */

/**
 * 取到 App 挂载的那个 CodeMirror 6 实例。
 *
 * M1 起编辑区是 CM6 而不是 textarea，jsdom 里模拟中文输入很不可靠，
 * 所以直接用 CM6 官方的事务接口来驱动输入——测的是同一条数据链路。
 */
function getEditorView(): EditorView {
  const host = document.querySelector<HTMLElement>(".editor-host");
  if (!host) throw new Error("找不到编辑器挂载点");
  const view = EditorView.findFromDOM(host);
  if (!view) throw new Error("找不到 CodeMirror 实例");
  return view;
}

describe("应用交互", () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("输入内容后状态栏字数统计随之更新", async () => {
    render(<App />);

    const view = getEditorView();
    // 必须包在 act() 里：fireEvent 会自动包，而 CM6 的事务是外部触发的，
    // 不包的话 React 的重渲染不会在断言前落地。
    act(() => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: "你好世界 hello" },
      });
    });

    // 字数统计走**防抖的 mdast 解析**（和大纲共用一次），
    // 所以索引算出来之前状态栏显示「统计中…」而不是 0——
    // 「0 词」会被读成「文档是空的」，那是误导。
    expect(screen.getByText("统计中…")).toBeTruthy();

    // 「你好世界」4 字 + 「hello」1 词 = 5 词；字符数含空格共 10
    expect(await screen.findByText(/5 词 · 10 字符/, {}, { timeout: 3000 })).toBeTruthy();
  });

  it("编辑器内容与文档状态保持同步", () => {
    render(<App />);

    const view = getEditorView();
    act(() => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: "# 标题" },
      });
    });

    expect(view.state.doc.toString()).toBe("# 标题");
  });

  it("点击「设置」打开设置面板", () => {
    render(<App />);

    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("侧边栏标签切换生效", async () => {
    render(<App />);

    // 大纲面板已接通。加载态「正在分析文档结构…」只在**首次**出现
    //（索引是模块级 store，同一份内容不会重复解析），所以这里断言最终状态。
    expect(await screen.findByText("这份文档还没有标题")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "文件" }));
    // M3 起文件树已接通；还没选过文件夹时给的是引导文案
    expect(screen.getByText(/还没有选择文件夹/)).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "大纲" }));
    expect(screen.getByText("这份文档还没有标题")).toBeTruthy();
  });

  it("大纲面板列出标题并可点击跳转", async () => {
    render(<App />);

    const view = getEditorView();
    act(() => {
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: "# 第一章\n\n正文。\n\n## 第二节\n\n更多正文。",
        },
      });
    });

    expect(await screen.findByRole("button", { name: "第一章" }, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByRole("button", { name: "第二节" })).toBeTruthy();

    // 点击后光标应落到该标题所在行
    fireEvent.click(screen.getByRole("button", { name: "第二节" }));
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    expect(line.text).toBe("## 第二节");
  });

  it("修改主题后 data-theme 属性同步更新", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    const select = screen.getByLabelText("主题") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "academic" } });

    expect(document.documentElement.dataset.theme).toBe("academic");
  });

  it("设置持久化到 localStorage", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    const autoPair = screen.getByLabelText("自动配对") as HTMLSelectElement;
    fireEvent.change(autoPair, { target: { value: "off" } });

    const raw = localStorage.getItem("inkstone.settings.v1");
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).editor.autoPairMode).toBe("off");
  });
});

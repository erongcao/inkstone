import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import App from "../src/App";
import { dispatchMenuAction } from "@/ipc/menu";
import { openPalette } from "@/editor/palette";
import { readDraft, writeDraft } from "@/document/draft-store";
import * as documentModule from "@/ipc/document";
import { openDocumentAt, setDocumentContent } from "@/ipc/document";
import { handleExternalChange } from "@/document/conflict";
import { SAMPLE_ROOT } from "@/ipc/fs";
import { readSettings, updateSettings } from "@/settings/store";
import { DEFAULT_FONT_SIZE } from "@/settings/zoom";

const README = `${SAMPLE_ROOT}/README.md`;

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
    /*
     * 设置 store 的 state 是**模块级**的，localStorage.clear() 清不掉它——
     * 上一条用例改过的设置会漏到下一条。显式复位几个会被用例改到的字段。
     */
    updateSettings({
      editor: { markerDisplay: "live" },
      appearance: { fontSize: DEFAULT_FONT_SIZE },
    });
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

  it("原生菜单的「查找 / 替换」能叫出 CM6 搜索面板", () => {
    render(<App />);

    const view = getEditorView();
    expect(view.dom.querySelector(".cm-search")).toBeNull();

    // 「查找」：面板打开，焦点落在查找框
    act(() => {
      dispatchMenuAction("find");
    });
    const panel = view.dom.querySelector<HTMLElement>(".cm-search");
    expect(panel).not.toBeNull();
    expect(view.root.activeElement).toBe(
      panel?.querySelector<HTMLInputElement>('input[name="search"]'),
    );

    // 「替换」：面板已经开着，CM6 自己只会聚焦查找框，
    // 我们的接线要把焦点挪到替换框
    act(() => {
      dispatchMenuAction("replace");
    });
    expect(view.root.activeElement).toBe(
      panel?.querySelector<HTMLInputElement>('input[name="replace"]'),
    );
  });

  it("原生菜单的「显示侧边栏」复选项能收放侧边栏", () => {
    /*
     * 这个复选项之前是**注册了却没人处理**的死菜单项：
     * muda 会自动翻转它的勾选状态，但侧边栏不动——
     * 于是菜单里出现一个「勾了但什么也没发生」的框。
     *
     * （原生侧的勾选状态同步走 Tauri 命令，浏览器里没有 Tauri，
     * 那半条链路由 Rust 侧负责；这里守的是前端这一半。）
     */
    render(<App />);

    const app = document.querySelector<HTMLElement>(".app");
    expect(app?.dataset.sidebar).toBe("visible");

    act(() => {
      dispatchMenuAction("check-sidebar");
    });
    expect(app?.dataset.sidebar).toBe("hidden");

    // 两条入口改的是同一个状态
    act(() => {
      dispatchMenuAction("toggle-sidebar");
    });
    expect(app?.dataset.sidebar).toBe("visible");
  });

  it("原生菜单的「源码模式」切得动（之前是注册了却没人处理的死菜单项）", () => {
    /*
     * 「源码模式」这个菜单项在 Rust 侧建出来了，加速键 ⌘/ 也登记了，
     * 但前端从来没订阅过它——点了没反应。
     * 现在它接到意图总线上，与命令面板里的「源码模式」是同一个动作。
     */
    render(<App />);

    expect(readSettings().editor.markerDisplay).toBe("live");

    act(() => {
      dispatchMenuAction("toggle-source-mode");
    });

    expect(readSettings().editor.markerDisplay).toBe("source");
  });

  it("原生菜单的三个缩放项都有反应（之前也是死菜单项）", () => {
    /*
     * 「放大 / 缩小 / 实际大小」这三个菜单项注册了、加速键也登记了，
     * 但行为是空的——整个缩放功能在原生菜单这条路上根本不存在。
     *
     * 这里守两件事：
     *   1. 菜单项真的有反应（不是静默失效）
     *   2. 改的是 `appearance.fontSize`，且真的落到了 `--ink-font-size` 上
     *      （设置与 CSS 变量脱节 = 用户改了字号但界面没变）
     */
    render(<App />);
    updateSettings({ appearance: { fontSize: DEFAULT_FONT_SIZE } });

    act(() => {
      dispatchMenuAction("zoom-in");
    });
    expect(readSettings().appearance.fontSize).toBe(DEFAULT_FONT_SIZE + 1);
    expect(document.documentElement.style.getPropertyValue("--ink-font-size")).toBe(
      `${DEFAULT_FONT_SIZE + 1}px`,
    );

    act(() => {
      dispatchMenuAction("zoom-out");
    });
    expect(readSettings().appearance.fontSize).toBe(DEFAULT_FONT_SIZE);

    act(() => {
      dispatchMenuAction("zoom-reset");
    });
    expect(readSettings().appearance.fontSize).toBe(DEFAULT_FONT_SIZE);
  });

  it("连续两次放大是放两档，不是一档（缩放要读当前值，不能读过期快照）", () => {
    /*
     * 这条守的是**闭包过期**那个坑：
     * 意图处理器如果读的是 React 渲染时的快照，两次连续放大之间
     * 未必已经重渲染过 → 两次都拿同一个旧值算 → 只放大了一档。
     *
     * 缩放读的是 store 的当前值（readSettings()），所以第二次一定读到新值。
     */
    render(<App />);
    updateSettings({ appearance: { fontSize: DEFAULT_FONT_SIZE } });

    act(() => {
      dispatchMenuAction("zoom-in");
    });
    act(() => {
      dispatchMenuAction("zoom-in");
    });

    expect(readSettings().appearance.fontSize).toBe(DEFAULT_FONT_SIZE + 2);
  });

  it("从命令面板执行「替换」后，焦点落在替换框（面板关闭时不能把焦点抢回编辑器）", async () => {
    render(<App />);

    act(() => {
      openPalette("", "command");
    });

    const replaceItem = await screen.findByRole("button", { name: /替换/ });
    await act(async () => {
      fireEvent.click(replaceItem);
      // 面板关闭后的「还焦给编辑器」是 setTimeout(0)，
      // 必须等它跑完再断言——否则测的是还没发生的时序
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const view = getEditorView();
    const replaceInput = view.dom.querySelector<HTMLInputElement>('input[name="replace"]');
    expect(replaceInput).not.toBeNull();
    expect(view.root.activeElement).toBe(replaceInput);
  });

  it("启动时发现未保存的改动会提示恢复，恢复后内容回到编辑器", async () => {
    writeDraft({
      tabs: [
        {
          id: "t1",
          path: null,
          title: "未命名",
          content: "崩溃前的文字",
          savedContent: "",
        },
      ],
      activeId: "t1",
      savedAt: Date.now(),
    });

    render(<App />);

    expect(await screen.findByRole("dialog", { name: "恢复未保存的改动" })).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "恢复" }));
      await Promise.resolve();
    });

    expect(getEditorView().state.doc.toString()).toBe("崩溃前的文字");
  });

  it("丢弃未保存的改动后不再提示", async () => {
    writeDraft({
      tabs: [
        {
          id: "t1",
          path: null,
          title: "未命名",
          content: "不要了",
          savedContent: "",
        },
      ],
      activeId: "t1",
      savedAt: Date.now(),
    });

    render(<App />);
    await screen.findByRole("dialog", { name: "恢复未保存的改动" });

    fireEvent.click(screen.getByRole("button", { name: "丢弃" }));

    expect(screen.queryByRole("dialog", { name: "恢复未保存的改动" })).toBeNull();
    expect(readDraft()).toBeNull();
  });

  it("外部修改且本地有改动时弹出冲突提示", async () => {
    render(<App />);

    await act(async () => {
      await openDocumentAt(README);
    });
    vi.spyOn(documentModule, "readFileContent").mockResolvedValue("外部改过的内容");
    act(() => {
      setDocumentContent("我本地写的内容");
    });
    await act(async () => {
      await handleExternalChange(README);
    });

    expect(await screen.findByRole("dialog", { name: "文件冲突" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "用磁盘版本" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "保留我的版本" })).toBeTruthy();
  });

  it("设置持久化到 localStorage", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑器" }));
    const autoPair = screen.getByLabelText("自动配对") as HTMLSelectElement;
    fireEvent.change(autoPair, { target: { value: "off" } });

    const raw = localStorage.getItem("inkstone.settings.v1");
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).editor.autoPairMode).toBe("off");
  });

  it("卸载后 CodeMirror 实例被销毁", () => {
    /*
     * 这条守住「React 树卸载 → 视图销毁」这条链。
     *
     * 它不只是洁癖：CM6 内部有个 10ms 的 focus 定时器，
     * 视图销毁时它不会被取消。视图要是活着活过测试文件，
     * 那个定时器会在 jsdom 环境被拆掉之后才触发，
     * 那时 globalThis 上的 requestAnimationFrame 已经被删了 →
     * `this.win.requestAnimationFrame is not a function` →
     * vitest 报 unhandled error、退出码 1，
     * 尽管**所有用例都过了**。
     *
     * （CI 上真的这么挂过一次：Node 22 job。）
     */
    render(<App />);
    const view = getEditorView();
    const probe = view as unknown as { destroyed: boolean };

    expect(probe.destroyed).toBe(false);
    cleanup();
    expect(probe.destroyed).toBe(true);
  });
});

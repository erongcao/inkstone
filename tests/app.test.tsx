import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
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

describe("应用交互", () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("输入内容后状态栏字数统计随之更新", () => {
    render(<App />);

    const textarea = screen.getByPlaceholderText(
      "在此输入 Markdown…",
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "你好世界 hello" } });

    // 「你好世界」4 字 + 「hello」1 词 = 5 词；字符数含空格共 10
    expect(screen.getByText(/5 词 · 10 字符/)).toBeTruthy();
  });

  it("点击「设置」打开设置面板", () => {
    render(<App />);

    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("侧边栏标签切换生效", () => {
    render(<App />);

    expect(screen.getByText("大纲面板将在 M2 提供")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "文件" }));
    expect(screen.getByText("文件树将在 M3 提供")).toBeTruthy();
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
    const autoPair = screen.getByLabelText("自动配对符号") as HTMLInputElement;
    fireEvent.click(autoPair);

    const raw = localStorage.getItem("inkstone.settings.v1");
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).editor.autoPair).toBe(false);
  });
});

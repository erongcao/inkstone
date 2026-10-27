/**
 * Esc 关闭对话框。
 *
 * 之前只有命令面板能响应 Esc，其余对话框只能点「关闭」按钮——
 * 而对话框**不会**把焦点从编辑器抢走（那会让用户接着打字打到别处），
 * 所以挂在容器上的 `onKeyDown` 收不到事件，必须挂 `window`。
 *
 * 这里要守住三件事：
 *
 * 1. **Esc 真的能关**（含焦点不在对话框里的情况）
 * 2. **一次 Esc 只关最上面那个**——面板可能同时开着
 *    （AI 面板 + 设置面板、命令面板 + 帮助面板……），
 *    裸的全局监听会把它们一起关掉，那不是「关闭」，是「清场」
 * 3. **关掉 / 卸载之后不再响应**（栈里不能留残���）
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { useEscapeToClose, resetEscapeStack } from "@/views/use-escape";
import { ShortcutsDialog } from "@/views/ShortcutsDialog";

/** 记录被调用的关闭动作 */
let calls: string[] = [];

/** 最小探针：只测 hook 本身 */
function Probe({ name, enabled = true }: { name: string; enabled?: boolean }) {
  useEscapeToClose(() => calls.push(name), enabled);
  return <div data-testid={name} />;
}

describe("Esc 关闭对话框", () => {
  beforeEach(() => {
    calls = [];
    resetEscapeStack();
  });

  afterEach(() => {
    cleanup();
    resetEscapeStack();
  });

  it("Esc 触发关闭", () => {
    render(<Probe name="a" />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(calls).toEqual(["a"]);
  });

  it("别的键不触发", () => {
    render(<Probe name="a" />);
    fireEvent.keyDown(document.body, { key: "Enter" });
    fireEvent.keyDown(document.body, { key: "a" });
    fireEvent.keyDown(document.body, { key: " " });
    expect(calls).toEqual([]);
  });

  it("一次 Esc 只关最上面那个", () => {
    render(
      <>
        <Probe name="下层" />
        <Probe name="上层" />
      </>,
    );
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(calls).toEqual(["上层"]);
  });

  it("关掉最上面那个之后，Esc 归下一层", () => {
    const { rerender } = render(
      <>
        <Probe name="下层" />
        <Probe name="上层" />
      </>,
    );
    // 上层卸载（对话框被关掉了）
    rerender(<Probe name="下层" />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(calls).toEqual(["下层"]);
  });

  it("enabled=false 时不响应", () => {
    render(<Probe name="a" enabled={false} />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(calls).toEqual([]);
  });

  it("enabled 从 false 变 true 之后开始响应", () => {
    const { rerender } = render(<Probe name="a" enabled={false} />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(calls).toEqual([]);

    rerender(<Probe name="a" enabled={true} />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(calls).toEqual(["a"]);
  });

  it("卸载之后不再响应（栈里不留残留）", () => {
    const { unmount } = render(<Probe name="a" />);
    unmount();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(calls).toEqual([]);
  });

  it("真实面板：Esc 能关掉快捷键一览", () => {
    let closed = 0;
    render(<ShortcutsDialog onClose={() => (closed += 1)} />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(closed).toBe(1);
  });
});

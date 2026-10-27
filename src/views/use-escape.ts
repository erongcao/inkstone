/**
 * Esc 关闭对话框。
 *
 * ## 为什么用全局监听，而不是组件上的 `onKeyDown`
 *
 * 对话框里的焦点**不一定**落在某个特定元素上：
 * 点标题栏、点遮罩都会把焦点留在 `body`，
 * 挂在容器上的 `onKeyDown` 根本收不到事件——
 * 实测就是「关按钮能关，Esc 没反应」。
 *
 * 而对话框**不会**把焦点从编辑器里抢走（那会让用户接着打字打到别处），
 * 所以事件只能从 `window` 上接。
 *
 * ## 为什么要有栈
 *
 * 面板可能**同时**开着（AI 面板 + 设置面板、命令面板 + 帮助面板……）。
 * 裸的全局监听会让一次 Esc 把**所有**打开的对话框一起关掉——
 * 那不是「关闭」，是「清场」。
 *
 * 这里用「后进先出」的栈：只有**最上面**的那个响应 Esc。
 *
 * 栈的顺序靠**挂载顺序**：对话框都是条件渲染的（关掉就卸载），
 * 所以「挂载得晚」=「开得晚」=「在最上面」。
 * 命令面板是例外（它常驻挂载、内部管 `open`），
 * 所以它用 `enabled` 参数——`open` 变 true 时才入栈，位置自然就是最上面。
 *
 * ## 谁**不该**用这个 hook
 *
 * - **恢复 / 文件冲突这类「要你做决定」的对话框**：
 *   Esc 没有「取消」这个语义，静默关掉等于替用户选了「丢弃」——
 *   而那会丢内容。它们宁可 Esc 无反应。
 * - **非模态面板**（AI 面板）：用户正在输入框里打字时按 Esc，
 *   关掉整个面板会丢掉草稿——那里的 Esc 语义应该是「收起浮层」，
 *   不是「关面板」。
 */

import { useEffect, useRef } from "react";

/** 一个对话框的关闭动作 */
type CloseHandler = () => void;

/** 当前打开的对话框栈：后进先出 */
const stack: CloseHandler[] = [];

/** window 上的全局监听只装一个 */
let listening = false;

function handleKeyDown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  const top = stack[stack.length - 1];
  if (!top) return;
  // 阻止默认行为：Esc 在 CM6 里也有含义（关掉搜索面板之类），
  // 对话框开着的时候不该顺手把编辑器那边也动一下。
  event.preventDefault();
  top();
}

function ensureListening(): void {
  if (listening) return;
  listening = true;
  window.addEventListener("keydown", handleKeyDown);
}

/**
 * 让当前组件响应 Esc。
 *
 * @param onClose 关闭动作
 * @param enabled 是否启用（关掉时不入栈，Esc 不响应该组件）
 */
export function useEscapeToClose(onClose: () => void, enabled = true): void {
  /**
   * 回调放进 ref：父组件每次渲染都会传新的箭头函数，
   * 若直接进 effect 的依赖数组，effect 会跟着每次渲染重跑——
   * 而重跑意味着「先弹出再压入」，栈里这个对话框会平白跳到最上面，
   * Esc 的归属就乱了。
   */
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!enabled) return;
    ensureListening();
    const handler: CloseHandler = () => closeRef.current();
    stack.push(handler);
    return () => {
      const index = stack.indexOf(handler);
      if (index >= 0) stack.splice(index, 1);
    };
  }, [enabled]);
}

/** 测试用：清空栈（避免上一个用例的残留影响下一个） */
export function resetEscapeStack(): void {
  stack.length = 0;
}

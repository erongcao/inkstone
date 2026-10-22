/**
 * 当前活动编辑器实例的登记处。
 *
 * 为什么需要：大纲面板在**侧边栏**，编辑器在**主区域**，两者是兄弟组件。
 * 大纲点击要滚动到某个标题，而视图实例只存在于 `EditorSurface` 里。
 *
 * 用模块级单例而不是把 view 往上提 state，是因为应用**同时只有一个编辑器**，
 * 提 state 会让 App / EditorSurface / MarkdownEditor 三层都被一个视图对象穿起来，
 * 收益远小于成本。
 *
 * 登记用订阅而不是存字段，是为了编辑器**重建时**（切换文件会 setValue，
 * 但窗口重建/热更新会重新 mount）旧的订阅能被清掉，不会出现「指向已销毁视图」。
 */

import { EditorView } from "@codemirror/view";

type Listener = (view: EditorView | null) => void;

let current: EditorView | null = null;
const listeners = new Set<Listener>();

/** 登记（或注销）当前编辑器视图 */
export function setActiveEditorView(view: EditorView | null): void {
  if (current === view) return;
  current = view;
  for (const listener of listeners) listener(view);
}

/** 取得当前编辑器视图 */
export function getActiveEditorView(): EditorView | null {
  return current;
}

/** 订阅视图变化（编辑器 mount / unmount 时调用） */
export function onActiveEditorView(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 把编辑器滚动到文档的某个偏移，并聚焦。
 *
 * 大纲点击用。用 `EditorView.dispatch` 而不是 `scrollIntoView` DOM API，
 * 因为要顺便把**光标也移过去**——只滚动不改光标的话，
 * 用户接着打字会打在原来的位置，体验上像是没跳转。
 */
export function scrollEditorTo(offset: number): void {
  const view = current;
  if (!view) return;
  const line = view.state.doc.lineAt(
    Math.max(0, Math.min(offset, view.state.doc.length)),
  );
  view.dispatch({
    selection: { anchor: line.from },
    effects: EditorView.scrollIntoView(line.from, { y: "start", yMargin: 24 }),
  });
  view.focus();
}

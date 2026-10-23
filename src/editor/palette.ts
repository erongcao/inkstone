/**
 * 命令面板的开关状态。
 *
 * 放模块级而不是 React state 的原因：⌘K 的快捷键挂在 **CM6 的 keymap** 里
 * （那是普通函数，拿不到 React 的 setState），而面板在 React 树里。
 * 和 `settings/store.ts`、`active-view.ts` 同一个模式。
 *
 * 面板**不改文档**，所以关闭时不需要恢复选区——CM6 在 DOM 焦点离开时
 * 自己保留 EditorSelection，重新 focus 回去即可。
 */

import { useSyncExternalStore } from "react";

/**
 * 面板的两种模式。
 *
 * `command` = ⌘K，列命令；`file` = ⌘P，列文件。
 * 分成两个模式而不是靠查询词区分：用户按 ⌘P 的意图是「找文件」，
 * 而命令面板里也会有一堆含「打开」字样的命令，两者混在一起会互相干扰。
 */
export type PaletteMode = "command" | "file";

export interface PaletteState {
  open: boolean;
  query: string;
  mode: PaletteMode;
}

const CLOSED: PaletteState = { open: false, query: "", mode: "command" };

let state: PaletteState = CLOSED;
const listeners = new Set<() => void>();

function set(next: PaletteState): void {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = (): PaletteState => state;

/** 打开面板。`initialQuery` 用于「已经打了半截词再按 ⌘K」的场景 */
export function openPalette(initialQuery = "", mode: PaletteMode = "command"): void {
  set({ open: true, query: initialQuery, mode });
}

export function closePalette(): void {
  if (!state.open) return;
  set(CLOSED);
}

export function setPaletteQuery(query: string): void {
  if (!state.open || query === state.query) return;
  set({ open: true, query, mode: state.mode });
}

/** 订阅面板状态 */
export function usePalette(): PaletteState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

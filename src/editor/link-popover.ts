/**
 * 链接浮层的状态。
 *
 * 触发：用户敲出 `](`（图片的 `](` 也触发）。
 * 浮层里是一个真正的 `<input>`，所以它**不是** CM6 补全——
 * URL 可以是任意字符串（带空格、带中文、带 `mailto:`），
 * 补全的「候选」模型表达不了「随便输点什么」。
 *
 * 挂在模块级的原因同命令面板：触发点在编辑器的 DOM 事件里
 * （`live-preview/index.ts` 或这里自己的 ViewPlugin），拿不到 React setState。
 *
 * ## 与编辑器选区的关系
 *
 * 打开时**先把光标移进括号里**再显示浮层。这样用户在浮层里输 URL 时，
 * 光标在编辑器里的位置始终是对的，确认时只要往那个位置插入。
 * 关闭时把焦点还给编辑器（不恢复选区——期间没人动过文档，
 * CM6 自己保留着 EditorSelection）。
 */

import { useSyncExternalStore } from "react";

export interface LinkPopoverState {
  open: boolean;
  /** URL 输入框的内容 */
  url: string;
  /** 插入点（编辑器里的绝对位置） */
  pos: number;
  /** 插入点的视口坐标，用于把浮层挂在光标旁边 */
  anchor: { top: number; bottom: number; left: number };
  /** 是不是图片（`![...](`） */
  image: boolean;
}

const CLOSED: LinkPopoverState = {
  open: false,
  url: "",
  pos: 0,
  anchor: { top: 0, bottom: 0, left: 0 },
  image: false,
};

let state: LinkPopoverState = CLOSED;
const listeners = new Set<() => void>();

function set(next: LinkPopoverState): void {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = (): LinkPopoverState => state;

export function openLinkPopover(
  next: Omit<LinkPopoverState, "open" | "url"> & { url?: string },
): void {
  set({ ...CLOSED, ...next, open: true, url: next.url ?? "" });
}

export function closeLinkPopover(): void {
  if (!state.open) return;
  set(CLOSED);
}

export function setLinkUrl(url: string): void {
  if (!state.open || url === state.url) return;
  set({ ...state, url });
}

export function useLinkPopover(): LinkPopoverState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * URL 的轻量校验。
 *
 * **不是**「合不合法」的判断，只是决定要不要提示：
 * Markdown 里 `](foo bar)` 本来就会被 CommonMark 截断，
 * 而 `](www.example.com)` 是完全合法且常见的写法，不该被拦。
 * 所以只区分「明显是 URL」「看起来像路径/锚点」「其它」。
 */
export type UrlKind = "url" | "path" | "empty";

export function classifyUrl(url: string): UrlKind {
  const trimmed = url.trim();
  if (!trimmed) return "empty";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return "url";
  if (/^(mailto|tel):/i.test(trimmed)) return "url";
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return "url";
  return "path";
}

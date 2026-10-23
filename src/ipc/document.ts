/**
 * 文档状态与文件读写。
 *
 * 与后端的交互统一走 `invoke`，但在浏览器里（pnpm dev）降级为纯内存实现，
 * 这样前端可以脱离 Rust 侧独立调试。
 *
 * 状态放在模块级 store 而非组件内：编辑器区与状态栏都要读写同一份文档，
 * 必须共享同一个实例，否则字数统计、脏标记会不同步。
 */

import { useCallback, useSyncExternalStore } from "react";

export interface DocumentState {
  /** 文件绝对路径；null 表示未命名草稿 */
  path: string | null;
  content: string;
  /** 是否有未保存改动 */
  dirty: boolean;
  /** 当前文档标题（不含路径） */
  title: string;
}

type Backend = {
  openFile(): Promise<{ path: string; content: string } | null>;
  saveFile(path: string, content: string): Promise<void>;
  saveFileAs(content: string): Promise<string | null>;
  setTitle(title: string): Promise<void>;
  readFile(path: string): Promise<string>;
};

const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** 浏览器降级实现：无法落盘，仅内存 */
const browserBackend: Backend = {
  async openFile() {
    return null;
  },
  async saveFile() {
    /* 浏览器降级模式不支持落盘 */
  },
  async saveFileAs() {
    return null;
  },
  async setTitle() {
    /* 浏览器降级模式没有窗口标题 */
  },
  async readFile() {
    return "";
  },
};

const tauriBackend: Backend = {
  async openFile() {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<{ path: string; content: string } | null>("open_document");
  },
  async saveFile(path, content) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_document", { path, content });
  },
  async saveFileAs(content) {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string | null>("save_document_as", { content });
  },
  async setTitle(title) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_document_title", { title });
  },
  async readFile(path) {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string>("read_document", { path });
  },
};

function getBackend(): Backend {
  return isTauri() ? tauriBackend : browserBackend;
}

/* ── 模块级 store ── */

let state: DocumentState = {
  path: null,
  content: "",
  dirty: false,
  title: "未命名",
};

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): DocumentState {
  return state;
}

function setState(patch: Partial<DocumentState>) {
  state = { ...state, ...patch };
  emit();
}

/** 从完整路径取出展示用标题 */
function titleFromPath(path: string | null): string {
  if (!path) return "未命名";
  const name = path.split("/").pop() ?? path;
  return name.replace(/\.(md|markdown|mdown|mkd|txt)$/i, "");
}

/* ── 对外 API ── */

export async function openDocument(): Promise<void> {
  const result = await getBackend().openFile();
  if (!result) return;
  setState({
    path: result.path,
    content: result.content,
    dirty: false,
    title: titleFromPath(result.path),
  });
  await getBackend().setTitle(state.title);
}

/** 直接打开指定路径（用于「从 Finder 双击打开」和文件树点击） */
export async function openDocumentAt(path: string): Promise<void> {
  // 已经在编辑这个文件、且有未保存改动时，再点一次**不能**重读磁盘。
  // 文件树里当前文件那一行是可以再点到的，
  // 而 Finder 双击同一个文件更是常规操作——
  // 没有这道护栏，一次误点就会把用户刚敲的字换成磁盘上的旧版本。
  if (state.path === path && state.dirty) return;
  const content = await getBackend().readFile(path);
  setState({ path, content, dirty: false, title: titleFromPath(path) });
  await getBackend().setTitle(state.title);
}

export async function saveDocument(): Promise<void> {
  if (!state.path) return;
  await getBackend().saveFile(state.path, state.content);
  setState({ dirty: false });
}

export async function saveDocumentAs(): Promise<void> {
  const path = await getBackend().saveFileAs(state.content);
  if (!path) return;
  setState({ path, dirty: false, title: titleFromPath(path) });
  await getBackend().setTitle(state.title);
}

export function newDocument(): void {
  setState({ path: null, content: "", dirty: false, title: "未命名" });
  void getBackend().setTitle(state.title);
}

export function setDocumentContent(content: string): void {
  setState({ content, dirty: state.content !== content });
}

/**
 * 取当前文档的绝对路径（非 hook 版本）。
 *
 * 图片要按「文档所在目录」解析相对路径，而解析发生在装饰器 / widget 里——
 * 那是纯 DOM 逻辑，不能也不该调 hook。用同步读取模块级 store，
 * 和 `useDocument()` 订阅的是同一份状态。
 */
export function currentDocumentPath(): string | null {
  return state.path;
}

/**
 * 同步读当前文档内容（非 hook 版本）。
 *
 * 存在理由同 `currentDocumentPath()`：文件树、状态栏这些地方需要在组件外
 * 看到文档此刻的内容，又不能为此订阅一份会频繁变化的状态。
 */
export function getDocumentContent(): string {
  return state.content;
}

export function useDocument() {
  const doc = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const open = useCallback(() => openDocument(), []);
  const save = useCallback(() => saveDocument(), []);
  const saveAs = useCallback(() => saveDocumentAs(), []);
  const create = useCallback(() => newDocument(), []);
  const setContent = useCallback((content: string) => setDocumentContent(content), []);

  // 字数统计不再由这里出：它和大纲共用一次防抖的 mdast 解析，见 editor/document-index.ts
  return { doc, open, save, saveAs, create, setContent };
}

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
import { scrollEditorTo } from "@/editor/active-view";

export interface DocumentState {
  /** 文件绝对路径；null 表示未命名草稿 */
  path: string | null;
  content: string;
  /** 是否有未保存改动 */
  dirty: boolean;
  /** 当前文档标题（不含路径） */
  title: string;
  /** 最近一次落盘失败的原因；null = 没有失败 */
  saveError: string | null;
  /** 崩溃恢复快照写不进去的原因；null = 没有失败 */
  recoveryError: string | null;
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
  async readFile(path) {
    // 样例库里的文件要能真的读出内容。
    // 一律返回空串的话，文件树点开、搜索结果跳转在浏览器里都是「打开一片空白」，
    // 那就没法在浏览器里验收这些功能了。
    const { SAMPLE_CONTENTS } = await import("@/ipc/fs");
    return SAMPLE_CONTENTS[path] ?? "";
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
  saveError: null,
  recoveryError: null,
};

/**
 * 磁盘上此刻的内容。
 *
 * 脏标记必须拿它比，不能拿「上一次的内容」比：
 * 拿上一次比的话，用户敲了字又删回去（内容回到磁盘上的样子），
 * 脏标记还是 true——于是一次保存本可以什么都不写，
 * 而自动保存也会因为「有未保存改动」而反复触发。
 *
 * 它同时是「已保存」这个判断的唯一依据：
 * 打开文件、另存为、保存成功，三处都要同步更新它。
 */
let savedContent = "";

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
  savedContent = result.content;
  setState({
    path: result.path,
    content: result.content,
    dirty: false,
    title: titleFromPath(result.path),
    saveError: null,
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
  savedContent = content;
  setState({ path, content, dirty: false, title: titleFromPath(path) });
  await getBackend().setTitle(state.title);
}

/**
 * 保存文档。
 *
 * 返回 true = 内容确实落到了磁盘上；false = 落盘失败（原因写进了 `saveError`）。
 *
 * ## 为什么失败不抛异常
 * 自动保存是**定时**触发的，没人 await 它——抛出去就是 unhandled rejection，
 * 用户什么都看不到。所以错误改成写进 store，由状态栏如实显示。
 * 自动保存失败却一声不吭是最坏的结果：用户以为字已经存进磁盘了。
 */
export async function saveDocument(): Promise<boolean> {
  if (!state.path) return false;
  const path = state.path;
  const content = state.content;
  try {
    await getBackend().saveFile(path, content);
  } catch (error) {
    setState({ saveError: describeError(error) });
    return false;
  }
  // 落盘期间用户可能又改了内容：只有内容没变过才能清脏标记。
  // 不加这道判断，会把「还没保存的新改动」标成已保存——那等于丢数据。
  if (state.path === path && state.content === content) {
    savedContent = content;
    setState({ dirty: false, saveError: null });
  }
  return true;
}

export async function saveDocumentAs(): Promise<void> {
  const path = await getBackend().saveFileAs(state.content);
  if (!path) return;
  savedContent = state.content;
  setState({ path, dirty: false, title: titleFromPath(path), saveError: null });
  await getBackend().setTitle(state.title);
}

/** 把异常变成一句人能读的话（后端抛的往往是一串 JSON） */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function newDocument(): void {
  savedContent = "";
  setState({
    path: null,
    content: "",
    dirty: false,
    title: "未命名",
    saveError: null,
  });
  void getBackend().setTitle(state.title);
}

export function setDocumentContent(content: string): void {
  // 脏标记 = 现在的内容与磁盘上的内容不同
  setState({ content, dirty: content !== savedContent });
}

/**
 * 打开指定路径并跳到第 `line` 行（1 起）。
 *
 * 全局搜索的结果点击后走这里：先打开文件，再把光标和视口移到那一行。
 * 分两步是因为「打开」要等磁盘内容回来，而跳转必须在内容就位之后做，
 * 否则算出来的偏移量是按旧内容算的。
 */
export async function openDocumentAtLine(path: string, line: number): Promise<void> {
  await openDocumentAt(path);
  const offset = lineToOffset(state.content, line);
  scrollEditorTo(offset);
}

/**
 * 第 `line` 行（1 起）在文本里的起始偏移。
 *
 * 行号超界就夹到文档末尾：搜索结果对应的文件可能已经被外部改过了，
 * 那时行号会失效——夹住比跳到一个不存在的位置好。
 */
export function lineToOffset(content: string, line: number): number {
  if (line <= 1) return 0;
  let offset = 0;
  let current = 1;
  while (current < line) {
    const next = content.indexOf("\n", offset);
    if (next === -1) return content.length;
    offset = next + 1;
    current += 1;
  }
  return Math.min(offset, content.length);
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

/** 读一个文件的内容（非 hook 版本）。崩溃恢复要拿它和草稿快照比对 */
export async function readFileContent(path: string): Promise<string> {
  return await getBackend().readFile(path);
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

/**
 * 订阅文档状态变化（非 hook 版本）。
 *
 * 给自动保存运行时用：它要在 React 之外跟着内容变化做节流/防抖，
 * 而 `useDocument()` 是 hook，运行时拿不到。
 */
export function subscribeDocument(listener: () => void): () => void {
  return subscribe(listener);
}

/** 同步读整份文档状态（非 hook 版本） */
export function getDocumentState(): DocumentState {
  return state;
}

/** 记录「崩溃恢复快照写不进去」的原因；传 null 表示恢复正常 */
export function setRecoveryError(message: string | null): void {
  if (state.recoveryError === message) return;
  setState({ recoveryError: message });
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

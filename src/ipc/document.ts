/**
 * 文档状态与文件读写。
 *
 * ## 标签页模型
 *
 * 状态存的是**一组标签页**，对外暴露的 `DocumentState` 是「当前标签页」的投影——
 * 这样既有消费方（编辑器区、状态栏、文件树、搜索、冲突处理）一行都不用改。
 *
 * 投影对象必须**缓存**：`useSyncExternalStore` 要求快照在没变化时引用相等，
 * 每次现场构造一个新对象会让 React 无限重渲染。
 *
 * ## 撤销历史也是每页独立的
 *
 * 标签页切换时换的是整个 `EditorState`（见 views/EditorSurface.tsx），
 * 不是往同一个状态里塞新文档——所以每页各自保有自己的撤销栈与光标位置。
 * 用 `setValue` 换内容的话，撤销栈会被清掉：用户切回上一页按 ⌘Z 会发现
 * 「怎么什么都没得撤」，那是比没有多标签更糟的体验。
 *
 * 与后端的交互统一走 `invoke`，但在浏览器里（pnpm dev）降级为纯内存实现，
 * 这样前端可以脱离 Rust 侧独立调试。
 *
 * 状态放在模块级 store 而非组件内：编辑器区与状态栏都要读写同一份文档，
 * 必须共享同一个实例，否则字数统计、脏标记会不同步。
 */

import { useCallback, useSyncExternalStore } from "react";
import type { SessionSnapshot } from "@/document/draft-store";

/** 一个标签页 */
interface Tab {
  id: string;
  /** 文件绝对路径；null 表示未命名草稿 */
  path: string | null;
  /** 展示用标题 */
  title: string;
  /** 文本内容 */
  content: string;
  /** 我们相信磁盘上此刻的内容 */
  savedContent: string;
  /** 磁盘内容与我们知道的不一致（文件在外部被改过） */
  externalChange: boolean;
}

/** 标签页在 UI 上的投影（标签栏用） */
export interface TabInfo {
  id: string;
  path: string | null;
  title: string;
  /** 有未保存改动 */
  dirty: boolean;
}

/** 当前标签页的状态投影 */
export interface DocumentState {
  /** 当前标签页 id */
  tabId: string;
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
  /**
   * 磁盘上的内容与我们知道的不一致（文件在外部被改过）。
   *
   * 为 true 期间**自动保存会暂停**：再往这个文件上写就是把对方的改动无声抹掉。
   * 用户明确保存（⌘S）或者选择「用磁盘版本」之后才解除。
   */
  externalChange: boolean;
  /** 一条要显示给用户的短提示；null = 没有 */
  notice: string | null;
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

let tabs: Tab[] = [];
let activeId = "";
let nextTabSeq = 1;

/** 切标签页后要把编辑器滚到哪（偏移）；null = 不用滚 */
let pendingScroll: number | null = null;

/** 应用级状态（不属于某个标签页） */
let saveError: string | null = null;
let recoveryError: string | null = null;
let notice: string | null = null;

/** 当前标签页的投影快照（缓存，保证引用稳定） */
let snapshot: DocumentState = emptySnapshot();
/** 标签列表的投影快照 */
let tabsSnapshot: TabInfo[] = [];

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emptySnapshot(): DocumentState {
  return {
    tabId: "",
    path: null,
    content: "",
    dirty: false,
    title: "未命名",
    saveError: null,
    recoveryError: null,
    externalChange: false,
    notice: null,
  };
}

function findTab(id: string): Tab | undefined {
  return tabs.find((tab) => tab.id === id);
}

function activeTab(): Tab | undefined {
  return findTab(activeId);
}

/**
 * 重建投影快照。
 *
 * 每次状态变化都要调——`useSyncExternalStore` 靠快照的引用变化判断要不要重渲染。
 */
function rebuild(): void {
  const tab = activeTab();
  snapshot = {
    tabId: tab?.id ?? "",
    path: tab?.path ?? null,
    content: tab?.content ?? "",
    // 脏标记以**磁盘上的内容**为准，不是「上一次的内容」：
    // 用户敲了字又删回去（内容回到磁盘上的样子）时，那不是未保存的改动
    dirty: tab ? tab.content !== tab.savedContent : false,
    title: tab?.title ?? "未命名",
    saveError,
    recoveryError,
    externalChange: tab?.externalChange ?? false,
    notice,
  };
  tabsSnapshot = tabs.map((item) => ({
    id: item.id,
    path: item.path,
    title: item.title,
    dirty: item.content !== item.savedContent,
  }));
}

function getSnapshot(): DocumentState {
  return snapshot;
}

function getTabsSnapshot(): TabInfo[] {
  return tabsSnapshot;
}

/** 从完整路径取出展示用标题 */
function titleFromPath(path: string | null): string {
  if (!path) return "未命名";
  const name = path.split("/").pop() ?? path;
  return name.replace(/\.(md|markdown|mdown|mkd|txt)$/i, "");
}

function createTab(init: {
  path: string | null;
  title: string;
  content: string;
  savedContent: string;
}): Tab {
  const tab: Tab = {
    id: `tab-${nextTabSeq++}`,
    path: init.path,
    title: init.title,
    content: init.content,
    savedContent: init.savedContent,
    externalChange: false,
  };
  tabs.push(tab);
  return tab;
}

/* ── 对外 API ── */

/**
 * 这个标签页是不是「还空着的占位页」。
 *
 * 占位页 = 没路径、没内容、也没未保存改动。
 */
function isPristineEmptyTab(tab: Tab | undefined): boolean {
  return (
    !!tab && tab.path === null && tab.content === "" && tab.content === tab.savedContent
  );
}

/**
 * 拿一个可以承载新文档的标签页；没有就返回 null（要新建）。
 *
 * 只有一个空占位页时直接用它：应用刚启动时那个空标签页，
 * 不该在打开文件之后还留在那儿（多一个空标签页看着像多开了一个文档）。
 *
 * 判断放在**读完文件之后**：读文件是异步的，这期间用户可能已经在那个
 * 空页上敲了字，那时它就不是占位页了。
 */
function takeReusableTab(): Tab | null {
  if (tabs.length !== 1) return null;
  return isPristineEmptyTab(tabs[0]) ? tabs[0] : null;
}

/**
 * 打开（或聚焦）一个文件。
 *
 * 已经在某个标签页里打开过的文件 → 切到那个标签页，**不重读磁盘**：
 * 用户可能正在那一页编辑，重读会把刚敲的字换成磁盘上的旧版本。
 */
export async function openDocumentAt(path: string): Promise<void> {
  const existing = tabs.find((tab) => tab.path === path);
  if (existing) {
    activateTab(existing.id);
    return;
  }
  const content = await getBackend().readFile(path);
  const reusable = takeReusableTab();
  const tab = reusable
    ? reuseTabFor(reusable, path, titleFromPath(path), content)
    : createTab({
        path,
        title: titleFromPath(path),
        content,
        savedContent: content,
      });
  activateTab(tab.id);
  await getBackend().setTitle(tab.title);
}

/** 把一个空占位页改造成装着某个文件的标签页 */
function reuseTabFor(tab: Tab, path: string, title: string, content: string): Tab {
  tab.path = path;
  tab.title = title;
  tab.content = content;
  tab.savedContent = content;
  tab.externalChange = false;
  return tab;
}

/** 用系统对话框打开文件（原生菜单「打开」） */
export async function openDocument(): Promise<void> {
  const result = await getBackend().openFile();
  if (!result) return;
  const reusable = takeReusableTab();
  const tab = reusable
    ? reuseTabFor(reusable, result.path, titleFromPath(result.path), result.content)
    : createTab({
        path: result.path,
        title: titleFromPath(result.path),
        content: result.content,
        savedContent: result.content,
      });
  activateTab(tab.id);
  await getBackend().setTitle(tab.title);
}

/**
 * 新建一个标签页。
 *
 * 不是「清空当前页」——当前页可能有没保存的改动，
 * 清空等于把那些字扔掉。新开一页才是无损的做法。
 */
export function newDocument(): void {
  const tab = createTab({
    path: null,
    title: "未命名",
    content: "",
    savedContent: "",
  });
  activateTab(tab.id);
  void getBackend().setTitle(tab.title);
}

/** 切换到某个标签页 */
export function activateTab(id: string): void {
  if (!findTab(id)) return;
  // 即使切到的是当前页也要 emit：
  // 「跳到第 N 行」这类动作跟在激活之后，它需要一次渲染来执行
  activeId = id;
  const tab = activeTab();
  rebuild();
  emit();
  if (tab) void getBackend().setTitle(tab.title);
}

/**
 * 关闭一个标签页。
 *
 * 关闭当前页时切到相邻的一页（先往前找，没有就往后找）。
 * 最后一页被关掉时开一个空页——不能没有标签页，
 * 否则编辑器区没有可编辑的对象。
 */
export function closeTab(id: string): void {
  const index = tabs.findIndex((tab) => tab.id === id);
  if (index === -1) return;
  const wasActive = id === activeId;
  tabs.splice(index, 1);

  if (tabs.length === 0) {
    const tab = createTab({
      path: null,
      title: "未命名",
      content: "",
      savedContent: "",
    });
    activeId = tab.id;
    void getBackend().setTitle(tab.title);
  } else if (wasActive) {
    const next = tabs[Math.min(index, tabs.length - 1)];
    activeId = next.id;
    void getBackend().setTitle(next.title);
  }
  rebuild();
  emit();
}

/** 保存当前标签页 */
export async function saveDocument(): Promise<boolean> {
  return await saveTab(activeId);
}

/**
 * 保存指定标签页。
 *
 * 返回 true = 内容确实落到了磁盘上；false = 落盘失败（原因写进了 `saveError`）。
 *
 * ## 为什么失败不抛异常
 * 自动保存是**定时**触发的，没人 await 它——抛出去就是 unhandled rejection，
 * 用户什么都看不到。所以错误改成写进 store，由状态栏如实显示。
 * 自动保存失败却一声不吭是最坏的结果：用户以为字已经存进磁盘了。
 */
export async function saveTab(id: string): Promise<boolean> {
  const tab = findTab(id);
  if (!tab || !tab.path) return false;
  const path = tab.path;
  const content = tab.content;
  try {
    await getBackend().saveFile(path, content);
  } catch (error) {
    saveError = describeError(error);
    rebuild();
    emit();
    return false;
  }
  // 落盘期间用户可能又改了内容：只有内容没变过才能清脏标记。
  // 不加这道判断，会把「还没保存的新改动」标成已保存——那等于丢数据。
  if (tab.content === content && tab.path === path) {
    tab.savedContent = content;
    // 用户明确保存 = 明确接受用本地版本覆盖磁盘上的外部改动
    tab.externalChange = false;
  }
  saveError = null;
  rebuild();
  emit();
  return true;
}

export async function saveDocumentAs(): Promise<void> {
  const tab = activeTab();
  if (!tab) return;
  const path = await getBackend().saveFileAs(tab.content);
  if (!path) return;
  tab.path = path;
  tab.title = titleFromPath(path);
  tab.savedContent = tab.content;
  tab.externalChange = false;
  saveError = null;
  rebuild();
  emit();
  await getBackend().setTitle(tab.title);
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

/** 设置当前标签页的内容 */
export function setDocumentContent(content: string): void {
  const tab = activeTab();
  if (!tab) return;
  tab.content = content;
  rebuild();
  emit();
}

/**
 * 打开指定路径并跳到第 `line` 行（1 起）。
 *
 * 全局搜索的结果点击后走这里：先打开文件，再把光标和视口移到那一行。
 *
 * 「跳到哪一行」是**先记下来再打开**的：打开文件会切标签页，
 * 而编辑器换状态要等 React 跑完 effect——那时候再算偏移就晚了，
 * 滚到的位置会按旧文档算。
 */
export async function openDocumentAtLine(path: string, line: number): Promise<void> {
  await openDocumentAt(path);
  pendingScroll = lineToOffset(snapshot.content, line);
  // 再触发一次渲染，让编辑器把这次滚动执行掉
  rebuild();
  emit();
}

/**
 * 取走「待执行的滚动偏移」。
 *
 * 由编辑器在换完状态之后取：那一刻状态才是新文档的，
 * 偏移量才对得上。
 */
export function takePendingScroll(): number | null {
  const offset = pendingScroll;
  pendingScroll = null;
  return offset;
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
  return activeTab()?.path ?? null;
}

/**
 * 同步读当前文档内容（非 hook 版本）。
 *
 * 存在理由同 `currentDocumentPath()`：文件树、状态栏这些地方需要在组件外
 * 看到文档此刻的内容，又不能为此订阅一份会频繁变化的状态。
 */
export function getDocumentContent(): string {
  return snapshot.content;
}

/** 读一个文件的内容（非 hook 版本）。崩溃恢复与外部修改检测都要拿它和「我们知道的」比 */
export async function readFileContent(path: string): Promise<string> {
  return await getBackend().readFile(path);
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
  return snapshot;
}

/** 当前标签页 id（非 hook 版本） */
export function getActiveTabId(): string {
  return activeId;
}

/** 全部标签页（非 hook 版本） */
export function getTabs(): TabInfo[] {
  return tabsSnapshot;
}

/**
 * 处在「外部改动未解决」状态的标签页 id 集合。
 *
 * 自动保存要逐页判断时用：这些页在用户决定之前不能写。
 */
export function externallyChangedTabIds(): Set<string> {
  return new Set(tabs.filter((tab) => tab.externalChange).map((tab) => tab.id));
}

/**
 * 我们相信磁盘上此刻的内容。
 *
 * 外部修改检测就是拿它和磁盘上的实际内容比：
 * 不一样就说明有人（另一个编辑器、git checkout、脚本）动过这个文件。
 */
export function getSavedContent(): string {
  return activeTab()?.savedContent ?? "";
}

/** 标记「文件在外部被改过」——自动保存会因此暂停 */
export function markExternalChange(): void {
  const tab = activeTab();
  if (!tab || tab.externalChange) return;
  tab.externalChange = true;
  rebuild();
  emit();
}

/** 解除「文件在外部被改过」 */
export function clearExternalChange(): void {
  const tab = activeTab();
  if (!tab || !tab.externalChange) return;
  tab.externalChange = false;
  rebuild();
  emit();
}

/**
 * 用磁盘上的内容替换当前内容（外部修改、且本地没有未保存改动时用）。
 *
 * 同时更新 `savedContent`——它就是「我们相信磁盘上是什么」的答案，
 * 不同步的话，下一次外部修改检测会把同一份内容又当成新改动。
 */
export function reloadFromDisk(content: string): void {
  const tab = activeTab();
  if (!tab) return;
  tab.content = content;
  tab.savedContent = content;
  tab.externalChange = false;
  rebuild();
  emit();
}

/** 记录「崩溃恢复快照写不进去」的原因；传 null 表示恢复正常 */
export function setRecoveryError(message: string | null): void {
  if (recoveryError === message) return;
  recoveryError = message;
  rebuild();
  emit();
}

/**
 * 显示一条短提示。
 *
 * 自动消失（默认 5 秒）——短提示是用来让人知道「刚才发生了什么」，
 * 一直挂着会变成噪声。传 null 立即清掉。
 */
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

export function setNotice(message: string | null, durationMs = 5000): void {
  if (noticeTimer) {
    clearTimeout(noticeTimer);
    noticeTimer = null;
  }
  notice = message;
  if (message !== null && durationMs > 0) {
    noticeTimer = setTimeout(() => {
      noticeTimer = null;
      if (notice === message) {
        notice = null;
        rebuild();
        emit();
      }
    }, durationMs);
  }
  rebuild();
  emit();
}

/* ── 会话快照（崩溃恢复用） ── */

/**
 * 导出当前会话（供崩溃恢复写入）。
 *
 * 存的是**整个标签页列表**，不只是当前那一页：
 * 崩溃恢复要回答的是「我刚才敲的东西还在吗」，
 * 而用户开了五个标签页时，答案是「五个都在」。
 */
export function exportSession(): SessionSnapshot {
  return {
    tabs: tabs.map((tab) => ({
      id: tab.id,
      path: tab.path,
      title: tab.title,
      content: tab.content,
      savedContent: tab.savedContent,
    })),
    activeId,
    savedAt: Date.now(),
  };
}

/**
 * 用一份会话快照恢复标签页列表。
 *
 * 整体替换而不是合并：快照就是崩溃前那一刻的完整现场，
 * 合并会留下快照里没有的、当前进程里有的那些页。
 */
export function importSession(snapshot: SessionSnapshot): void {
  tabs = snapshot.tabs.map((item) => ({
    id: item.id,
    path: item.path,
    title: item.title,
    content: item.content,
    savedContent: item.savedContent,
    externalChange: false,
  }));
  // 保证 id 不与后续新建的冲突
  for (const tab of tabs) {
    const seq = Number(tab.id.replace(/^tab-/, ""));
    if (Number.isFinite(seq) && seq >= nextTabSeq) nextTabSeq = seq + 1;
  }
  activeId = tabs.some((tab) => tab.id === snapshot.activeId)
    ? snapshot.activeId
    : (tabs[0]?.id ?? "");
  if (tabs.length === 0) {
    const tab = createTab({
      path: null,
      title: "未命名",
      content: "",
      savedContent: "",
    });
    activeId = tab.id;
  }
  rebuild();
  emit();
}

/** 清空全部标签页，开一个空的（测试与「重新开始」用） */
export function resetTabs(): void {
  tabs = [];
  activeId = "";
  nextTabSeq = 1;
  const tab = createTab({
    path: null,
    title: "未命名",
    content: "",
    savedContent: "",
  });
  activeId = tab.id;
  rebuild();
  emit();
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

/** 订阅标签列表 */
export function useTabs(): TabInfo[] {
  return useSyncExternalStore(subscribe, getTabsSnapshot, getTabsSnapshot);
}

// 应用启动时先开一个空标签页：编辑器区不能没有可编辑的对象
resetTabs();

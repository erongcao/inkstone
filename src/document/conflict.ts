/**
 * 外部修改检测与冲突处理。
 *
 * ## 三种情况
 *
 * | 磁盘内容 | 本地有未保存改动？ | 怎么办 |
 * |---|---|---|
 * | 和我们知道的一样 | 无关 | 什么都不做（多半是我们自己刚保存的） |
 * | 不一样 | 否 | 静默跟着磁盘走 + 一条短提示 |
 * | 不一样 | 是 | **冲突**：问用户 |
 *
 * ## 为什么「有未保存改动」时不能自动跟磁盘走
 *
 * 那是用户刚敲的字。自动用磁盘版本覆盖，等于把他们的工作扔掉；
 * 自动用本地版本覆盖磁盘，等于把另一个编辑器里的改动扔掉。
 * 两种都是替用户做不可逆的决定，所以要问。
 *
 * ## 冲突没解决之前，自动保存是停的
 *
 * 否则「保留我的版本」这个选择会被自动保存推翻——
 * 用户说「我要我的」，自动保存转头就把磁盘上那份抹了。
 * 所以 `externalChange` 为真时自动保存跳过这个文件，
 * 直到用户明确保存（⌘S）或选择「用磁盘版本」。
 */

import { useSyncExternalStore } from "react";
import {
  clearExternalChange,
  getDocumentState,
  getSavedContent,
  markExternalChange,
  readFileContent,
  reloadFromDisk,
  setNotice,
  subscribeDocument,
} from "@/ipc/document";
import { onDocumentChanged, unwatchDocument, watchDocument } from "@/ipc/watch";
import { t } from "@/i18n";

/** 一场待处理的冲突 */
export interface Conflict {
  /** 冲突文件的路径 */
  path: string;
  /** 磁盘上的新内容 */
  diskContent: string;
  /** 本地编辑器里的内容 */
  localContent: string;
}

let conflict: Conflict | null = null;

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

function getSnapshot(): Conflict | null {
  return conflict;
}

/** 当前待处理的冲突（非 hook 版本） */
export function getConflict(): Conflict | null {
  return conflict;
}

/** 订阅冲突状态 */
export function useConflict(): Conflict | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function setConflict(next: Conflict | null) {
  conflict = next;
  emit();
}

/**
 * 处理一次「文件在外部被修改」的信号。
 *
 * 单独暴露出来是为了能直接测它——真实事件要等 Rust 侧轮询到，
 * 测试里等不起。
 */
export async function handleExternalChange(path: string): Promise<void> {
  const state = getDocumentState();
  if (state.path !== path) return;

  let diskContent: string;
  try {
    diskContent = await readFileContent(path);
  } catch {
    // 读不到（文件被删了 / 权限变了）：先不动。
    // 报「文件被删了」是另一件事，不该混进冲突流程里。
    return;
  }

  // 内容和我们知道的一样 → 多半是我们自己刚保存的（原子替换换了 inode，mtime 变了）
  if (diskContent === getSavedContent()) return;

  if (!state.dirty) {
    // 本地没有未保存改动 → 跟着磁盘走
    reloadFromDisk(diskContent);
    setNotice(t("文件已在外部更新，已重新载入"));
    return;
  }

  // 本地有未保存改动 → 冲突，问用户
  markExternalChange();
  setConflict({
    path,
    diskContent,
    localContent: state.content,
  });
}

/** 用户选择「用磁盘版本」：丢掉本地改动，跟磁盘走 */
export function resolveWithDisk(): void {
  const current = conflict;
  setConflict(null);
  if (!current) return;
  reloadFromDisk(current.diskContent);
  setNotice(t("已改用磁盘上的版本"));
}

/**
 * 用户选择「保留我的版本」。
 *
 * 注意这里**不**解除 `externalChange`：
 * 磁盘上的那份改动用户还没合进来，自动保存必须继续停着，
 * 否则「保留我的版本」会被自动保存当场推翻。
 */
export function resolveKeepLocal(): void {
  setConflict(null);
  setNotice(t("已保留你的版本；外部改动尚未合入，自动保存保持暂停"), 8000);
}

/** 解除外部改动标记（用户明确保存之后由 document 层调用） */
export function clearConflict(): void {
  clearExternalChange();
  setConflict(null);
}

/**
 * 启动监听运行时。
 *
 * 只监听**当前打开的那一个文件**：
 * 别的文件变了不影响正在写的东西，监听整个笔记库是另一件事。
 */
export function startWatchRuntime(): () => void {
  let currentPath: string | null = null;

  const off = onDocumentChanged((path) => {
    void handleExternalChange(path);
  });

  // 文档切换时改监听目标
  const stopWatching = subscribeDocumentPath((path) => {
    if (path === currentPath) return;
    currentPath = path;
    if (path) void watchDocument(path);
    else void unwatchDocument();
  });

  return () => {
    off();
    stopWatching();
    void unwatchDocument();
  };
}

/** 订阅「当前文档路径变了」 */
function subscribeDocumentPath(listener: (path: string | null) => void): () => void {
  let last = getDocumentState().path;
  const check = () => {
    const next = getDocumentState().path;
    if (next !== last) {
      last = next;
      listener(next);
    }
  };
  // 文档 store 的订阅粒度是「任何变化」，这里自己比路径
  const off = subscribeDocument(check);
  check();
  return off;
}

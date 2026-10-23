/**
 * 崩溃恢复：启动时检查有没有上次没保存完的改动。
 *
 * ## 判据
 *
 * 不是「有快照就提示」，而是「快照里**有内容还没落盘**才提示」：
 *
 * - 每一页的内容都和磁盘上的一样 → 保存成功过，快照只是残留 → 静默清掉，不打扰用户
 * - 有任何一页内容 != 磁盘上的内容 → 真的有没存下来的字 → 问用户要不要恢复
 *
 * 这一条判据同时兜住了「自动保存成功了但快照还没来得及清」这种情况：
 * 自动保存写盘成功后脏标记变 false，运行时就会清快照；
 * 但如果进程恰好在两者之间被杀，下次启动时快照还在——
 * 这时靠「内容相同就静默清掉」把它收拾掉，而不是弹一个假警报。
 *
 * ## 恢复的是整个会话
 *
 * 不是一份文本，是**所有标签页 + 当时激活的是哪一页**。
 * 用户开了五个页，崩了之后要能拿回五个，而不是一个。
 */

import { useSyncExternalStore } from "react";
import { importSession } from "@/ipc/document";
import { clearDraft, readDraft, type SessionSnapshot } from "./draft-store";

/** 一份值得提示用户恢复的会话 */
export interface RecoveryCandidate {
  /** 整个会话的快照 */
  session: SessionSnapshot;
  /** 崩溃前激活的是哪一页 */
  activeId: string;
  /** 崩溃前激活的那一页的标题 */
  title: string;
  /** 崩溃时间 */
  savedAt: number;
  /** 有多少页没保存下来 */
  unsavedCount: number;
}

/**
 * 找出一份值得提示用户恢复的会话。
 *
 * 返回 null = 没有要恢复的。
 */
export function findRecoveryCandidate(): RecoveryCandidate | null {
  const session = readDraft();
  if (!session || session.tabs.length === 0) return null;

  // 有没有哪一页的内容和「我们相信磁盘上是什么」不一样
  const unsaved = session.tabs.filter((tab) => tab.content !== tab.savedContent);
  if (unsaved.length === 0) {
    // 磁盘上已经是这些内容了：快照是残留，静默清掉
    clearDraft();
    return null;
  }

  const active =
    session.tabs.find((tab) => tab.id === session.activeId) ?? session.tabs[0];
  return {
    session,
    activeId: active.id,
    title: active.title,
    savedAt: session.savedAt,
    unsavedCount: unsaved.length,
  };
}

/**
 * 把会话恢复到编辑器里。
 *
 * 整体替换标签页列表：快照就是崩溃前那一刻的完整现场，
 * 合并会留下快照里没有的、当前进程里有的那些页。
 *
 * 恢复出来的内容标记为**未保存**，用户想存就存、想放弃就放弃。
 */
export function applyRecovery(candidate: RecoveryCandidate): void {
  importSession(candidate.session);
  clearCandidate();
}

/** 用户选择「丢弃」：清掉快照，让它不再出现 */
export function discardRecovery(): void {
  clearDraft();
  clearCandidate();
}

/* ── 候选的订阅（模块级 store） ── */

let candidate: RecoveryCandidate | null = findRecoveryCandidate();

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

function getSnapshot(): RecoveryCandidate | null {
  return candidate;
}

function clearCandidate() {
  if (!candidate) return;
  candidate = null;
  emit();
}

/**
 * 重新检查一次「有没有待恢复的会话」。
 *
 * 模块加载时算一次不够：应用启动那一刻快照可能还没写完，
 * 而���户可能是在**另一个标签页**里工作的。
 * App 挂载时调一次，之后就靠订阅。
 */
export function refreshRecoveryCandidate(): void {
  const next = findRecoveryCandidate();
  if (next === candidate) return;
  candidate = next;
  emit();
}

/**
 * 订阅「有一份待恢复的会话」。
 *
 * 候选在**模块加载时**算一次（那时读一次 localStorage 就行），
 * 而不是每次渲染都去读——`findRecoveryCandidate()` 有副作用
 * （内容与磁盘相同时会清掉快照），放在渲染期跑是不对的。
 */
export function useRecoveryCandidate(): RecoveryCandidate | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

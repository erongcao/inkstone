/**
 * 崩溃恢复：启动时检查有没有上次没保存完的改动。
 *
 * ## 判据
 *
 * 不是「有快照就提示」，而是「快照里的内容和磁盘上的**不一样**才提示」：
 *
 * - 快照内容 == 磁盘内容 → 保存成功过，快照只是残留 → 静默清掉，不打扰用户
 * - 快照内容 != 磁盘内容 → 真的有没存下来的字 → 问用户要不要恢复
 *
 * 这一条判据同时兜住了「自动保存成功了但快照还没来得及清」这种情况：
 * 自动保存写盘成功后脏标记变 false，运行时就会清快照；
 * 但如果进程恰好在两者之间被杀，下次启动时快照还在——
 * 这时靠「内容相同就静默清掉」把它收拾掉，而不是弹一个假警报。
 */

import {
  newDocument,
  openDocumentAt,
  readFileContent,
  setDocumentContent,
} from "@/ipc/document";
import { clearDraft, readDraft } from "./draft-store";

/** 一份值得提示用户恢复的草稿 */
export interface RecoveryCandidate {
  /** 文档路径；null = 未命名草稿 */
  path: string | null;
  /** 展示用标题 */
  title: string;
  /** 草稿里的内容 */
  content: string;
  /** 快照写入时刻 */
  savedAt: number;
  /** 磁盘上的内容；null = 读不到（文件被删了 / 移动了） */
  diskContent: string | null;
}

/**
 * 找出一份值得提示用户恢复的草稿。
 *
 * 返回 null = 没有要恢复的。
 */
export async function findRecoveryCandidate(): Promise<RecoveryCandidate | null> {
  const draft = readDraft();
  if (!draft || draft.content === "") return null;

  if (draft.path === null) {
    // 未命名草稿没有「磁盘版本」可比，只能一律交给用户判断
    return {
      path: null,
      title: draft.title,
      content: draft.content,
      savedAt: draft.savedAt,
      diskContent: null,
    };
  }

  let diskContent: string | null;
  try {
    diskContent = await readFileContent(draft.path);
  } catch {
    // 读不到（文件被删了、权限变了、移动了）→ 当成「磁盘上没有这份内容」
    diskContent = null;
  }

  if (diskContent !== null && diskContent === draft.content) {
    // 磁盘上已经是这份内容了：快照是残留，静默清掉
    clearDraft();
    return null;
  }

  return {
    path: draft.path,
    title: draft.title,
    content: draft.content,
    savedAt: draft.savedAt,
    diskContent,
  };
}

/**
 * 把草稿恢复到编辑器里。
 *
 * 顺序是「先打开磁盘版本，再盖上草稿内容」——
 * 这样打开动作（读文件、设标题、树根跟随）都按磁盘上的真实文件走，
 * 而恢复出来的内容标记为**未保存**，用户想存就存、想放弃就放弃。
 */
export async function applyRecovery(candidate: RecoveryCandidate): Promise<void> {
  if (candidate.path) {
    await openDocumentAt(candidate.path);
  } else {
    newDocument();
  }
  // 盖上草稿内容：此时 savedContent 是磁盘上的内容，所以 dirty 会变 true
  setDocumentContent(candidate.content);
}

/** 用户选择「丢弃」：清掉快照，让它不再出现 */
export function discardRecovery(): void {
  clearDraft();
}

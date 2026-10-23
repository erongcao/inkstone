/**
 * 自动保存 + 崩溃恢复的运行时。
 *
 * 两件事，时机不同，别混：
 *
 * | | 目的 | 时机 | 失败时 |
 * |---|---|---|---|
 * | 自动保存 | 让磁盘上的文件追上手上的内容 | **防抖**：停手 `interval` 毫秒后写一次 | 写进 `saveError`，状态栏显示 |
 * | 崩溃恢复 | 机器崩了之后把字捞回来 | **节流**：最多每 2 秒写一次快照 | 写进 `recoveryError`，状态栏显示 |
 *
 * ## 为什么一个是防抖、一个是节流
 *
 * 防抖（停手才做）适合写磁盘：用户正在连着敲的时候反复写盘是白费力气，
 * 而且写盘的时机往往不是用户关心的。
 *
 * 节流（定期做）适合写快照：快照的目的就是「随时能捞回来」，
 * 如果也用防抖，用户连续敲十分钟不停手，快照就十分钟没更新——
 * 那时候崩了，前面十分钟的字一个都找不回来。
 *
 * ## 为什么自动保存只对「有路径」的文档有效
 *
 * 未命名草稿没有落盘目标。给它自动保存要么得弹「另存为」（打断写作），
 * 要么得替用户造一个文件名（用户会莫名其妙多出一个文件）。
 * 两种都不对，所以不保存——但**崩溃恢复快照照样写**，
 * 未命名草稿恰恰是最需要崩溃恢复的那一种。
 *
 * ## 存的是整个会话，不只是当前那一页
 *
 * 用户开了五个标签页时，崩溃恢复的答案必须是「五个都在」。
 * 只存当前页的话，另外四页的未保存内容就凭空消失了——
 * 那不是恢复，是部分恢复。
 */

import { readSettings } from "@/settings/store";
import {
  exportSession,
  externallyChangedTabIds,
  getTabs,
  saveTab,
  setRecoveryError,
  subscribeDocument,
} from "@/ipc/document";
import { clearDraft, writeDraft } from "./draft-store";

/** 崩溃恢复快照的写入节流间隔 */
const DRAFT_THROTTLE_MS = 2000;

/**
 * 节流：每 `interval` 毫秒最多真正执行一次。
 *
 * 首次调用立刻执行；之后的调用合并起来，在下一个窗口末尾执行一次。
 *
 * 与防抖的区别：防抖是「停手才执行」，节流是「最多隔这么久执行一次」。
 * 崩溃恢复要的是后者——它要的是「最多丢这么多」，不是「停手才记」。
 */
export function createThrottle(
  fn: () => void,
  interval: number,
): { call: () => void; cancel: () => void } {
  let lastRun = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;

  const run = () => {
    lastRun = Date.now();
    pending = false;
    fn();
  };

  return {
    call() {
      const elapsed = Date.now() - lastRun;
      if (elapsed >= interval) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        run();
        return;
      }
      pending = true;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        if (pending) run();
      }, interval - elapsed);
    },
    cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pending = false;
    },
  };
}

/**
 * 启动自动保存 + 崩溃恢复运行时。
 *
 * 返回一个停止函数。组件卸载时调用它，否则定时器会泄漏。
 */
export function startAutoSaveRuntime(): () => void {
  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

  const cancelAutoSave = () => {
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = null;
    }
  };

  const draftWriter = createThrottle(() => {
    const error = writeDraft(exportSession());
    // 写不进去要说出来：「以为有崩溃恢复其实没有」比「没有崩溃恢复」危险得多
    setRecoveryError(error);
  }, DRAFT_THROTTLE_MS);

  const stop = subscribeDocument(() => {
    // 全部标签页都已落盘 → 快照没有存在意义了
    if (!hasUnsaved()) {
      cancelAutoSave();
      draftWriter.cancel();
      clearDraft();
      setRecoveryError(null);
      return;
    }

    // 崩溃恢复快照：无论自动保存开没开，都要写
    draftWriter.call();

    const settings = readSettings();
    if (!settings.general.autoSave) return;
    cancelAutoSave();
    autoSaveTimer = setTimeout(() => {
      autoSaveTimer = null;
      void saveAllDirtyTabs();
    }, settings.general.autoSaveInterval);
  });

  return () => {
    stop();
    cancelAutoSave();
    draftWriter.cancel();
  };
}

/** 是否有任何一个标签页还没落盘 */
function hasUnsaved(): boolean {
  return getTabs().some((tab) => tab.dirty);
}

/**
 * 把所有还有未保存改动的标签页写到磁盘。
 *
 * 逐个存而不是只存当前页：用户切到别页之后，当前页的改动同样要落盘，
 * 不能等到它被切回来时才存。
 */
export async function saveAllDirtyTabs(): Promise<void> {
  const blocked = externallyChangedTabIds();
  for (const tab of getTabs()) {
    if (!tab.dirty || !tab.path) continue;
    // 外部改动还没解决的那一页跳过：写下去就是把对方的改动无声抹掉
    if (blocked.has(tab.id)) continue;
    await saveTab(tab.id);
  }
}

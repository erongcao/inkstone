/**
 * 自动保存 + 崩溃恢复的测试。
 *
 * 这里测的是三件容易做错、而且错了会**丢数据**的事：
 * 1. 脏标记以「磁盘上的内容」为准，不是「上一次的内容」
 * 2. 落盘期间用户又改了内容时，脏标记不能被清掉
 * 3. 崩溃恢复快照的节流与清理时机
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getDocumentState,
  getTabs,
  openDocumentAt,
  resetTabs,
  saveDocument,
  setDocumentContent,
  subscribeDocument,
} from "@/ipc/document";
import { createThrottle, startAutoSaveRuntime } from "@/document/autosave";
import { clearDraft, readDraft, writeDraft } from "@/document/draft-store";
import {
  applyRecovery,
  discardRecovery,
  findRecoveryCandidate,
} from "@/document/recovery";
import { updateSettings } from "@/settings/store";
import { SAMPLE_CONTENTS, SAMPLE_ROOT } from "@/ipc/fs";

const README = `${SAMPLE_ROOT}/README.md`;

describe("脏标记：以磁盘上的内容为准", () => {
  beforeEach(() => {
    resetTabs();
  });

  it("改一个字 → 脏", async () => {
    await openDocumentAt(README);
    setDocumentContent(SAMPLE_CONTENTS[README] + "新的一行");
    expect(getDocumentState().dirty).toBe(true);
  });

  it("改完再改回磁盘上的样子 → 不脏（不能拿『上一次的内容』比）", async () => {
    await openDocumentAt(README);
    const original = SAMPLE_CONTENTS[README];

    setDocumentContent(original + "临时");
    expect(getDocumentState().dirty).toBe(true);

    setDocumentContent(original);
    expect(getDocumentState().dirty).toBe(false);
  });

  it("保存成功后脏标记清掉", async () => {
    await openDocumentAt(README);
    setDocumentContent("改过的内容");
    expect(getDocumentState().dirty).toBe(true);

    await saveDocument();
    expect(getDocumentState().dirty).toBe(false);
  });
});

describe("保存竞态：落盘期间内容又变了", () => {
  it("不能把还没保存的新改动标成已保存", async () => {
    await openDocumentAt(README);

    // 第一次内容
    setDocumentContent("第一次改的内容");
    const firstSave = saveDocument();

    // 落盘的 await 还没回来时，用户又敲了字
    setDocumentContent("第二次改的内容");

    await firstSave;

    // 关键断言：第二次的改动还没落盘，脏标记必须还在
    expect(getDocumentState().dirty).toBe(true);
  });
});

describe("自动保存", () => {
  let stop: (() => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    updateSettings({ general: { autoSave: true, autoSaveInterval: 50 } });
    stop = startAutoSaveRuntime();
  });

  afterEach(() => {
    stop?.();
    stop = null;
    vi.useRealTimers();
    resetTabs();
  });

  it("停手够久就自动保存（脏标记自己变干净）", async () => {
    await openDocumentAt(README);
    setDocumentContent("自动保存的内容");
    expect(getDocumentState().dirty).toBe(true);

    await vi.advanceTimersByTimeAsync(120);

    expect(getDocumentState().dirty).toBe(false);
  });

  it("一直不停手就一直不保存（防抖，不是节流）", async () => {
    await openDocumentAt(README);
    for (let i = 0; i < 5; i++) {
      setDocumentContent(`内容 ${i}`);
      await vi.advanceTimersByTimeAsync(30);
    }
    // 30ms < 50ms 间隔，每次都把定时器推后
    expect(getDocumentState().dirty).toBe(true);

    await vi.advanceTimersByTimeAsync(120);
    expect(getDocumentState().dirty).toBe(false);
  });

  it("关掉自动保存就不保存", async () => {
    updateSettings({ general: { autoSave: false } });
    await openDocumentAt(README);
    setDocumentContent("不该被自动保存的内容");

    await vi.advanceTimersByTimeAsync(300);

    expect(getDocumentState().dirty).toBe(true);
  });

  it("未命名草稿不自动保存（没有落盘目标）", async () => {
    resetTabs();
    setDocumentContent("未命名草稿的内容");

    await vi.advanceTimersByTimeAsync(300);

    expect(getDocumentState().dirty).toBe(true);
  });
});

describe("崩溃恢复快照", () => {
  let stop: (() => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    updateSettings({ general: { autoSave: false, autoSaveInterval: 50 } });
    clearDraft();
    stop = startAutoSaveRuntime();
  });

  afterEach(() => {
    stop?.();
    stop = null;
    vi.useRealTimers();
    resetTabs();
    clearDraft();
  });

  it("内容变了就写快照", async () => {
    await openDocumentAt(README);
    setDocumentContent("崩溃前的最后一句话");

    await vi.advanceTimersByTimeAsync(10);

    const draft = readDraft();
    expect(draft).not.toBeNull();
    expect(draft?.tabs[0]?.content).toBe("崩溃前的最后一句话");
    expect(draft?.tabs[0]?.path).toBe(README);
  });

  it("节流：连续改动不会每次都写", async () => {
    await openDocumentAt(README);
    const writes: number[] = [];
    const original = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === "inkstone.draft.v1") writes.push(Date.now());
      return original.call(this, key, value);
    });

    for (let i = 0; i < 10; i++) {
      setDocumentContent(`内容 ${i}`);
      await vi.advanceTimersByTimeAsync(300);
    }
    spy.mockRestore();

    // 300ms 一个窗口，10 次改动最多写 2 次（首 + 末），远少于 10 次
    expect(writes.length).toBeLessThanOrEqual(3);
    expect(writes.length).toBeGreaterThan(0);
  });

  it("落盘成功后快照被清掉（磁盘上已经有这份内容了）", async () => {
    await openDocumentAt(README);
    setDocumentContent("要存的内容");
    await vi.advanceTimersByTimeAsync(10);
    expect(readDraft()).not.toBeNull();

    await saveDocument();
    await vi.advanceTimersByTimeAsync(10);

    expect(readDraft()).toBeNull();
  });

  it("未命名草稿也要写快照（恰恰是最需要恢复的那一种）", async () => {
    resetTabs();
    setDocumentContent("没命名的草稿");

    await vi.advanceTimersByTimeAsync(10);

    const draft = readDraft();
    expect(draft?.tabs[0]?.path).toBeNull();
    expect(draft?.tabs[0]?.content).toBe("没命名的草稿");
  });
});

describe("恢复检查", () => {
  /** 写一份会话快照 */
  function writeSession(
    tabs: { id: string; path: string | null; title: string; content: string; savedContent: string }[],
    activeId = tabs[0]?.id ?? "",
  ) {
    writeDraft({ tabs, activeId, savedAt: Date.now() });
  }

  beforeEach(() => {
    clearDraft();
  });

  it("没有快照 → 没有可恢复的", () => {
    expect(findRecoveryCandidate()).toBeNull();
  });

  it("快照内容 == 磁盘内容 → 静默清掉，不打扰用户", () => {
    writeSession([
      {
        id: "t1",
        path: README,
        title: "README",
        content: SAMPLE_CONTENTS[README],
        savedContent: SAMPLE_CONTENTS[README],
      },
    ]);

    expect(findRecoveryCandidate()).toBeNull();
    expect(readDraft()).toBeNull();
  });

  it("快照内容 != 磁盘内容 → 给出候选", () => {
    writeSession([
      {
        id: "t1",
        path: README,
        title: "README",
        content: "用户在崩溃前敲进去的字",
        savedContent: SAMPLE_CONTENTS[README],
      },
    ]);

    const candidate = findRecoveryCandidate();
    expect(candidate).not.toBeNull();
    expect(candidate?.session.tabs[0].content).toBe("用户在崩溃前敲进去的字");
    expect(candidate?.unsavedCount).toBe(1);
  });

  it("未命名草稿也给候选（没有磁盘版本可比）", () => {
    writeSession([
      { id: "t1", path: null, title: "未命名", content: "无名草稿", savedContent: "" },
    ]);

    const candidate = findRecoveryCandidate();
    expect(candidate?.session.tabs[0].path).toBeNull();
    expect(candidate?.unsavedCount).toBe(1);
  });

  it("多个标签页：没保存的页数要数清楚", () => {
    writeSession([
      {
        id: "t1",
        path: README,
        title: "README",
        content: "改过的",
        savedContent: SAMPLE_CONTENTS[README],
      },
      {
        id: "t2",
        path: null,
        title: "未命名",
        content: "也改过的",
        savedContent: "",
      },
      {
        id: "t3",
        path: null,
        title: "另一个",
        content: "没改过",
        savedContent: "没改过",
      },
    ]);

    const candidate = findRecoveryCandidate();
    expect(candidate?.unsavedCount).toBe(2);
    expect(candidate?.session.tabs).toHaveLength(3);
  });

  it("恢复：内容回到编辑器，且仍是未保存状态", () => {
    writeSession([
      {
        id: "t1",
        path: README,
        title: "README",
        content: "恢复出来的内容",
        savedContent: SAMPLE_CONTENTS[README],
      },
    ]);
    const found = findRecoveryCandidate();
    expect(found).not.toBeNull();

    applyRecovery(found!);

    const state = getDocumentState();
    expect(state.content).toBe("恢复出来的内容");
    expect(state.path).toBe(README);
    // 磁盘上还是旧内容 → 必须还是脏的
    expect(state.dirty).toBe(true);
  });

  it("恢复：多个标签页一起回来", () => {
    writeSession([
      {
        id: "t1",
        path: README,
        title: "README",
        content: "第一页的内容",
        savedContent: SAMPLE_CONTENTS[README],
      },
      {
        id: "t2",
        path: null,
        title: "未命名",
        content: "第二页的内容",
        savedContent: "",
      },
    ]);
    const found = findRecoveryCandidate();
    applyRecovery(found!);

    expect(getTabs()).toHaveLength(2);
    expect(getDocumentState().content).toBe("第一页的内容");
  });

  it("丢弃：快照被清掉，下次启动不再问", () => {
    writeSession([
      {
        id: "t1",
        path: README,
        title: "README",
        content: "不要了",
        savedContent: SAMPLE_CONTENTS[README],
      },
    ]);
    discardRecovery();
    expect(readDraft()).toBeNull();
    expect(findRecoveryCandidate()).toBeNull();
  });
});

describe("节流器", () => {
  it("首次立刻执行，之后合并到窗口末尾", () => {
    vi.useFakeTimers();
    let count = 0;
    const throttle = createThrottle(() => {
      count += 1;
    }, 100);

    throttle.call();
    expect(count).toBe(1);

    throttle.call();
    throttle.call();
    expect(count).toBe(1);

    vi.advanceTimersByTime(100);
    expect(count).toBe(2);

    vi.useRealTimers();
  });

  it("cancel 之后不再补执行", () => {
    vi.useFakeTimers();
    let count = 0;
    const throttle = createThrottle(() => {
      count += 1;
    }, 100);

    throttle.call();
    throttle.call();
    throttle.cancel();
    vi.advanceTimersByTime(500);

    expect(count).toBe(1);
    vi.useRealTimers();
  });
});

describe("订阅：状态变化要能通知到", () => {
  it("改内容会触发订阅", () => {
    let hits = 0;
    const off = subscribeDocument(() => {
      hits += 1;
    });
    setDocumentContent("改一下");
    off();
    expect(hits).toBeGreaterThan(0);
  });
});

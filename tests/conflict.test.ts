/**
 * 外部修改检测与冲突处理的测试。
 *
 * 三条主线：
 * 1. 磁盘内容和我们知道的一样 → 什么都不做（那多半是我们自己刚存的）
 * 2. 磁盘内容不一样 + 本地没改动 → 静默跟着磁盘走
 * 3. 磁盘内容不一样 + 本地有改动 → 冲突，问用户；且冲突没解决前自动保存是停的
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as documentModule from "@/ipc/document";
import {
  getDocumentState,
  markExternalChange,
  openDocumentAt,
  resetTabs,
  setDocumentContent,
} from "@/ipc/document";
import {
  getConflict,
  handleExternalChange,
  resolveKeepLocal,
  resolveWithDisk,
} from "@/document/conflict";
import { startAutoSaveRuntime } from "@/document/autosave";
import { updateSettings } from "@/settings/store";
import { SAMPLE_CONTENTS, SAMPLE_ROOT } from "@/ipc/fs";

const README = `${SAMPLE_ROOT}/README.md`;

/** 让「磁盘上的内容」变成我们想要的样子 */
function diskContentIs(content: string) {
  vi.spyOn(documentModule, "readFileContent").mockResolvedValue(content);
}

describe("外部修改检测", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetTabs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetTabs();
  });

  it("路径不是当前文档 → 不管", async () => {
    await openDocumentAt(README);
    diskContentIs("完全不同的内容");

    await handleExternalChange("/别的文件.md");

    expect(getConflict()).toBeNull();
    expect(getDocumentState().content).toBe(SAMPLE_CONTENTS[README]);
  });

  it("磁盘内容和我们知道的一样 → 不算冲突（那是我们自己刚存的）", async () => {
    await openDocumentAt(README);
    diskContentIs(SAMPLE_CONTENTS[README]);
    setDocumentContent("本地改的内容");

    await handleExternalChange(README);

    expect(getConflict()).toBeNull();
    expect(getDocumentState().content).toBe("本地改的内容");
  });

  it("磁盘变了 + 本地没改动 → 静默跟着磁盘走", async () => {
    await openDocumentAt(README);
    diskContentIs("外部改过的内容");

    await handleExternalChange(README);

    expect(getConflict()).toBeNull();
    const state = getDocumentState();
    expect(state.content).toBe("外部改过的内容");
    expect(state.dirty).toBe(false);
    expect(state.notice).toContain("外部更新");
  });

  it("磁盘变了 + 本地有改动 → 冲突", async () => {
    await openDocumentAt(README);
    diskContentIs("外部改过的内容");
    setDocumentContent("我本地写的内容");

    await handleExternalChange(README);

    const conflict = getConflict();
    expect(conflict).not.toBeNull();
    expect(conflict?.diskContent).toBe("外部改过的内容");
    expect(conflict?.localContent).toBe("我本地写的内容");
    // 自动保存要因此停住
    expect(getDocumentState().externalChange).toBe(true);
  });
});

describe("冲突的两种选择", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    resetTabs();
    await openDocumentAt(README);
    diskContentIs("外部改过的内容");
    setDocumentContent("我本地写的内容");
    await handleExternalChange(README);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetTabs();
  });

  it("用磁盘版本 → 内容换成磁盘那份，不再是脏的", () => {
    resolveWithDisk();

    const state = getDocumentState();
    expect(state.content).toBe("外部改过的内容");
    expect(state.dirty).toBe(false);
    expect(state.externalChange).toBe(false);
    expect(getConflict()).toBeNull();
  });

  it("保留我的版本 → 本地内容不动，但自动保存继续暂停", () => {
    resolveKeepLocal();

    const state = getDocumentState();
    expect(state.content).toBe("我本地写的内容");
    expect(state.dirty).toBe(true);
    // 外部改动还没合进来 → 自动保存必须还停着
    expect(state.externalChange).toBe(true);
    expect(getConflict()).toBeNull();
  });
});

describe("外部改动未解决时，自动保存不写", () => {
  let stop: (() => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.restoreAllMocks();
    updateSettings({ general: { autoSave: true, autoSaveInterval: 50 } });
    stop = startAutoSaveRuntime();
  });

  afterEach(() => {
    stop?.();
    stop = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
    resetTabs();
  });

  it("有外部改动时自动保存不落盘", async () => {
    await openDocumentAt(README);
    markExternalChange();
    setDocumentContent("有外部改动时的内容");

    await vi.advanceTimersByTimeAsync(300);

    expect(getDocumentState().dirty).toBe(true);
  });

  it("外部改动解除后自动保存恢复", async () => {
    await openDocumentAt(README);
    markExternalChange();
    setDocumentContent("先被挡住的内容");
    await vi.advanceTimersByTimeAsync(300);
    expect(getDocumentState().dirty).toBe(true);

    // 用户明确保存 → 外部改动标记解除
    await documentModule.saveDocument();
    expect(getDocumentState().externalChange).toBe(false);

    setDocumentContent("之后的新内容");
    await vi.advanceTimersByTimeAsync(300);
    expect(getDocumentState().dirty).toBe(false);
  });
});

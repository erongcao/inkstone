/**
 * 设置存储与版本迁移测试。
 *
 * 迁移逻辑必须显式测，因为「深合并」不会自动清理旧字段：
 * 设置项从布尔改成枚举后，老用户 localStorage 里会同时躺着两个字段。
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const STORAGE_KEY = "inkstone.settings.v1";

describe("设置版本迁移", () => {
  beforeEach(() => {
    localStorage.clear();
    // 迁移发生在模块加载时（state 初始化），所以必须让模块重新加载
    vi.resetModules();
  });

  it("旧版本的 autoPair=true 迁移成 markdown 级", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ editor: { autoPair: true } }));
    const { useSettings } = await import("@/settings/store");
    const { result } = renderHook(() => useSettings());
    expect(result.current[0].editor.autoPairMode).toBe("markdown");
  });

  it("旧版本的 autoPair=false 迁移成 off 级", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ editor: { autoPair: false } }));
    const { useSettings } = await import("@/settings/store");
    const { result } = renderHook(() => useSettings());
    expect(result.current[0].editor.autoPairMode).toBe("off");
  });

  it("迁移后旧的 autoPair 字段不再残留", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ editor: { autoPair: true } }));
    const { useSettings, updateSettings } = await import("@/settings/store");
    const { result } = renderHook(() => useSettings());
    expect("autoPair" in result.current[0].editor).toBe(false);

    // 触发一次写入，确认持久化出去的内容里也没有旧字段。
    // 写的是 `editor` 分节里**真实存在**的设置——`fontSize` 在 `appearance` 分节，
    // 写进 `editor` 会往持久化内容里塞一个 schema 里没有的键。
    updateSettings({ editor: { spellCheck: false } });
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(persisted.editor.autoPair).toBeUndefined();
    expect(persisted.editor.autoPairMode).toBe("markdown");
  });

  it("新配置已经写明 autoPairMode 时不再被旧字段覆盖", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ editor: { autoPair: true, autoPairMode: "basic" } }),
    );
    const { useSettings } = await import("@/settings/store");
    const { result } = renderHook(() => useSettings());
    expect(result.current[0].editor.autoPairMode).toBe("basic");
  });

  it("没有历史配置时用默认值", async () => {
    const { useSettings } = await import("@/settings/store");
    const { result } = renderHook(() => useSettings());
    expect(result.current[0].editor.autoPairMode).toBe("markdown");
    expect(result.current[0].editor.markerDisplay).toBe("live");
  });
});

/**
 * 字体设置的迁移。
 *
 * ## 为什么要迁移
 *
 * 旧默认值是**具体的字体栈**，不是「没设置」。
 * 不迁移的话：老用户存着那个栈 → 迁移后仍然是「设置过的字体」→
 * 主题声明的字体（学术主题的衬线体）对他们依然不生效，
 * 而新装的用户是生效的——**同一版本里两拨人表现不一样**。
 *
 * 判据是「恰好等于旧默认值」：用户自己填了别的字体，那是他的选择，不动。
 */
describe("字体设置的迁移", () => {
  /** 旧版的正文字体默认值（历史事实，不能跟着代码改） */
  const LEGACY_FONT =
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';

  /** 旧版的等宽字体默认值 */
  const LEGACY_MONO =
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("旧默认正文字体被当作「没设过」（迁移成空串 = 跟随主题）", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ appearance: { fontFamily: LEGACY_FONT } }),
    );
    const { useSettings } = await import("@/settings/store");
    const { result } = renderHook(() => useSettings());
    expect(result.current[0].appearance.fontFamily).toBe("");
  });

  it("旧默认等宽字体同样被当作「没设过」", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ appearance: { monoFontFamily: LEGACY_MONO } }),
    );
    const { useSettings } = await import("@/settings/store");
    const { result } = renderHook(() => useSettings());
    expect(result.current[0].appearance.monoFontFamily).toBe("");
  });

  it("用户自己填的字体不被迁移掉", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ appearance: { fontFamily: "MyOwnFont, sans-serif" } }),
    );
    const { useSettings } = await import("@/settings/store");
    const { result } = renderHook(() => useSettings());
    expect(result.current[0].appearance.fontFamily).toBe("MyOwnFont, sans-serif");
  });

  it("新装的用户默认就是空串（跟随主题）", async () => {
    const { useSettings } = await import("@/settings/store");
    const { result } = renderHook(() => useSettings());
    expect(result.current[0].appearance.fontFamily).toBe("");
    expect(result.current[0].appearance.monoFontFamily).toBe("");
  });

  it("从磁盘灌入的旧配置也走迁移", async () => {
    // 打包版走 Tauri store 那条路（hydrateSettings），
    // 漏掉迁移的话：开发时是对的、打包后是错的——只在发布后复现。
    const { hydrateSettings, readSettings } = await import("@/settings/store");
    hydrateSettings({ appearance: { fontFamily: LEGACY_FONT } });
    expect(readSettings().appearance.fontFamily).toBe("");
  });
});

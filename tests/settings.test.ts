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

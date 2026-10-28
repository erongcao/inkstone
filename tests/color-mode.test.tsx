/**
 * 「跟随系统外观」这个开关：它曾经是**死的**。
 *
 * ## 为什么要有这条守卫
 *
 * 2026-10-28 实测枚举过 12 种输入组合
 * （`colorMode` × `followSystem` × `systemPrefersDark`），
 * `followSystem` **一次都没改变过结果**——
 * 因为 `resolveColorMode` 里两个 `"auto"` 分支返回的是同一个值。
 *
 * 这类破口的特点是「不报错、不崩溃、只是没发生」，
 * 所以守卫必须盯住**开关真的改变了结果**，
 * 而不是「代码里读了这个参数」。
 *
 * ## 三条腿都要
 *
 * 1. **解析层**：开关开 / 关，结果确实不同（两边都验）
 * 2. **界面层**：开关打开时，「明暗模式」下拉框是**置灰**的
 *    ——不然用户选了「亮色」发现没反应，又变成一个骗人的控件
 * 3. **迁移层**：旧版那个死开关的 `true` **不带用户意图**，
 *    迁移时要按 `false` 处理；但用户**升级后主动打开**的值必须留得住
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, fireEvent } from "@testing-library/react";
import { resolveColorMode } from "@/theme/themes";
import { readSettings, resetSettings, updateSettings } from "@/settings/store";
import { SettingsPanel } from "@/views/SettingsPanel";

const STORAGE_KEY = "inkstone.settings.v1";

beforeEach(() => {
  localStorage.clear();
  resetSettings();
});

describe("解析层：这个开关真的改变结果", () => {
  it("打开时强制跟随系统（无视下拉框选了什么）", () => {
    // 下拉框选了「亮色」，但开关打开 → 仍然是暗色（系统是暗的）
    expect(resolveColorMode("light", true, true)).toBe("dark");
    expect(resolveColorMode("dark", true, false)).toBe("light");
  });

  it("关掉时由下拉框决定", () => {
    expect(resolveColorMode("light", false, true)).toBe("light");
    expect(resolveColorMode("dark", false, false)).toBe("dark");
  });

  it("关掉 + 下拉框选「跟随系统」= 跟系统", () => {
    expect(resolveColorMode("auto", false, true)).toBe("dark");
    expect(resolveColorMode("auto", false, false)).toBe("light");
  });

  it("自检：这组断言真的在区分两种情况（别对着空集假绿）", () => {
    // 同一个 colorMode，只改开关，结果必须不同——
    // 否则上面的断言根本区分不出「开关生效」与「开关没生效」。
    expect(resolveColorMode("light", true, true)).not.toBe(
      resolveColorMode("light", false, true),
    );
    expect(resolveColorMode("dark", true, false)).not.toBe(
      resolveColorMode("dark", false, false),
    );
  });

  it("穷举：开关打开时结果只跟系统偏好有关", () => {
    for (const colorMode of ["auto", "light", "dark"] as const) {
      expect(resolveColorMode(colorMode, true, true)).toBe("dark");
      expect(resolveColorMode(colorMode, true, false)).toBe("light");
    }
  });
});

describe("界面层：开关打开时下拉框置灰", () => {
  it("打开时「明暗模式」下拉框是禁用的", () => {
    updateSettings({ appearance: { followSystemAppearance: true } });
    render(<SettingsPanel onClose={() => {}} />);
    const select = screen.getByDisplayValue("跟随系统") as HTMLSelectElement;
    expect(select.disabled).toBe(true);
  });

  it("关掉时「明暗模式」下拉框可用", () => {
    updateSettings({ appearance: { followSystemAppearance: false } });
    render(<SettingsPanel onClose={() => {}} />);
    const select = screen.getByDisplayValue("跟随系统") as HTMLSelectElement;
    expect(select.disabled).toBe(false);
  });

  it("点开复选框，下拉框当场变灰（不是只在启动时算一次）", () => {
    updateSettings({ appearance: { followSystemAppearance: false } });
    render(<SettingsPanel onClose={() => {}} />);
    const select = screen.getByDisplayValue("跟随系统") as HTMLSelectElement;
    expect(select.disabled).toBe(false);

    const box = screen.getByRole("checkbox", {
      name: "跟随系统外观",
    }) as HTMLInputElement;
    fireEvent.click(box);

    expect((screen.getByDisplayValue("跟随系统") as HTMLSelectElement).disabled).toBe(
      true,
    );
    expect(readSettings().appearance.followSystemAppearance).toBe(true);
  });
});

describe("迁移层：旧值不带意图，但新值留得住", () => {
  /** 模拟「老用户的设置文件」——没有版本号，且那个开关存着 true */
  function seedLegacyFile(appearance: Record<string, unknown>) {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ appearance: { colorMode: "auto", ...appearance } }),
    );
  }

  it("旧文件里的 true 被当作 false（老用户的亮色/暗色不被顶掉）", async () => {
    seedLegacyFile({ followSystemAppearance: true, colorMode: "light" });
    // 重新加载模块 → 走一遍读盘 + 迁移
    vi.resetModules();
    const store = await import("@/settings/store");
    expect(store.readSettings().appearance.followSystemAppearance).toBe(false);
    // 明暗模式保持用户选的那个
    expect(store.readSettings().appearance.colorMode).toBe("light");
  });

  it("迁移之后版本号写进文件，迁移不再重跑", async () => {
    seedLegacyFile({ followSystemAppearance: true });
    vi.resetModules();
    const store = await import("@/settings/store");
    store.updateSettings({ appearance: { fontSize: 18 } });
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(raw.__v).toBe(4);
  });

  it("用户升级后主动打开开关，值留得住（不会被迁回去）", async () => {
    seedLegacyFile({ followSystemAppearance: true });
    vi.resetModules();
    const store = await import("@/settings/store");

    // 升级后用户主动打开
    store.updateSettings({ appearance: { followSystemAppearance: true } });
    expect(store.readSettings().appearance.followSystemAppearance).toBe(true);

    // 再启动一次（重新读盘 + 迁移）
    vi.resetModules();
    const reloaded = await import("@/settings/store");
    expect(reloaded.readSettings().appearance.followSystemAppearance).toBe(true);
  });
});

/**
 * 「置灰」是**给人看的信号**，不只是 DOM 属性。
 *
 * `.field select` 的样式里原本**没有** `:disabled` 变体——
 * 于是被置灰的下拉框看起来和能用的**一模一样**，
 * 用户只能点了没反应才发现它点不动。
 *
 * 所以这里查的是**运行时算出来的样式**：
 * 注入真实样式表，读禁用控件与可用控件的 computed opacity，
 * 两者必须**不一样**。
 */
describe("置灰要真的看得见", () => {
  it("禁用与可用的下拉框在视觉上不一样", () => {
    const css = readFileSync(join(process.cwd(), "src/styles/components.css"), "utf8");
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);

    const mk = (disabled: boolean) => {
      const wrap = document.createElement("div");
      wrap.className = "field";
      const select = document.createElement("select");
      select.disabled = disabled;
      wrap.appendChild(select);
      document.body.appendChild(wrap);
      return select;
    };

    const enabled = mk(false);
    const disabled = mk(true);

    const enabledOpacity = getComputedStyle(enabled).opacity;
    const disabledOpacity = getComputedStyle(disabled).opacity;

    expect(disabledOpacity).not.toBe(enabledOpacity);
    // 明确是「变淡」而不是别的变化
    expect(Number(disabledOpacity)).toBeLessThan(Number(enabledOpacity));
    expect(getComputedStyle(disabled).cursor).toBe("not-allowed");
  });
});

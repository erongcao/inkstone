/**
 * 设置面板的 Markdown 分区。
 *
 * ## 为什么单独测这一块
 *
 * 这一分区的开关分成两类：
 *
 *   - **真的接了线的**：表格、任务列表、脚注、高亮、公式……
 *     勾上就生效，关掉就不认那个语法（见 `tests/features.test.ts`）。
 *   - **还没做的**：`autoNumberEquations`（公式自动编号）与
 *     `subscriptSuperscript`（下标 / 上标）。
 *
 * 第二类必须**置灰并写明原因**。
 *
 * 为什么不能只是「置灰」：一个点不动的复选框，用户只会当成 bug——
 * 他不知道是程序坏了，还是这个功能本来就没做。
 * 写清楚了，他才好决定是等还是绕开。
 *
 * 为什么不能「假装能做」：这两个开关对应的功能**确实不存在**
 * （`autoNumberEquations` 的默认值是 `false`，代码里压根没有编号逻辑；
 * `subscriptSuperscript` 是编辑器认得、导出不认，两边会不一致）。
 * 勾上去却不生效，就是「设置里的参数不接到请求上」——**摆设**。
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { SettingsPanel } from "@/views/SettingsPanel";
import { resetSettings } from "@/settings/store";

/** 取出 Markdown 分区里所有开关（复选框）与其标签 */
function markdownToggles(container: HTMLElement): {
  label: string;
  disabled: boolean;
  note: string | null;
}[] {
  const section = Array.from(container.querySelectorAll(".settings-group")).find((node) =>
    node.querySelector("h3")?.textContent === "Markdown",
  );
  if (!section) return [];
  return Array.from(section.querySelectorAll("label.field")).map((label) => ({
    label: label.querySelector("span")?.textContent ?? "",
    disabled: (label.querySelector("input") as HTMLInputElement | null)?.disabled ?? false,
    note: label.querySelector(".field__note")?.textContent ?? null,
  }));
}

describe("设置面板：Markdown 分区", () => {
  beforeEach(() => {
    cleanup();
    resetSettings();
  });
  afterEach(() => {
    cleanup();
    resetSettings();
  });

  it("13 个开关一个不少", () => {
    const { container } = render(<SettingsPanel onClose={() => {}} initialSection="markdown" />);
    expect(markdownToggles(container)).toHaveLength(13);
  });

  it("还没做的两个开关是置灰的", () => {
    const { container } = render(<SettingsPanel onClose={() => {}} initialSection="markdown" />);
    const toggles = markdownToggles(container);
    const pending = toggles.filter((t) => t.disabled).map((t) => t.label);
    expect(pending).toEqual(["公式自动编号", "下标 / 上标"]);
  });

  it("置灰的开关写明了原因（不是默默点不动）", () => {
    const { container } = render(<SettingsPanel onClose={() => {}} initialSection="markdown" />);
    const pending = markdownToggles(container).filter((t) => t.disabled);
    for (const item of pending) {
      expect(item.note, `${item.label} 没有写原因`).toBeTruthy();
      expect(item.note?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("真正接了线的开关都是可点的", () => {
    const { container } = render(<SettingsPanel onClose={() => {}} initialSection="markdown" />);
    const enabled = markdownToggles(container)
      .filter((t) => !t.disabled)
      .map((t) => t.label);
    for (const label of ["表格", "任务列表", "脚注", "行内高亮 ==…==", "Mermaid 图表"]) {
      expect(enabled).toContain(label);
    }
  });

  it("置灰的开关不写原因提示（只有「还没做的」才写）", () => {
    const { container } = render(<SettingsPanel onClose={() => {}} initialSection="markdown" />);
    const withNote = markdownToggles(container).filter((t) => t.note !== null);
    expect(withNote.every((t) => t.disabled)).toBe(true);
  });
});

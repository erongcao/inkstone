/**
 * 导出产物要与**屏幕上看到的一致**（架构约束 C）。
 *
 * 这两条破口的形状一样：设置里的东西在编辑器里生效，
 * 导出链路却**没有带上**——于是同一个文档两套样子。
 *
 * - **自定义 CSS**：编辑器里它是最后注入的那张样式表，能覆盖任何东西；
 *   导出链路曾经完全不带它（`HtmlExportOptions` 里压根没这个字段）。
 * - **明暗模式**：导出取的是设置里的**原始值** `colorMode`，
 *   而那个值可能是 `"auto"`——于是默认配置（`auto` + 跟随系统）下，
 *   **系统是暗色时编辑器是暗的、导出是亮的**。
 *
 * ## 为什么单测全绿
 *
 * `exportToHtml(content, options)` 的选项里压根没有 `customCss`，
 * 而 `mode` 参数是个**普通字符串**——测「选项有没有带上」
 * 就像测「驾照上有没有驾照」。
 *
 * 这类破口只有走完整条链路才看得出来：
 * 设置 → `exportDocument` → `exportToHtml` → 产物。
 *
 * ## 为什么这条要单独测
 *
 * 「设置里的参数不接到请求上，就是摆设」——
 * 这条原则最早是为 AI 面板写的，这里同样适用。
 *
 * 用户的「附加样式」是注入到文档根节点的那张样式表，
 * 在编辑器里**排在所有样式之后**、能覆盖任何东西。
 * 但导出链路曾经完全不带它：
 * `HtmlExportOptions` 里没有这个字段，`exportDocument` 也没把它传进去。
 *
 * 结果是同一个文档**两套样式**——屏幕上是一套、导出出来是另一套。
 * 那正是架构约束 C（「屏幕与导出必须一致」）的破口，
 * 而且只有走完整条链路才看得出来：
 * 单测 `exportToHtml` 全绿，因为选项里压根没有这个字段。
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import type * as ExportModule from "@/ipc/export";

/** 捕获写到磁盘（或下载）的那份 HTML */
const capture = vi.hoisted(() => ({ html: "" }));

vi.mock("@/ipc/export", async (importOriginal) => {
  const actual = await importOriginal<typeof ExportModule>();
  return {
    ...actual,
    writeTextFile: async (_path: string, content: string) => {
      capture.html = content;
    },
  };
});

import { exportDocument } from "@/export/service";
import { resetSettings, updateSettings } from "@/settings/store";
import { setDocumentContent, resetTabs } from "@/ipc/document";

const CUSTOM_CSS = "p { line-height: 1.8; color: #b00; }";

beforeEach(() => {
  resetSettings();
  resetTabs();
  capture.html = "";
});

describe("自定义 CSS 进导出产物", () => {
  it("HTML 导出带上了设置里的自定义 CSS", async () => {
    setDocumentContent("# 标题\n\n正文一段。");
    updateSettings({ appearance: { customCss: CUSTOM_CSS } });

    const result = await exportDocument("html");

    expect(result.ok).toBe(true);
    expect(capture.html).toContain(CUSTOM_CSS);
  });

  it("没有自定义 CSS 时导出里也不该有那张样式表", async () => {
    setDocumentContent("# 标题\n\n正文一段。");

    const result = await exportDocument("html");

    expect(result.ok).toBe(true);
    expect(capture.html).not.toContain("line-height: 1.8");
  });

  it("自定义 CSS 排在 <head> 最后（与编辑器一致，能覆盖任何样式）", async () => {
    setDocumentContent("# 标题\n\n正文一段。");
    updateSettings({ appearance: { customCss: CUSTOM_CSS } });

    await exportDocument("html");

    const at = capture.html.lastIndexOf(CUSTOM_CSS);
    const headEnd = capture.html.indexOf("</head>");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(headEnd);
    // 它后面不该再有别的 <style>——那才是「排在最后」
    expect(capture.html.slice(at, headEnd)).not.toContain("<style>");
  });
});

describe("明暗模式：导出要与屏幕上的一致", () => {
  /*
   * 默认配置是 `colorMode: "auto"` + 跟随系统。
   * 系统是暗色时，编辑器是暗的——而导出曾经取原始值 `"auto"`，
   * 在 `buildStyles` 里被判成 `"light"`。
   * 于是**默认配置**下同一份文档就有两种外观。
   *
   * 修法：导出读 `<html>` 上的 `data-mode`（`useThemeRuntime` 写的），
   * 那就是**屏幕上那个**模式。
   */
  beforeEach(() => {
    document.documentElement.dataset.mode = "light";
  });

  it("设置是 auto、屏幕是暗色时，导出也是暗色", async () => {
    document.documentElement.dataset.mode = "dark";
    updateSettings({ appearance: { colorMode: "auto" } });
    setDocumentContent("# 标题");

    await exportDocument("html");

    expect(capture.html).toContain('data-mode="dark"');
  });

  it("屏幕是亮色时，导出也是亮色", async () => {
    document.documentElement.dataset.mode = "light";
    updateSettings({ appearance: { colorMode: "auto" } });
    setDocumentContent("# 标题");

    await exportDocument("html");

    expect(capture.html).toContain('data-mode="light"');
  });

  it("屏幕是暗色时，用的是暗色那套颜色令牌", async () => {
    document.documentElement.dataset.mode = "dark";
    setDocumentContent("# 标题");

    await exportDocument("html");

    // 暗色令牌里的背景色是深色，亮色那套是纯白
    expect(capture.html).toContain("#0d1117");
  });
});

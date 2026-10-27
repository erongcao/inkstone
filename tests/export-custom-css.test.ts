/**
 * 自定义 CSS 要一路走到导出产物里。
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

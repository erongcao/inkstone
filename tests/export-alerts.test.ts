/**
 * GitHub 提示块进 pandoc 导出的守卫。
 *
 * ## 这些用例钉的是**行为**，不是实现
 *
 * 断言都落在**改写后的源码**上——
 * 因为 pandoc 那条链路的输入就是这份源码，
 * 而它最终渲染成什么样由 pandoc 决定（那不归我们管，也测不到）。
 *
 * 另有一条对拍断言：改写规则与屏幕那条（`src/parser/alerts.ts`）必须一致——
 * 屏幕上认成提示块的，导出里也得认成提示块，反之亦然。
 */

import { describe, expect, it } from "vitest";

import { rewriteAlertsForPandoc } from "@/export/alerts";
import { matchAlert } from "@/parser/alerts";

describe("rewriteAlertsForPandoc", () => {
  it("把标记换成大写标题，并让标题自成一段", () => {
    const src = ["> [!NOTE]", "> 这是一条提示。"].join("\n");
    expect(rewriteAlertsForPandoc(src)).toBe(
      ["> **NOTE**", ">", "> 这是一条提示。"].join("\n"),
    );
  });

  it("标记与正文在同一行时，正文挪到标题下面", () => {
    const src = "> [!NOTE] 这是一条提示。";
    expect(rewriteAlertsForPandoc(src)).toBe(
      ["> **NOTE**", ">", "> 这是一条提示。"].join("\n"),
    );
  });

  it("五种提示类型各有各的标题", () => {
    for (const type of ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"]) {
      const out = rewriteAlertsForPandoc(`> [!${type}]\n> 内容`);
      expect(out).toContain(`**${type}**`);
    }
  });

  it("类型不区分大小写，但标题一律大写", () => {
    expect(rewriteAlertsForPandoc("> [!note]\n> 内容")).toContain("**NOTE**");
  });

  it("普通引用原样不动", () => {
    const src = ["> 就是个引用。", "> 第二行。"].join("\n");
    expect(rewriteAlertsForPandoc(src)).toBe(src);
  });

  it("代码块里的标记不是提示块", () => {
    // 屏幕上的代码块也不渲染成提示块——
    // 导出要是把它改写了，那就是屏幕与导出不一致。
    const src = ["```", "> [!NOTE]", "```"].join("\n");
    expect(rewriteAlertsForPandoc(src)).toBe(src);
  });

  it("围栏之外的普通内容一个字节都不动", () => {
    const src = [
      "# 标题",
      "",
      "*斜体* 与 _另一种斜体_",
      "",
      "- 列表项",
      "",
      "> [!NOTE]",
      "> 提示。",
      "",
      "结尾。",
    ].join("\n");
    const out = rewriteAlertsForPandoc(src);
    expect(out).toContain("*斜体* 与 _另一种斜体_");
    expect(out).toContain("- 列表项");
    expect(out).toContain("结尾。");
    expect(out).not.toContain("[!NOTE]");
  });

  it("多段落的提示块里，每一段都保留", () => {
    const src = ["> [!NOTE]", "> 第一段。", ">", "> 第二段。"].join("\n");
    expect(rewriteAlertsForPandoc(src)).toBe(
      ["> **NOTE**", ">", "> 第一段。", ">", "> 第二段。"].join("\n"),
    );
  });

  it("标记不在段落开头就不算提示块", () => {
    // 上游的规则是「段落的**第一个**文本节点以 `[!TYPE]` 开头」。
    // `> 引用` 与 `> [!NOTE]` 之间没有空行 → 它们是**同一段**，
    // 段落的第一个文本节点是「引用」，所以不是提示块。
    const src = ["> 引用", "> [!NOTE]"].join("\n");
    expect(rewriteAlertsForPandoc(src)).toBe(src);
  });

  it("空引用行之后的段落可以是提示块（与上游同规则）", () => {
    // 上游扫的是「第一个**匹配上**的段落」，不是「第一个段落」。
    const src = ["> 引用", ">", "> [!NOTE]"].join("\n");
    expect(rewriteAlertsForPandoc(src)).toContain("**NOTE**");
  });

  it("一个引用块里只改第一个匹配的段落", () => {
    const src = ["> [!NOTE]", "> 提示。", ">", "> [!TIP]", "> 另一个。"].join("\n");
    const out = rewriteAlertsForPandoc(src);
    expect(out).toContain("**NOTE**");
    expect(out).not.toContain("**TIP**");
  });

  it("嵌套引用里的标记也会被改写", () => {
    const out = rewriteAlertsForPandoc([">> [!NOTE]", ">> 内容"].join("\n"));
    expect(out).toContain("**NOTE**");
    expect(out).not.toContain("[!NOTE]");
  });

  it("没有提示块时，原样返回同一个字符串", () => {
    const src = "普通文档。\n\n第二段。";
    expect(rewriteAlertsForPandoc(src)).toBe(src);
  });

  it("改写规则与屏幕那条对得上", () => {
    // 同一个标记，两处都要认出来。
    // 屏幕那条用的是 `matchAlert`——这里直接拿它当判据，
    // 免得两处各写一套正则、慢慢漂移。
    for (const marker of ["[!NOTE]", "[!TIP]", "[!WARNING]", "[!CAUTION]"]) {
      expect(matchAlert(marker)).not.toBeNull();
    }
    // 而屏幕**不**认的，导出也不能改。
    const src = ["> [!NOPE]", "> 内容"].join("\n");
    expect(rewriteAlertsForPandoc(src)).toBe(src);
  });
});

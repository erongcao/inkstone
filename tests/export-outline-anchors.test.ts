/**
 * 导出的大纲：每个链接都要落到**对应**的那个标题上。
 *
 * ## 这条守卫守的是什么
 *
 * 导出的 HTML 里，大纲是 `<a href="#…">`，正文标题是 `<h2 id="…">`。
 * 两边的 id 必须对得上，而且**必须是对应的那一个标题**。
 *
 * ## 为什么原来那条守卫不够
 *
 * 早先只有一条断言：「产物里存在 `id="<大纲里的 href>"`」。
 * 它**抓不到错位**——只要文档里有任何一个标题碰巧带着那个 id，它就绿。
 *
 * 真正会出事的是**错位**：锚点被贴到了另一个标题上。
 * 实测（2026-10-28）：文档里只有一个顶层标题 + 一个引用块里的标题时，
 * 大纲项的 id 被贴到了**引用块那个标题**上，真正的大纲标题反而没有 id——
 * 导出文件里点目录，跳到错误的位置，而文件本身看不出任何异常。
 *
 * 所以这里的判据是**成对的**：链接的落点，标题的**文字与层级**都要对得上。
 *
 * ## 判据落在产物上
 *
 * 全部从导出的 HTML 字符串里抽，不看源码——
 * 源码扫描看不见「id 贴到了哪个标签上」这种事。
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

import { exportToHtml } from "@/export/html";
import { exportDocument } from "@/export/service";
import { resetSettings, updateSettings } from "@/settings/store";
import { setDocumentContent, resetTabs } from "@/ipc/document";

/** 导出选项 */
const base = {
  title: "Probe",
  theme: "github",
  mode: "light" as const,
  includeOutline: true,
};

/** 去掉标签与实体，得到人读的文字 */
function plain(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** 大纲里的一项 */
interface OutlineEntry {
  depth: number;
  href: string;
  text: string;
}

/** 从产物里抽出大纲项 */
function outlineEntries(html: string): OutlineEntry[] {
  const nav = /<nav class="inkstone-outline"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
  return [
    ...nav.matchAll(/<li data-depth="(\d+)"><a href="#([^"]+)">([\s\S]*?)<\/a><\/li>/g),
  ].map((m) => ({ depth: Number(m[1]), href: m[2], text: plain(m[3]) }));
}

/** 正文里的一个标题 */
interface BodyHeading {
  level: number;
  id: string;
  text: string;
}

/** 从产物里抽出正文里的标题（只认带 id 的） */
function bodyHeadings(html: string): BodyHeading[] {
  const body = html.slice(html.indexOf("<article"), html.indexOf("</article>"));
  return [...body.matchAll(/<h([1-6]) id="([^"]+)">([\s\S]*?)<\/h[1-6]>/g)].map((m) => ({
    level: Number(m[1]),
    id: m[2],
    text: plain(m[3]),
  }));
}

/**
 * 核心断言：大纲的每一项都要落到**正文里那个同名同级的标题**上。
 *
 * @param doc 文档源码
 * @param expectCount 预期的大纲项数（用来钉住「哪些标题该进大纲」）
 */
function expectOutlineLanding(doc: string, expectCount?: number): void {
  const html = exportToHtml(doc, base);
  const entries = outlineEntries(html);
  const headings = bodyHeadings(html);

  // **自检**：不能对着空集合断言。
  // 空数组上的 `every` 天然全过——那是一条什么都没守的绿灯。
  expect(entries.length, "产物里没有大纲项，守卫会空跑").toBeGreaterThan(0);
  expect(headings.length, "产物里没有标题，守卫会空跑").toBeGreaterThan(0);

  if (expectCount !== undefined) {
    expect(entries.length).toBe(expectCount);
  }

  for (const entry of entries) {
    const hit = headings.find((h) => h.id === entry.href);
    expect(hit, `大纲项「${entry.text}」的锚点 ${entry.href} 在正文里不存在`).toBeTruthy();
    expect(
      hit?.level,
      `大纲项「${entry.text}」落到了另一个层级的标题上（${hit?.level}）`,
    ).toBe(entry.depth);
    expect(
      hit?.text,
      `大纲项「${entry.text}」落到了另一个标题上（「${hit?.text}」）`,
    ).toBe(entry.text);
  }
}

describe("导出的大纲：链接落到对应的标题", () => {
  it("普通文档：每一条都对得上", () => {
    expectOutlineLanding("# 第一章\n\n正文。\n\n## 第二节\n\n正文。\n", 2);
  });

  it("引用块里的标题不占名额（回归）", () => {
    // 早先的实现按「第几个 <hN> 标签」配对，
    // 引用块里的标题会抢走大纲项的 id —— 大纲里只有「真标题」，
    // 但它的链接会跳到引用块里那个标题上。
    expectOutlineLanding("> # 引用块标题\n\n正文。\n\n## 真标题\n\n正文。\n", 1);
  });

  it("列表项里的标题不占名额（回归）", () => {
    expectOutlineLanding("- # 列表标题\n\n正文。\n\n## 真标题\n\n正文。\n", 1);
  });

  it("用户写的原始 HTML 里的 h1 不占名额（回归）", () => {
    // 原始 HTML 会被原样保留进导出（2026-10-28 拍板），
    // 它里的 `<h1>` 不是 mdast 的标题节点，不该有 id，更不该抢别人的。
    expectOutlineLanding("<h1>手写的标题</h1>\n\n正文。\n\n## 真标题\n\n正文。\n", 1);
  });

  it("标题里有行内标记时，落点的文字也算得对", () => {
    expectOutlineLanding("## **加粗** 标题\n\n正文。\n", 1);
  });

  it("setext 标题（一、二级）也算标题", () => {
    expectOutlineLanding("第一章\n=======\n\n正文。\n\n第二节\n-------\n\n正文。\n", 2);
  });

  it("锚点 id 不重复", () => {
    const html = exportToHtml(
      "# 一\n\n## 二\n\n### 三\n\n> # 四\n\n- # 五\n",
      base,
    );
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size, `锚点 id 重复了：${ids.join(", ")}`).toBe(ids.length);
  });

  it("文档里没有标题时就没有大纲", () => {
    const html = exportToHtml("只有一段正文。\n", base);
    expect(html).not.toContain('<nav class="inkstone-outline"');
  });
});

/**
 * 走**完整导出链路**。
 *
 * 上面的用例测的是 `exportToHtml` 这个函数；
 * 这一组测的是**真正写到磁盘上的那份文件**——
 * 导出链路里大纲曾经是**另外解析一棵树**算出来的，
 * 两棵树可能对不上，而那种错位只在完整链路上才看得见。
 */
describe("走完整导出链路：写出去的那份文件里链接也要对得上", () => {
  beforeEach(() => {
    resetSettings();
    resetTabs();
    capture.html = "";
    // 大纲默认是开的，但显式写出来——这条用例盯的就是它
    updateSettings({ export: { htmlIncludeOutline: true } });
  });

  it("引用块里的标题不抢走大纲项的锚点", async () => {
    setDocumentContent("> # 引用块标题\n\n正文。\n\n## 真标题\n\n正文。\n");

    const result = await exportDocument("html");

    expect(result.ok).toBe(true);
    const entries = outlineEntries(capture.html);
    const headings = bodyHeadings(capture.html);

    expect(entries.length).toBe(1);
    expect(entries[0].text).toBe("真标题");

    const hit = headings.find((h) => h.id === entries[0].href);
    expect(hit?.text, "大纲链接落到了引用块里那个标题上").toBe("真标题");
  });

  it("写出去的文件里没有重复的锚点 id", async () => {
    setDocumentContent("# 一\n\n## 二\n\n### 三\n\n> # 四\n\n- # 五\n");

    await exportDocument("html");

    const ids = [...capture.html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size, `锚点 id 重复了：${ids.join(", ")}`).toBe(ids.length);
  });
});

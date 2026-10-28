/**
 * 导出产物的**语言**一致性。
 *
 * ## 这条守卫守的是什么
 *
 * 导出到磁盘的 HTML 里，有一部分文字是**我们生成的**，不是用户写的：
 *
 *   - 大纲标题（`<h2>`）
 *   - 导航区的 `aria-label`
 *   - 页脚统计
 *   - `<title>` 的兜底
 *   - `<html lang>` 这个语言声明
 *
 * 这些必须跟着**界面语言**走。写死中文的话：
 *
 *   - 英文用户拿到的文件里顶着两个「大纲」；
 *   - 读屏软件按中文念导航区；
 *   - `lang="zh-CN"` 让浏览器拿中文的断词规则去切英文正文，
 *     而且读屏软件会**用中文的发音规则念英文**。
 *
 * ## 为什么用「零中文」而不是逐条断言
 *
 * 逐条断言只能守住**已经想到**的地方。
 * 「英文界面 + 英文文档 → 产物里零中文」是封口的：
 * 以后任何一处新写进去的中文硬编码，它立刻会红。
 *
 * 判据用**产物本身**，不是源码——源码扫描只能看见字面量，
 * 看不见拼接出来的字符串。
 */

import { describe, expect, it, afterEach } from "vitest";
import { exportToHtml } from "@/export/html";
import { updateSettings, resetSettings } from "@/settings/store";

/** 纯英文的文档——正文里一个中文都没有，任何中文都只可能来自我们的代码 */
const ENGLISH_DOC = `# A Heading

A paragraph of plain English text, with **bold** and *italic*.

- first item
- second item
`;

/** 导出选项 */
const base = {
  title: "Probe",
  theme: "github",
  mode: "light" as const,
  includeOutline: true,
};

/** CJK 统一表意文字（含扩展 A 与兼容表意文字） */
const CJK = /[㐀-䶿一-鿿豈-﫿]/g;

/** 含脚注的文档——脚注区有两处**只给辅助技术看**的文字 */
const FOOTNOTE_DOC = `Body with a note[^1].

[^1]: The note.
`;

/**
 * 去掉 HTML 注释。
 *
 * 注释在浏览器里**不可见**——它们是给维护者看的记号
 * （比如「公式渲染器未就绪」那条提示）。
 * 守卫要守的是「读者看得见的中文」，所以注释不算数。
 */
function stripHtmlComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, "");
}

afterEach(() => {
  resetSettings();
});

describe("导出产物的语言", () => {
  it("英文界面 + 英文文档 → 产物里一个中文都没有", () => {
    updateSettings({ general: { language: "en" } });

    const html = stripHtmlComments(exportToHtml(ENGLISH_DOC, base));

    const found = html.match(CJK);
    // 报出具体是哪几个字，而不是只说「有中文」——
    // 定位失败时能一眼看出是哪个词漏翻了
    expect(
      found,
      `产物里出现了中文：${found ? [...new Set(found)].join("") : ""}`,
    ).toBeNull();
  });

  it("英文界面下，大纲标题是英文", () => {
    updateSettings({ general: { language: "en" } });

    const html = exportToHtml(ENGLISH_DOC, base);

    expect(html).toContain("<h2>Outline</h2>");
    expect(html).toContain('aria-label="Outline"');
  });

  it("繁体界面下，大纲标题是繁体", () => {
    updateSettings({ general: { language: "zh-TW" } });

    const html = exportToHtml(ENGLISH_DOC, base);

    expect(html).toContain("<h2>大綱</h2>");
    expect(html).not.toContain("大纲");
  });

  it("语言声明跟着界面语言走", () => {
    updateSettings({ general: { language: "en" } });
    expect(exportToHtml(ENGLISH_DOC, base)).toContain('<html lang="en"');

    updateSettings({ general: { language: "zh-TW" } });
    expect(exportToHtml(ENGLISH_DOC, base)).toContain('<html lang="zh-TW"');

    updateSettings({ general: { language: "zh-CN" } });
    expect(exportToHtml(ENGLISH_DOC, base)).toContain('<html lang="zh-CN"');
  });

  it("文件名兜底也是本地化的", async () => {
    const { sanitizeFileName } = await import("@/export/registry");

    updateSettings({ general: { language: "en" } });
    expect(sanitizeFileName("///")).toBe("Untitled");

    updateSettings({ general: { language: "zh-CN" } });
    expect(sanitizeFileName("///")).toBe("未命名");
  });

  it("脚注区的标题与回链标签跟着界面语言走", () => {
    // 这两处**只给读屏软件看**（标题带 `sr-only` 类，回链是 `aria-label`），
    // 所以最容易被漏掉：眼睛看不见，写错了也没人发现。
    //
    // 上游（mdast-util-to-hast）的默认值是英文，而它自己的注释写着
    // 「When your page is not in English, you must define translated values」。
    updateSettings({ general: { language: "zh-TW" } });
    const tw = exportToHtml(FOOTNOTE_DOC, base);
    expect(tw).toContain(">註腳</h2>");
    expect(tw).toContain('aria-label="返回引用 1"');
    expect(tw).not.toContain("Back to reference");

    updateSettings({ general: { language: "zh-CN" } });
    const cn = exportToHtml(FOOTNOTE_DOC, base);
    expect(cn).toContain(">脚注</h2>");
    expect(cn).toContain('aria-label="返回引用 1"');
    expect(cn).not.toContain("Back to reference");
  });
});

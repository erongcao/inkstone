/**
 * 导出的**主题与排版**必须和屏幕上一致（架构约束 C）。
 *
 * ## 这条守卫守的是什么
 *
 * 导出的 HTML 是独立的单文件，它内联了一份主题令牌（颜色 + 字体）
 * 和一份版式设置。这两份东西**也存在于应用里**——
 * 应用用的是 `src/styles/tokens.css` + `src/themes/*.css`，
 * 加上设置面板里选的字号 / 行高 / 写作区宽度 / 字体 / 页面背景。
 *
 * 两边对不上，用户看到的就是「同一份文档，导出后变了样」。
 *
 * ## 实测踩过的两个坑（2026-10-28）
 *
 * 1. **令牌手抄了一份，漂移了**：`academic` 主题在导出里是暗红配色 + 无衬线，
 *    应用里是蓝配色 + 衬线——**根本不是同一个主题**。
 *    现在令牌由 `pnpm gen:theme-tokens` 从 CSS 生成，只有一份真相源。
 * 2. **版式设置完全没进导出**：用户把字号调到 18px、写作区调到 64rem，
 *    导出的文件还是 16px / 46rem。
 *
 * ## 判据落在产物上
 *
 * 全部从**导出的 HTML 字符串**里读，再拿 CSS 文件做对照——
 * 不看源码里的常量（那是手抄的那份，正是漂移的来源）。
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type * as ExportModule from "@/ipc/export";

/** 捕获写到磁盘（或下载）的那份文件内容 */
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
import { updateSettings, resetSettings } from "@/settings/store";
import { setDocumentContent, resetTabs } from "@/ipc/document";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 导出选项 */
const base = {
  title: "Probe",
  theme: "inkstone-light",
  mode: "light" as const,
  includeOutline: false,
};

/** 读一个 CSS 文件 */
function readCss(relative: string): string {
  return readFileSync(resolve(ROOT, relative), "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * 从 CSS 里取出某个主题某个模式的令牌。
 *
 * 判据直接用 CSS 的选择器，不走生成器——
 * 生成器是「被检查的对象」之一，不能拿它当尺子。
 */
function tokensFromCss(
  file: string,
  theme: string,
  mode: "light" | "dark",
): Record<string, string> {
  const css = readCss(file);
  const selector = theme === "inkstone-light" ? `[data-mode="${mode}"]` : null;
  const out: Record<string, string> = {};

  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = rule.exec(css)) !== null) {
    const sel = match[1].trim();
    const body = match[2];
    if (!body.includes("--ink-")) continue;

    const themeSel = /data-theme="([^"]+)"/.exec(sel)?.[1];
    const modeSel = /data-mode="(light|dark)"/.exec(sel)?.[1];

    if (selector) {
      // 基础主题：只看没有 data-theme 的模式块
      if (themeSel || modeSel !== mode) continue;
    } else {
      if (themeSel !== theme || modeSel !== mode) continue;
    }

    for (const decl of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      out[decl[1]] = decl[2].trim().replace(/\s+/g, " ");
    }
  }
  return out;
}

/**
 * 从导出的 HTML 里取出令牌。
 *
 * 产物里有**好几个** `:root` 块（版式默认值、主题令牌、用户排版）——
 * 同名时后者胜，与 CSS 层叠一致，所以这里要**合并**而不是只看第一个。
 */
function tokensFromExport(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const block of html.matchAll(/:root\s*\{([\s\S]*?)\}/g)) {
    for (const decl of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      out[decl[1]] = decl[2].trim().replace(/\s+/g, " ");
    }
  }
  return out;
}

/** 三个主题各自的 CSS 文件与主题 id */
const THEMES = [
  { id: "inkstone-light", file: "src/styles/tokens.css" },
  { id: "github", file: "src/themes/github.css" },
  { id: "academic", file: "src/themes/academic.css" },
] as const;

describe("导出的主题令牌与应用内一致", () => {
  for (const { id, file } of THEMES) {
    for (const mode of ["light", "dark"] as const) {
      it(`${id} / ${mode}：导出的令牌逐条等于 CSS 里的值`, () => {
        const css = tokensFromCss(file, id, mode);
        // 自检：CSS 里确实读到了令牌（否则下面的断言是空跑）
        expect(Object.keys(css).length).toBeGreaterThan(10);

        const exported = tokensFromExport(
          exportToHtml("# 标题", { ...base, theme: id, mode }),
        );

        for (const [name, value] of Object.entries(css)) {
          expect(exported[name], `${id}/${mode} 的 --${name} 与 CSS 不一致`).toBe(value);
        }
      });
    }
  }

  it("academic 主题的导出色值就是应用里的那个（不是另一套）", () => {
    const html = exportToHtml("# 标题", { ...base, theme: "academic", mode: "light" });
    const exported = tokensFromExport(html);

    // 应用内 academic.css 的 accent 是蓝调（#1a5fb4）
    expect(exported["--ink-accent"]).toBe("#1a5fb4");
    expect(exported["--ink-bg"]).toBe("#fdfdfc");
  });

  it("academic 主题的导出用衬线体（与编辑器同一套字体）", () => {
    const html = exportToHtml("# 标题", { ...base, theme: "academic" });
    const exported = tokensFromExport(html);

    expect(exported["--ink-font-family"]).toContain("Iowan Old Style");
    expect(exported["--ink-font-family"]).toContain("serif");
  });
});

describe("导出的排版跟随用户的设置", () => {
  it("字号 / 行高 / 写作区宽度都进导出", () => {
    const html = exportToHtml("# 标题", {
      ...base,
      typography: {
        fontSize: 18,
        lineHeight: 1.8,
        contentWidth: 64,
      },
    });
    const exported = tokensFromExport(html);

    expect(exported["--ink-font-size"]).toBe("18px");
    expect(exported["--ink-line-height"]).toBe("1.8");
    expect(exported["--ink-content-width"]).toBe("64rem");
  });

  it("字体族与页面背景色都进导出", () => {
    const html = exportToHtml("# 标题", {
      ...base,
      typography: {
        fontFamily: '"Fira Code", monospace',
        monoFontFamily: '"JetBrains Mono", monospace',
        backgroundColor: "#fefefe",
      },
    });
    const exported = tokensFromExport(html);

    expect(exported["--ink-font-family"]).toBe('"Fira Code", monospace');
    expect(exported["--ink-mono-family"]).toBe('"JetBrains Mono", monospace');
    expect(exported["--ink-page-bg"]).toBe("#fefefe");
  });

  it("用户的排版排在主题令牌之后（用户的选择压过主题）", () => {
    // 主题的字体是 academic 的衬线体；用户选了别的字体时，
    // 用户的必须赢——应用里那是 inline style，优先级最高。
    const html = exportToHtml("# 标题", {
      ...base,
      theme: "academic",
      typography: { fontFamily: "MyOwnFont, sans-serif" },
    });

    const fontAt = html.indexOf("--ink-font-family: MyOwnFont");
    const serifAt = html.indexOf("Iowan Old Style");
    expect(fontAt).toBeGreaterThan(-1);
    expect(serifAt).toBeGreaterThan(-1);
    expect(fontAt, "用户的字体必须排在主题字体之后（同名时后者胜）").toBeGreaterThan(
      serifAt,
    );
  });

  it("页面背景色真的被页面用上（不是只写进变量就完事）", () => {
    const html = exportToHtml("# 标题", {
      ...base,
      typography: { backgroundColor: "#fefefe" },
    });

    // body 的背景要引用 --ink-page-bg
    expect(html).toMatch(/body\s*\{[^}]*background:\s*var\(--ink-page-bg/);
  });
});

describe("代码高亮的颜色也走主题变量", () => {
  it("diff 的两种颜色不写死", () => {
    const html = exportToHtml("# 标题", base);

    expect(html).toContain(".hljs-deletion { color: var(--ink-code-deleted); }");
    expect(html).toContain(".hljs-addition { color: var(--ink-code-inserted); }");
  });
});

describe("走完整导出链路：写出去的那份文件也要对", () => {
  beforeEach(() => {
    resetSettings();
    resetTabs();
    capture.html = "";
  });

  afterEach(() => {
    resetSettings();
  });

  it("用户在设置里选的字号与主题都进了写出去的文件", async () => {
    updateSettings({
      appearance: { theme: "academic", fontSize: 19, contentWidth: 52 },
    });
    setDocumentContent("# 标题\n\n正文。\n");

    const result = await exportDocument("html");

    expect(result.ok).toBe(true);
    const exported = tokensFromExport(capture.html);
    expect(exported["--ink-font-size"]).toBe("19px");
    expect(exported["--ink-content-width"]).toBe("52rem");
    // 主题也跟着走（academic 的蓝调）
    expect(exported["--ink-accent"]).toBe("#1a5fb4");
  });
});

describe("设置里的「页面背景色」不再是死设置", () => {
  it("应用的 CSS 真的消费 --ink-page-bg", () => {
    const css = readCss("src/styles/base.css");
    expect(css).toMatch(/background-color:\s*var\(--ink-page-bg/);
  });
  it("每一个由设置注入的 CSS 变量都真的被用上", () => {
    // `useThemeRuntime` 把设置写进 `<html>` 的 inline style。
    // 写进去**不等于**用上了——曾经 `--ink-page-bg` 就是这样：
    // 变量被设置、被读，但没有任何一条 CSS 规则用它，
    // 于是「页面背景色」这个设置项点了没反应。
    //
    // 判据扫**整个 src/**（CSS 与 TS 都算）——
    // `--ink-content-width` 是在 `editor/MarkdownEditor.ts` 里
    // 作为 CodeMirror 主题的 `maxWidth` 用的，不是 CSS。
    const runtime = readFileSync(resolve(ROOT, "src/theme/useThemeRuntime.ts"), "utf-8");
    const injected = [...runtime.matchAll(/setProperty\(\s*"(--ink-[\w-]+)"/g)].map(
      (m) => m[1],
    );

    expect(injected.length, "没从设置里读到任何 CSS 变量，守卫会空跑").toBeGreaterThan(0);

    const sources = [
      "src/styles/base.css",
      "src/styles/components.css",
      "src/styles/tokens.css",
      "src/editor/live-preview.css",
      "src/editor/MarkdownEditor.ts",
      "src/themes/github.css",
      "src/themes/academic.css",
    ]
      .map((f) => readFileSync(resolve(ROOT, f), "utf-8"))
      .join("\n");

    for (const name of injected) {
      expect(sources.includes(`var(${name}`), `--${name} 没有被任何样式用到`).toBe(true);
    }
  });
});

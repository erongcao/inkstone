/**
 * 主题的字体必须**真的生效**（2026-10-28 用户拍板的方案）。
 *
 * ## 破口
 *
 * 「学术写作」主题声明了衬线体
 * （`src/themes/academic.css` 的 `[data-theme="academic"] { --ink-font-family: … }`），
 * 但**从来没生效过**：设置面板的「正文字体」默认填了一个具体的字体栈，
 * 而那个值是**写在 `<html>` 上的 inline style**——
 * inline style 的优先级高于任何样式表规则，
 * 于是主题声明的字体永远轮不到。
 *
 * 现象：切到「学术写作」，配色变了，字体没变。
 * 没人觉得奇怪，因为**看起来本来就该是这样**：
 * 大家都以为字体是「应用统一管」的一件事。
 *
 * ## 方案（用户拍板）
 *
 * 字体设置默认**空串 = 跟随主题**；用户填了才覆盖。
 *
 * ## 判据落在运行时事实上
 *
 * jsdom 的 `getComputedStyle` 支持自定义属性，也实现了层叠
 * （后插入的样式表覆盖先前的、inline style 覆盖样式表——
 *  实测与浏览器一致）。所以这里把**真实的样式表**注入文档，
 * 直接读**屏幕上那个字体**，而不是去扫源码里有没有写某个分支。
 *
 * 导出侧用同一条判据：**屏幕上的 computed 值 == 导出文件里的值**
 * （架构约束 C：屏幕与导出必须一致）。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act, renderHook } from "@testing-library/react";
import { useThemeRuntime } from "@/theme/useThemeRuntime";
import { currentColorMode } from "@/theme/themes";
import { readSettings, resetSettings, updateSettings } from "@/settings/store";
import { exportToHtml, typographyFromAppearance } from "@/export/html";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 本次注入的样式表（afterEach 里摘掉） */
const injected: HTMLStyleElement[] = [];

/**
 * 注入真实的样式表，让 jsdom 按 CSS 层叠算 computed style。
 *
 * 应用里的样式表是 Vite 动态 import 的，vitest 默认不处理 CSS，
 * 所以这里手动把**文件原文**塞进去——判据要落在真东西上。
 */
function injectStylesheet(relative: string): void {
  const el = document.createElement("style");
  el.textContent = readFileSync(resolve(ROOT, relative), "utf-8");
  document.head.appendChild(el);
  injected.push(el);
}

/**
 * 归一化字体栈。
 *
 * jsdom 的 computed style 会把 `a, b` 规整成 `a,b`，
 * 而导出的 CSS 文本保留原始空白——比较前先把空白去掉。
 */
function normalizeFont(value: string): string {
  return value.replace(/\s+/g, "").trim();
}

/** 屏幕上那个字体（computed style，不是源码里的常量） */
function computedFont(name = "--ink-font-family"): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name);
}

/** 导出文件里的字体 */
function exportedFont(html: string, name = "--ink-font-family"): string {
  let out = "";
  for (const block of html.matchAll(/:root\s*\{([\s\S]*?)\}/g)) {
    for (const decl of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      if (decl[1] === name) out = decl[2].trim();
    }
  }
  return out;
}

/** 学术主题 + 固定亮色（不跟系统，免得受 matchMedia 桩的影响） */
function useAcademicTheme(): void {
  updateSettings({
    appearance: {
      theme: "academic",
      colorMode: "light",
      followSystemAppearance: false,
    },
  });
}

beforeEach(() => {
  resetSettings();
  // 上一条用例留下的 inline style 会污染下一条
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-mode");
});

afterEach(() => {
  for (const el of injected.splice(0)) el.remove();
});

describe("自检：注入的样式表真的参与了层叠", () => {
  it("基础令牌是 sans，叠上学术主题后变成 serif", () => {
    injectStylesheet("src/styles/tokens.css");
    document.documentElement.dataset.theme = "academic";

    const base = normalizeFont(computedFont());
    expect(base).toContain("apple-system");
    expect(base, "只有基础令牌时不该出现主题的字体").not.toContain("IowanOldStyle");

    injectStylesheet("src/themes/academic.css");
    expect(normalizeFont(computedFont())).toContain("IowanOldStyle");
  });
});

describe("应用内：主题字体真的生效", () => {
  it("没选字体时不在 <html> 上写 inline 字体变量", () => {
    useAcademicTheme();
    renderHook(() => useThemeRuntime());

    // 判据是「inline style 里根本没有这一项」——
    // 留着空声明等于明确地告诉浏览器「这个值我说了算」，
    // 主题的字体就永远轮不到。
    expect(document.documentElement.style.getPropertyValue("--ink-font-family")).toBe("");
    expect(document.documentElement.getAttribute("style") ?? "").not.toContain(
      "--ink-font-family",
    );
    expect(document.documentElement.getAttribute("style") ?? "").not.toContain(
      "--ink-mono-family",
    );
  });

  it("没选字体时，屏幕上那个字体就是学术主题的衬线体", () => {
    injectStylesheet("src/styles/tokens.css");
    injectStylesheet("src/themes/academic.css");
    useAcademicTheme();
    renderHook(() => useThemeRuntime());

    const font = normalizeFont(computedFont());
    expect(font).toContain("IowanOldStyle");
    expect(font).toContain("serif");
  });

  it("用户选了字体后，屏幕上那个字体换成用户的", () => {
    injectStylesheet("src/styles/tokens.css");
    injectStylesheet("src/themes/academic.css");
    useAcademicTheme();
    renderHook(() => useThemeRuntime());

    act(() => {
      updateSettings({ appearance: { fontFamily: "MyOwnFont, sans-serif" } });
    });

    expect(normalizeFont(computedFont())).toBe("MyOwnFont,sans-serif");
  });

  it("用户把字体清空后，inline 变量被移除，主题字体回来", () => {
    injectStylesheet("src/styles/tokens.css");
    injectStylesheet("src/themes/academic.css");
    useAcademicTheme();
    renderHook(() => useThemeRuntime());

    act(() => {
      updateSettings({ appearance: { fontFamily: "MyOwnFont, sans-serif" } });
    });
    expect(normalizeFont(computedFont())).toBe("MyOwnFont,sans-serif");

    act(() => {
      updateSettings({ appearance: { fontFamily: "" } });
    });
    // 不是写成空串，是**移除**——否则等于明确地压过主题
    expect(document.documentElement.style.getPropertyValue("--ink-font-family")).toBe("");
    expect(normalizeFont(computedFont())).toContain("IowanOldStyle");
  });

  it("等宽字体同样跟随主题", () => {
    injectStylesheet("src/styles/tokens.css");
    injectStylesheet("src/themes/academic.css");
    useAcademicTheme();
    renderHook(() => useThemeRuntime());

    const mono = normalizeFont(computedFont("--ink-mono-family"));
    expect(mono).toContain("SFMono-Regular");

    act(() => {
      updateSettings({ appearance: { monoFontFamily: "MyOwnMono, monospace" } });
    });
    expect(normalizeFont(computedFont("--ink-mono-family"))).toBe("MyOwnMono,monospace");
  });
});

describe("导出：跟屏幕上完全一致", () => {
  it("没选字体时，导出里的字体 == 屏幕上那个", () => {
    injectStylesheet("src/styles/tokens.css");
    injectStylesheet("src/themes/academic.css");
    useAcademicTheme();
    renderHook(() => useThemeRuntime());

    const html = exportToHtml("# 标题", {
      title: "Probe",
      theme: "academic",
      mode: currentColorMode(),
      includeOutline: false,
      typography: typographyFromAppearance(readSettings().appearance),
    });

    const onScreen = normalizeFont(computedFont());
    const inFile = normalizeFont(exportedFont(html));
    expect(onScreen).not.toBe("");
    expect(inFile).not.toBe("");
    expect(inFile).toBe(onScreen);
  });

  it("没选字体时，导出里的字体就是主题的那个（不是空串、也不是内置默认值）", () => {
    injectStylesheet("src/styles/tokens.css");
    injectStylesheet("src/themes/academic.css");
    useAcademicTheme();
    renderHook(() => useThemeRuntime());

    const html = exportToHtml("# 标题", {
      title: "Probe",
      theme: "academic",
      mode: currentColorMode(),
      includeOutline: false,
      typography: typographyFromAppearance(readSettings().appearance),
    });

    // 只断言「屏幕 == 导出」是不够的：两边**一起**错的时候它照样是绿的
    // （实测：把内置默认字体改回旧字体栈，屏幕和导出一起变成那个栈，
    //  「导出 == 屏幕」照样通过）。
    // 所以这里再锚一次**主题 CSS 里的那个字体**。
    expect(normalizeFont(exportedFont(html))).toContain("IowanOldStyle");
    expect(normalizeFont(exportedFont(html))).toContain("serif");
  });

  it("选了字体时，导出里的字体 == 屏幕上那个", () => {
    injectStylesheet("src/styles/tokens.css");
    injectStylesheet("src/themes/academic.css");
    useAcademicTheme();
    renderHook(() => useThemeRuntime());

    act(() => {
      updateSettings({ appearance: { fontFamily: "MyOwnFont, sans-serif" } });
    });

    const html = exportToHtml("# 标题", {
      title: "Probe",
      theme: "academic",
      mode: currentColorMode(),
      includeOutline: false,
      typography: typographyFromAppearance(readSettings().appearance),
    });

    expect(normalizeFont(exportedFont(html))).toBe(normalizeFont(computedFont()));
    expect(normalizeFont(exportedFont(html))).toBe("MyOwnFont,sans-serif");
  });
});

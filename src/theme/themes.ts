/**
 * 主题注册表。
 *
 * 主题 = 一组 CSS 变量覆盖 + 元信息。
 * 内置主题直接用 CSS 选择器覆盖 [data-mode] 下的令牌；
 * 第三方主题（M3 之后支持导入 .css 文件）走同一套令牌约定。
 */

import type { ColorMode } from "@/settings/schema";

export interface ThemeDefinition {
  id: string;
  name: string;
  /** 该主题跟随明暗模式变化，还是固定一种 */
  supportsDarkMode: boolean;
  /** 主题 CSS 是否已内置在应用中（外部主题需要动态加载） */
  builtin: boolean;
}

/** 内置主题：亮/暗各一套，靠 data-mode 切换令牌 */
export const BUILTIN_THEMES: ThemeDefinition[] = [
  {
    id: "inkstone-light",
    name: "Inkstone Light",
    supportsDarkMode: true,
    builtin: true,
  },
  {
    id: "github",
    name: "GitHub",
    supportsDarkMode: true,
    builtin: true,
  },
  {
    id: "academic",
    name: "学术写作",
    supportsDarkMode: true,
    builtin: true,
  },
];

export const DEFAULT_THEME_ID = "inkstone-light";

/** 主题 CSS 的静态导入表（后续主题市场走动态 import） */
export const THEME_STYLESHEETS: Record<string, () => Promise<unknown>> = {
  github: () => import("@/themes/github.css"),
  academic: () => import("@/themes/academic.css"),
};

/**
 * 当前**实际生效**的明暗模式。
 *
 * 直接读 `<html>` 上的 `data-mode`——那是 `useThemeRuntime` 写的，
 * 它才是唯一同时管住 CSS 变量与 mermaid 主题的地方。
 * 在这里另存一份状态只会和主题系统分叉。
 *
 * ## 为什么导出链路也要用它
 *
 * 导出原来的明暗模式取的是**设置里的原始值**
 * （`settings.appearance.colorMode`），而那个值可能是 `"auto"`。
 * 于是默认配置（`colorMode: "auto"` + 跟随系统）下，
 * **系统是暗色时：编辑器是暗的、导出是亮的**——
 * 同一份文档两种外观，正是架构约束 C 要避免的。
 *
 * 读 `data-mode` 就没这个问题：它就是**屏幕上那个**模式。
 */
export function currentColorMode(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.mode === "dark" ? "dark" : "light";
}

/**
 * 解析最终生效的明暗模式。
 *
 * ## 语义（2026-10-28 定）
 *
 * - `followSystem` **打开** = **强制**跟随系统，无视「明暗模式」下拉框
 * - `followSystem` **关掉** = 由下拉框决定：
 *   「跟随系统」跟系统，「亮色 / 暗色」固定
 *
 * ## 早先这里是**死代码**
 *
 * 原来的写法是：
 *
 * ```ts
 * if (followSystem && colorMode === "auto") return systemPrefersDark ? "dark" : "light";
 * return colorMode === "auto" ? (systemPrefersDark ? "dark" : "light") : colorMode;
 * ```
 *
 * 两个 `"auto"` 分支**返回的是同一个值**——
 * 所以 `followSystem` 无论传什么都不影响结果，
 * 设置面板里那个复选框点不点都没区别。
 *
 * 实测枚举过 12 种输入组合（`colorMode` × `followSystem` × `systemPrefersDark`），
 * `followSystem` 一次都没改变过结果：它连第二个分支都没走到。
 */
export function resolveColorMode(
  colorMode: ColorMode,
  followSystem: boolean,
  systemPrefersDark: boolean,
): "light" | "dark" {
  // 强制跟随系统：下拉框选了什么都不算数。
  if (followSystem) return systemPrefersDark ? "dark" : "light";
  // 由下拉框决定：「跟随系统」跟系统，亮/暗固定。
  return colorMode === "auto" ? (systemPrefersDark ? "dark" : "light") : colorMode;
}

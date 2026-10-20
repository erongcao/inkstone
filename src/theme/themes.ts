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
 * 解析最终生效的明暗模式。
 * followSystem + auto 时跟随系统，否则取 colorMode。
 */
export function resolveColorMode(
  colorMode: ColorMode,
  followSystem: boolean,
  systemPrefersDark: boolean,
): "light" | "dark" {
  if (followSystem && colorMode === "auto") {
    return systemPrefersDark ? "dark" : "light";
  }
  return colorMode === "auto" ? (systemPrefersDark ? "dark" : "light") : colorMode;
}

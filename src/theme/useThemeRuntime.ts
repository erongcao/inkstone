/**
 * 主题运行时：把设置翻译成 DOM 上的实际表现。
 *
 * 职责：
 * 1. 在 <html> 上设置 data-theme / data-mode，供 CSS 选择器消费
 * 2. 把版式设置（字体、字号、行高、写作区宽度）注入为 inline CSS 变量
 * 3. 注入用户自定义 CSS
 * 4. 监听系统明暗偏好变化
 */

import { useEffect, useMemo, useState } from "react";
import { useSettings } from "@/settings/store";
import { resolveColorMode, THEME_STYLESHEETS } from "./themes";

/** 监听系统是否偏好暗色 */
function useSystemPrefersDark(): boolean {
  const [prefersDark, setPrefersDark] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
  );

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!query) return;
    const listener = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  return prefersDark;
}

/** 供用户在设置里选择的主题 CSS 注入点 */
const CUSTOM_STYLE_ID = "inkstone-custom-css";

export function useThemeRuntime() {
  const [settings] = useSettings();
  const systemPrefersDark = useSystemPrefersDark();

  const mode = useMemo(
    () =>
      resolveColorMode(
        settings.appearance.colorMode,
        settings.appearance.followSystemAppearance,
        systemPrefersDark,
      ),
    [
      settings.appearance.colorMode,
      settings.appearance.followSystemAppearance,
      systemPrefersDark,
    ],
  );

  // 1. data-theme / data-mode
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = settings.appearance.theme;
    root.dataset.mode = mode;
  }, [settings.appearance.theme, mode]);

  // 2. 版式变量
  const appearance = settings.appearance;
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--ink-font-family", appearance.fontFamily);
    root.style.setProperty("--ink-mono-family", appearance.monoFontFamily);
    root.style.setProperty("--ink-font-size", `${appearance.fontSize}px`);
    root.style.setProperty("--ink-line-height", String(appearance.lineHeight));
    root.style.setProperty("--ink-content-width", `${appearance.contentWidth}rem`);
    root.style.setProperty(
      "--ink-page-bg",
      appearance.backgroundColor || "var(--ink-bg)",
    );
  }, [appearance]);

  // 3. 主题 CSS（第三方主题动态加载；Vite 的 CSS 动态 import 会自动注入样式）
  useEffect(() => {
    const loader = THEME_STYLESHEETS[settings.appearance.theme];
    if (!loader) return;
    void loader();
  }, [settings.appearance.theme]);

  // 4. 用户自定义 CSS
  const { customCss } = settings.appearance;
  useEffect(() => {
    let el = document.getElementById(CUSTOM_STYLE_ID);
    if (!el) {
      el = document.createElement("style");
      el.id = CUSTOM_STYLE_ID;
      document.head.appendChild(el);
    }
    el.textContent = customCss;
  }, [customCss]);

  return { mode };
}

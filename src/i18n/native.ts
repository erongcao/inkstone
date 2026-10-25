/**
 * 把当前语言同步给原生侧。
 *
 * 原生菜单（AppKit / GTK / Win32 画的那一排）**不在 webview 里**，
 * 前端这套 `t()` 管不到它——所以语言变了要通知 Rust 一次，让它重建菜单。
 *
 * 浏览器开发模式没有原生菜单，直接跳过。
 */

import type { Locale } from "./index";

/**
 * 同步语言到原生侧
 *
 * 失败只警告不抛错：菜单文案没换过来，不该让整个应用出问题。
 */
export async function syncNativeLocale(locale: Locale): Promise<void> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_locale", { locale });
  } catch (error) {
    console.warn("[i18n] 同步原生菜单语言失败：", error);
  }
}

/**
 * 剪贴板写入动作：复制为 HTML / 复制为 Markdown 源码。
 *
 * 为什么需要单独一层：
 *   接管 `copy` 事件（见 clipboard/index.ts）只能在**用户按 ⌘C**时生效，
 *   而且只能写 DOM `ClipboardEvent.clipboardData` 支持的类型。
 *   菜单项「复制为 HTML」是独立动作，必须直接写系统剪贴板。
 *
 * 两条路径：
 *   - Tauri 桌面端：`tauri-plugin-clipboard-manager`
 *     其 `writeHtml(html, altText)` 在 macOS 上会把 HTML 写到 `public.html` UTI、
 *     同时把 altText 写到 `public.utf8-plain-text` UTI
 *     （底层是 arboard 的 `set_html`，见 arboard-3.7.0/src/platform/osx.rs）。
 *     所以一次调用就能得到「富文本 + 纯文本兜底」两种格式。
 *   - 浏览器（pnpm dev）：`navigator.clipboard.write` 配合 `ClipboardItem`，
 *     Chromium 支持多类型写入。
 *
 * 两条路径都保证：**HTML 与纯文本同时进剪贴板**，
 * 粘贴到 Word/邮件得到富文本，粘贴到别的 Markdown 编辑器得到源码。
 */

/** 是否运行在 Tauri 桌面端 */
export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** 写纯文本 */
export async function writePlainText(text: string): Promise<void> {
  if (isTauriRuntime()) {
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    await writeText(text);
    return;
  }
  await navigator.clipboard.writeText(text);
}

/**
 * 同时写 HTML 与纯文本。
 *
 * @param html 渲染后的 HTML
 * @param text 纯文本版本（Markdown 源码）
 */
export async function writeHtmlAndText(html: string, text: string): Promise<void> {
  if (isTauriRuntime()) {
    const { writeHtml } = await import("@tauri-apps/plugin-clipboard-manager");
    // altText 会同时写到 public.utf8-plain-text UTI
    await writeHtml(html, text);
    return;
  }

  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    // 老浏览器退化为纯文本
    await navigator.clipboard.writeText(text);
    return;
  }

  await navigator.clipboard.write([
    new ClipboardItem({
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob([text], { type: "text/plain" }),
    }),
  ]);
}

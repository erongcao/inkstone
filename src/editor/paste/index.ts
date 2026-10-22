/**
 * 粘贴处理：把剪贴板里的富文本转成 Markdown 插进文档。
 *
 * 为什么需要自己接管：
 * CM6 默认的 paste 处理**只读 `text/plain`**，
 * 从网页复制过来的内容会变成一坨裸 HTML 源码直接塞进文档
 * （`&lt;p&gt;&lt;strong&gt;粗体&lt;/strong&gt;&lt;/p&gt;` 这种）。
 *
 * 来源判定，按优先级：
 *
 * | 优先级 | 剪贴板内容 | 处理 |
 * | --- | --- | --- |
 * | 1 | `text/x-inkstone-markdown`（Inkstone 内部复制） | **原样插入**，逐字节无损 |
 * | 2 | 「粘贴为纯文本」标志已置位 | 只取 `text/plain`，忽略 HTML |
 * | 3 | 只有纯文本 | 原样插入 |
 * | 4 | 纯文本本身就是 Markdown | 原样插入（**Markdown 原样保留**） |
 * | 5 | 网页 / Word 的富文本 | 用 `text/html` 转成 Markdown（**样式净化**） |
 *
 * 实现要点：
 *   - 扩展用 `EditorView.domEventHandlers`：插件的 handler 排在 CM6 内置
 *     handler 前面，返回 true 就把默认行为顶掉（`computeHandlers` 的顺序）
 *   - 转换交给 turndown，见 html-to-markdown.ts
 */

import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { htmlToMarkdown } from "./html-to-markdown";
import { looksLikeMarkdown } from "./detect";
import {
  INKSTONE_MARKDOWN_MIME,
  clearPlainTextPaste,
  isPlainTextPasteArmed,
} from "@/editor/clipboard";
import { handleImagePaste, pasteHasImage } from "@/editor/image-insert";
import { extractDataImageUrl } from "@/ipc/image";

/** 读剪贴板：个别浏览器对某些类型会抛异常，兜住 */
function readClipboard(data: DataTransfer, type: string): string {
  try {
    return data.getData(type) ?? "";
  } catch {
    return "";
  }
}

/**
 * 处理一次粘贴。
 *
 * 单独导出是为了能直接测——
 * jsdom 里构造一个带 `clipboardData` 的 ClipboardEvent 不可靠，
 * 而这个函数的逻辑（选哪种来源、怎么转换）才是真正需要守住的部分。
 *
 * @returns true 表示已处理（调用方应当阻止默认行为）
 */
export function handlePaste(view: EditorView, event: ClipboardEvent): boolean {
  if (view.state.readOnly) return false;

  const data = event.clipboardData;
  if (!data) return false;

  const html = readClipboard(data, "text/html");
  const text = readClipboard(data, "text/plain");
  const inkstoneMarkdown = readClipboard(data, INKSTONE_MARKDOWN_MIME);
  const forcePlainText = isPlainTextPasteArmed(view.state);

  // ── 图片优先 ────────────────────────────────────────────────
  // 剪贴板里有图片文件（系统截图 / 从图片应用复制）时，
  // `text/plain` 往往是空的或一段无意义内容，先把图片存成文件插进去。
  // 从浏览器复制的图片不带 files，只有 `text/html` 里的 data URL —— 走兜底。
  if (!forcePlainText) {
    const dataImage = extractDataImageUrl(html);
    if (pasteHasImage(data, dataImage?.url ?? null)) {
      return handleImagePaste(view, data, dataImage?.url ?? null);
    }
  }

  if (!text.trim() && !html.trim() && !inkstoneMarkdown.trim()) return false;

  // ── 选内容 ───────────────────────────────────────────────────
  let markdown: string;
  if (inkstoneMarkdown) {
    // Inkstone 内部复制：逐字节无损，不做任何转换
    markdown = inkstoneMarkdown;
  } else if (forcePlainText) {
    // 用户明确要求「粘贴为纯文本」：忽略 HTML，只取纯文本
    markdown = text;
  } else if (!html.trim()) {
    // 纯文本：原样插入
    markdown = text;
  } else if (looksLikeMarkdown(text)) {
    // 文本本身就是 Markdown：原样保留，不要动它
    markdown = text;
  } else {
    // 富文本：转成 Markdown
    markdown = htmlToMarkdown(html);
  }

  if (!markdown) return false;

  // replaceSelection 会把每个选区都替换掉，并把光标放到插入内容之后
  const spec = view.state.replaceSelection(markdown);
  view.dispatch({ ...spec, userEvent: "input.paste", scrollIntoView: true });

  // 「粘贴为纯文本」是一次性标志，用完即焚
  if (forcePlainText) {
    view.dispatch({ effects: clearPlainTextPaste.of(null) });
  }
  return true;
}

/**
 * Markdown 粘贴扩展。
 *
 * 注册在 `paste` 事件上；CM6 内置的 paste handler 排在它后面，
 * 我们返回 true 就等于接管了粘贴。
 */
export function markdownPaste(): Extension {
  return EditorView.domEventHandlers({
    // 注意 CM6 的 handler 签名是 (event, view)——事件在前，视图在后
    paste: (event, view) => handlePaste(view, event as ClipboardEvent),
  });
}

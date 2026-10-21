/**
 * 剪贴板：复制（Markdown 源码 + 渲染后 HTML）与「粘贴为纯文本」标志。
 *
 * 为什么要接管 copy 事件：
 *   CM6 默认的复制只写 `text/plain`（选区原文），所以从 Inkstone 复制到
 *   Word / 邮件 / Keynote 只会得到一堆 `**` 和 `[]()` 标记符。
 *   Typora 的做法是**同时写两种 MIME**：
 *     - `text/plain`  → Markdown 源码（粘到别的 Markdown 编辑器是对的）
 *     - `text/html`   → 渲染后的 HTML（粘到 Word / 邮件是富文本）
 *   WebKit 的 copy 事件支持 `clipboardData.setData("text/html", ...)`，
 *   写进去的内容会落到 NSPasteboard 的 `public.html` UTI，与纯文本并存。
 *
 * 还有一个隐藏的坑：Inkstone ↔ Inkstone 复制粘贴。
 *   剪贴板里的 `text/html` 是渲染后的 HTML，如果粘贴时优先用它，
 *   `**bold**` 会被转成 `<strong>bold</strong>` 再转回 `**bold**`——
 *   看似没问题，但遇到表格、嵌套列表、代码块就会丢结构。
 *   所以额外写一个自定义 MIME `text/x-inkstone-markdown`，
 *   粘贴时优先用它，保证**内部复制粘贴逐字节无损**。
 *   （自定义 MIME 跨应用会被系统丢弃，这正是我们要的——
 *     对外的语义交给 text/plain 和 text/html。）
 *
 * 「粘贴为纯文本」：一个一次性标志。
 *   菜单动作设置它，下一次 paste 事件只取 `text/plain`，用完即焚。
 */

import { EditorView } from "@codemirror/view";
import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { ensureMarkdownToHtml, renderMarkdownToHtml } from "@/parser/html-loader";
import { writeHtmlAndText, writePlainText } from "./write";

/** Inkstone 专用的 MIME 类型：标记「这段 Markdown 来自 Inkstone」 */
export const INKSTONE_MARKDOWN_MIME = "text/x-inkstone-markdown";

/** 请求「下次粘贴只用纯文本」 */
export const requestPlainTextPaste = StateEffect.define<null>();

/** 清除「下次粘贴只用纯文本」标志 */
export const clearPlainTextPaste = StateEffect.define<null>();

/**
 * 「下次粘贴强制纯文本」标志。
 *
 * 必须是**模块级**定义：`StateField.define` 每次调用都会生成新的字段实例，
 * 在函数里定义会导致每次重建扩展时字段集合变化、所有值作废。
 */
export const plainTextPasteField = StateField.define<boolean>({
  create: () => false,
  update: (value, tr) => {
    let next = value;
    for (const effect of tr.effects) {
      if (effect.is(requestPlainTextPaste)) next = true;
      else if (effect.is(clearPlainTextPaste)) next = false;
    }
    return next;
  },
});

/** 当前是否处于「下次粘贴用纯文本」状态 */
export function isPlainTextPasteArmed(state: EditorState): boolean {
  return state.field(plainTextPasteField, false) ?? false;
}

/**
 * 取出选区的 Markdown 源码。
 *
 * 只取**主选区**。多选区暂不特殊处理，原因有二：
 *   1. 本项目没有启用 `EditorState.allowMultipleSelections` + `drawSelection`，
 *      多选区在 UI 上本来就不完整
 *   2. 复制到外部应用时用户几乎总是用单选区
 * 将来若要支持多选区拼接（像 VS Code 那样），
 * 这里改成遍历 `state.selection.ranges` 即可。
 */
export function selectedMarkdown(state: EditorState): string {
  const range = state.selection.main;
  return state.sliceDoc(range.from, range.to);
}

/**
 * 处理一次复制。
 *
 * @returns true 表示已处理（调用方应当阻止默认行为）
 */
export function handleCopy(view: EditorView, event: ClipboardEvent): boolean {
  const markdown = selectedMarkdown(view.state);
  if (!markdown) return false;

  const data = event.clipboardData;
  if (!data) return false;

  data.setData("text/plain", markdown);
  // text/html 需要 remark-rehype（按需加载，见 parser/html-loader.ts）。
  // copy 事件必须同步写完，所以这里只能用已加载好的版本；
  // 极少数「刚启动就立刻复制」的情况会退化成只有纯文本。
  const html = renderMarkdownToHtml(markdown);
  if (html) data.setData("text/html", html);
  // 内部复制粘贴的无损通道（见文件头说明）
  try {
    data.setData(INKSTONE_MARKDOWN_MIME, markdown);
  } catch {
    // 个别环境对自定义 MIME 有限制，丢了也不影响对外行为
  }
  event.preventDefault();
  return true;
}

/**
 * 复制选区为渲染后的 HTML（同时附带 Markdown 源码作为纯文本兜底）。
 *
 * 与「按 ⌘C」的区别：⌘C 走 copy 事件（浏览器行为，用户无感），
 * 这个是菜单动作，直接写系统剪贴板。
 */
export async function copySelectionAsHtml(view: EditorView): Promise<void> {
  const markdown = selectedMarkdown(view.state);
  if (!markdown) return;
  // 菜单动作是异步的，可以等渲染器加载完，保证一定有 HTML
  const html = await ensureMarkdownToHtml(markdown);
  await writeHtmlAndText(html, markdown);
}

/** 复制选区为 Markdown 源码（纯文本） */
export async function copySelectionAsMarkdown(view: EditorView): Promise<void> {
  const markdown = selectedMarkdown(view.state);
  if (!markdown) return;
  await writePlainText(markdown);
}

/** 让下一次粘贴只用纯文本（一次性） */
export function armPlainTextPaste(view: EditorView): void {
  view.dispatch({ effects: requestPlainTextPaste.of(null) });
}

/**
 * 复制扩展。
 *
 * 注册在 `copy` 事件上；CM6 内置的 copy handler 排在它后面，
 * 返回 true 就等于接管了复制。
 */
export function markdownCopy(): Extension {
  return [
    plainTextPasteField,
    EditorView.domEventHandlers({
      // 注意 CM6 的 handler 签名是 (event, view)——事件在前，视图在后
      copy: (event, view) => handleCopy(view, event as ClipboardEvent),
    }),
  ];
}

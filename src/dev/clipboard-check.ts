/**
 * 剪贴板自检台（开发用）。
 *
 * 目的：验证「从 Inkstone 复制」之后，系统剪贴板里到底有哪些 MIME 类型。
 *   期望：`text/plain` 是 Markdown 源码，`text/html` 是渲染后的 HTML，
 *   `text/x-inkstone-markdown` 是无损通道。
 *
 * 浏览器的 `navigator.clipboard.read()` 在非安全上下文里可能不可用，
 * 所以同时提供 paste 事件监听作为另一条观察路径。
 *
 * 页面入口：`clipboard-check.html`（vite dev 下访问 /clipboard-check.html）
 *   不在 vite build 的默认入口列表里，**不会进生产包**。
 */

const plainEl = document.getElementById("plain");
const htmlEl = document.getElementById("html");
const typesEl = document.getElementById("types");
const readBtn = document.getElementById("read");
const dropEl = document.getElementById("drop");

function setText(el: HTMLElement | null, value: string): void {
  if (el) el.textContent = value.length > 0 ? value : "（空）";
}

readBtn?.addEventListener("click", async () => {
  try {
    if (!navigator.clipboard?.read) {
      setText(plainEl, "（此环境不支持 navigator.clipboard.read）");
      return;
    }
    const items = await navigator.clipboard.read();
    const lines: string[] = [];
    for (const item of items) {
      for (const type of item.types) {
        const blob = await item.getType(type);
        const text = await blob.text();
        lines.push(`── ${type} ──\n${text}`);
        if (type === "text/plain") setText(plainEl, text);
        else if (type === "text/html") setText(htmlEl, text);
      }
    }
    if (lines.length === 0) setText(plainEl, "（剪贴板为空）");
  } catch (err) {
    setText(plainEl, "读取失败：" + String(err));
  }
});

dropEl?.addEventListener("paste", (event) => {
  const data = (event as ClipboardEvent).clipboardData;
  if (!data) return;
  const lines: string[] = [];
  for (const type of data.types) {
    let value: string;
    try {
      value = data.getData(type);
    } catch {
      value = "（读取失败）";
    }
    lines.push(`── ${type} ──\n${value}`);
    if (type === "text/plain") setText(plainEl, value);
    else if (type === "text/html") setText(htmlEl, value);
  }
  setText(typesEl, lines.join("\n\n"));
  event.preventDefault();
});

document.title = "CLIPBOARD-READY";

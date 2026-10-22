/**
 * HTML 渲染器的按需加载。
 *
 * 背景：`remark-rehype` + `hast-util-to-html` 带来约 **180 KB** 的依赖
 * （主 chunk 从 520 kB 涨到 704 kB，gzip 从 177 kB 涨到 233 kB），
 * 而它只服务「复制为 HTML」这一个**低频**功能。
 * 对一个桌面应用来说这不是包体问题（应用包 4.24 → 4.57 MiB，可接受），
 * 但它会拖慢冷启动——而冷启动有明确目标（< 1.5s）。
 *
 * 所以做成**按需加载**：应用空闲时预加载（`primeHtmlRenderer`），
 * 之后所有同步调用点都能直接拿到结果。
 *
 * 两类调用点：
 *   - **菜单「复制为 HTML」**：异步，可以 `await ensureHtmlRenderer()`，
 *     保证一定有 HTML
 *   - **⌘C 的 copy 事件**：浏览器要求在事件处理**同步完成**内写好剪贴板数据，
 *     不能 await。所以只能用已加载好的版本；
 *     极少数「应用刚启动就立刻复制」的情况会退化成只有纯文本。
 */

/** 渲染函数签名 */
import type { ParseOptions } from "./markdown";

/** 与 `markdownToHtml` 同签名：`options` 必须透传，否则与编辑器内的解析分叉 */
export type HtmlRenderer = (source: string, options?: ParseOptions) => string;

let renderer: HtmlRenderer | null = null;
let pending: Promise<HtmlRenderer> | null = null;

/** 真正加载并缓存渲染器 */
function load(): Promise<HtmlRenderer> {
  if (renderer) return Promise.resolve(renderer);
  if (pending) return pending;
  pending = import("./html")
    .then((mod) => {
      renderer = mod.markdownToHtml;
      return renderer;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

/**
 * 预加载 HTML 渲染器。
 *
 * 建议在应用启动后的空闲时机调用（`requestIdleCallback`）。
 * 加载失败不会抛到调用方——渲染器拿不到时退回纯文本路径即可。
 */
export function primeHtmlRenderer(): void {
  void load().catch(() => {
    /* 预加载失败不影响主流程，菜单动作会再试一次 */
  });
}

/**
 * 同步渲染 Markdown → HTML。
 *
 * @returns 渲染器尚未就绪时返回 null
 */
export function renderMarkdownToHtml(
  source: string,
  options?: ParseOptions,
): string | null {
  return renderer ? renderer(source, options) : null;
}

/** 等待渲染器就绪后渲染（菜单动作等异步场景用） */
export async function ensureMarkdownToHtml(
  source: string,
  options?: ParseOptions,
): Promise<string> {
  const fn = await load();
  return fn(source, options);
}

/** 等待渲染器就绪（异步场景与测试用） */
export async function ensureHtmlRenderer(): Promise<void> {
  await load();
}

/**
 * 同步渲染**行内** Markdown 片段（表格单元格、脚注等）。
 *
 * 返回的是去掉最外层 `<p>` 的内部 HTML——
 * 单元格本来就处在段落里，再套一层 `<p>` 会撑出多余的块级间距。
 *
 * 与 `markdownToHtml` 共用同一个 processor，所以单元格里的
 * 表格内嵌公式 / 任务标记 / 引用链接都按同一套语义渲染（架构约束 C）。
 *
 * @returns 渲染器尚未就绪时返回 null，调用方应退回转义后的纯文本
 */
export function renderInlineHtmlSync(source: string): string | null {
  if (!renderer) return null;
  try {
    const html = renderer(source);
    const match = /^<p>([\s\S]*)<\/p>\n?$/.exec(html);
    return match ? match[1] : html;
  } catch {
    return null;
  }
}

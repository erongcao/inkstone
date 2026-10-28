/**
 * 导出时把图片内联成 data: URI。
 *
 * ## 要解决的破口
 *
 * PDF 导出的打印 HTML 落在**系统临时目录**（`/tmp/inkstone-print/`），
 * 用 `file://` 打开，**没有 `<base>`**——
 * 于是文档里的 `![](assets/fig.png)` 解析到临时目录去，
 * 纸上是**坏图**。
 *
 * HTML 导出也受影响：导出文件被挪走（发给别人、换个目录），
 * 相对路径的图片就断了。
 *
 * ## 为什么内联而不是注入 `<base>`
 *
 * - `<base>` 只解决「目录对不对」，解决不了「文件还在不在」——
 *   HTML 导出文件一旦脱离原目录，图片照样断；
 * - `<base>` 还要求 WebView 能读那个目录（`file://` 下受 Tauri 的
 *   asset scope 限制），得实测才知道行不行；
 * - 内联之后，导出物是**自足**的：打印能出图，HTML 挪走也能看。
 *
 * ## 复用现成的解析
 *
 * Rust 侧早就有 `read_image_data_url`——编辑器显示图片走的就是它
 * （相对路径 → data: URL）。导出链路复用同一条路，
 * 于是「屏幕上是什么，导出里就是什么」（架构约束 C）。
 *
 * ## 为什么在**产物字符串**上做，而不是改语法树
 *
 * 语法树上的图片 URL 在渲染时会被改写（尺寸后缀被剥掉、
 * `=WxH` 变成 width/height 属性），改树要跟那条链路抢顺序。
 * 而产物里的 `<img src="...">` 已经是**干净**的路径。
 *
 * 用受限的正则而不是 DOM 解析，理由与 `highlightCodeBlocks` 相同：
 * 导出产物是我们自己刚生成的，结构已知。
 *
 * ## 失败要**软**
 *
 * 读不到图（文件没了、浏览器里没有本地文件权限）时**保留原地址**，
 * 而不是让整次导出失败——一张图读不到，不该毁掉整份文档。
 */

import { resolveImageSrc } from "@/ipc/image";

/** 解析一个图片地址 → 能显示的 URL（data: URI 或原样返回） */
export type ImageResolver = (docPath: string | null, src: string) => Promise<string>;

/** 内联图片的选项 */
export interface InlineImagesOptions {
  /**
   * 文档路径（相对路径的基准）。
   *
   * 传 `null` 表示「文档还没保存」——相对路径无从解析，
   * 那些图片会原样保留。
   */
  docPath: string | null;
  /** 解析器（默认走 Rust 的 `read_image_data_url`；测试可注入） */
  resolve?: ImageResolver;
}

/**
 * 不用解析的地址前缀。
 *
 * - `data:`  已经是内联的
 * - `http:` / `https:`  远程图**不联网抓**——抓图会让导出依赖网络，
 *   而且远程图的可用性本来就不由我们决定；打印时由就绪门等它加载完
 * - `blob:`  浏览器里的临时地址，导出时已经失效
 *
 * 这一层是**内联器自己的职责**，不能指望解析器恰好原样返回——
 * 解析器是可注入的，行为不该由它兜底。
 */
const SKIP_PREFIXES = ["data:", "http://", "https://", "blob:"];

/**
 * 匹配 `<img>` 标签里的 `src` 属性。
 *
 * - `src` **不一定在第一个**：用户手写的原始 HTML 可能是
 *   `<img alt="x" src="y">`，所以不锚定位置；
 * - 引号两种都认（remark 产出双引号，用户手写可能是单引号）；
 * - `[^>]*?` 非贪婪：避免跨过标签边界。
 *
 * 分三组捕获（前缀 / 引号 / 值）是为了**精确替换**：
 * 直接 `whole.replace(值, 新值)` 会替换掉**第一个**同名片段，
 * `<img alt="a.png" src="a.png">` 就会把 alt 改掉。
 */
const IMG_SRC = /(<img\b[^>]*?\bsrc\s*=\s*)(["'])([^"']*)\2/gi;

/**
 * HTML 实体解码。
 *
 * 为什么需要：产物里 `&` 会被编码成 `&#x26;`
 * （实测 `![](a.png?x=1&y=2)` → `src="a.png?x=1&#x26;y=2"`）。
 * 不解码就拿去解析，路径是错的。
 */
function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_m, dec: string) =>
      String.fromCodePoint(Number.parseInt(dec, 10)),
    );
}

/**
 * 把 HTML 属性值里的特殊字符转义回去。
 *
 * data: URI 里是 base64（`A-Za-z0-9+/=`）与 MIME（`;` `,` `/`），
 * 本身不需要转义——但**统一转义**更稳，
 * 也免得解析器将来返回带 `&` 的地址时把属性写坏。
 */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * 把导出产物里的相对路径图片换成 data: URI。
 *
 * @param html 导出产物
 * @param options 文档路径与解析器
 * @returns 内联后的产物（读不到图的地址原样保留）
 */
export async function inlineImages(
  html: string,
  options: InlineImagesOptions,
): Promise<string> {
  const resolve = options.resolve ?? resolveImageSrc;

  // 先把要解析的地址收集起来：**同一张图只解析一次**。
  //
  // 为什么要收集：一张 2MB 的图 base64 出来是 2.7MB，
  // 重复解析既慢又占内存。
  const sources = new Set<string>();
  for (const match of html.matchAll(IMG_SRC)) {
    const raw = match[3];
    if (raw === "") continue;
    const decoded = decodeEntities(raw);
    if (decoded === "") continue;
    // 已经内联 / 远程 / blob 的不解析
    if (SKIP_PREFIXES.some((prefix) => decoded.startsWith(prefix))) continue;
    sources.add(decoded);
  }
  if (sources.size === 0) return html;

  // 解析全部图片。**一个失败不影响别的**。
  const resolved = new Map<string, string>();
  await Promise.all(
    [...sources].map(async (src) => {
      try {
        const url = await resolve(options.docPath, src);
        if (url) resolved.set(src, url);
      } catch {
        // 读不到就保留原地址——一张图不该毁掉整次导出。
      }
    }),
  );
  if (resolved.size === 0) return html;

  // 换掉 src 的值。
  //
  // 用捕获组**重建**这一段，而不是在整段里做字符串替换——
  // 后者会替换掉**第一个**同名片段（`alt` 里也可能是同一个地址）。
  return html.replace(IMG_SRC, (whole, prefix: string, quote: string, raw: string) => {
    const url = resolved.get(decodeEntities(raw));
    if (url === undefined) return whole;
    return `${prefix}${quote}${escapeAttribute(url)}${quote}`;
  });
}

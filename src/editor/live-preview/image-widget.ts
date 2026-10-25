/**
 * 图片渲染 widget。
 *
 * ## 为什么图片要「异步加载」
 *
 * 相对路径的图片在浏览器里**拿不到**——WebView 没有文件系统，
 * 必须让 Rust 读出来拼成 `data:` URL（见 `src-tauri/src/asset.rs` 顶部的理由）。
 * 而 `WidgetType.toDOM()` 是同步的，加载完再重建装饰器会闪烁。
 *
 * 所以：先渲染一个占位（替代文本 / 骨架），异步拿到 URL 后**原地补 DOM**。
 * CM6 会保留 widget 的 DOM，所以这个补丁是安全的；
 * 即使 widget 已经被销毁，补在游离节点上也无害。
 *
 * ## 缓存
 *
 * 结果按 `(文档路径 + src)` 缓存。图片在一次会话里通常不变，
 * 缓存避免了「每次击键都重新读一遍磁盘」。
 * 失败结果**不缓存**——用户刚把图片拖进目录，刷新一下就该显示出来。
 */

import { WidgetType } from "@codemirror/view";
import { currentDocumentPath } from "@/ipc/document";
import { resolveImageSrc } from "@/ipc/image";
import { t } from "@/i18n";

/** 已解析的图片地址 */
const resolved = new Map<string, string>();

/**
 * 缓存上限。
 *
 * 键是「文档路径 + 地址」，切换文档不会串味，但一直开着文档换图会无限增长。
 * 到上限就丢最老的一半——LRU 的简化版：图片访问本来就是局部的，
 * 精确的 LRU 收益抵不上它带来的每次访问记账。
 */
const CACHE_LIMIT = 200;

function cacheKey(docPath: string | null, src: string): string {
  return `${docPath ?? ""}\u0000${src}`;
}

/** 记一条成功结果，顺带做容量控制 */
function remember(key: string, url: string): void {
  if (resolved.size >= CACHE_LIMIT) {
    const drop = Math.ceil(CACHE_LIMIT / 2);
    let n = 0;
    for (const existing of resolved.keys()) {
      resolved.delete(existing);
      if (++n >= drop) break;
    }
  }
  resolved.set(key, url);
}

/** 图片 widget 的渲染结果 */
export interface ImageRenderResult {
  dom: HTMLElement;
  /** 内容指纹：src + 解析结果 */
  key: string;
}

/** 占位块尺寸，避免图片加载完成时整篇文档往下跳 */
const SKELETON = { minWidth: "160px", minHeight: "90px" };

/**
 * 把一张图片渲染成 DOM。
 *
 * @param src    Markdown 里的原始地址（可能是相对路径）
 * @param alt    替代文本
 * @param from   在文档中的起点（点击图片要把光标移回来）
 * @param width  显式宽度（px）。来自 Typora / Obsidian 的尺寸扩展，见 `image-size.ts`
 * @param height 显式高度（px）。只给宽度时留空——猜高度会把图拉伸变形
 */
export function renderImage(
  src: string,
  alt: string,
  from: number,
  width?: number,
  height?: number,
): ImageRenderResult {
  const docPath = currentDocumentPath();
  // 解析结果（URL）按 src 缓存是对的，但**渲染结果**还取决于尺寸：
  // 同一张图在文档里出现两次、一次 200 宽一次 400 宽，DOM 必须不同。
  // 所以 widget 的 key 里额外带上尺寸。
  const size = width === undefined ? "" : `\u0000${width}x${height ?? ""}`;
  const key = cacheKey(docPath, src) + size;

  const dom = document.createElement("span");
  dom.className = "cm-md-image";
  // 点击图片要把光标移回源码位置（mousedown 靠这个属性分发）
  dom.dataset.imageFrom = String(from);
  // hover 提示用的原始地址。图片加载后用户只能看到图，
  // 不知道它指向哪个文件——尤其相对路径的图，猜不出来。
  // 同样走纯 CSS（`content: attr(data-image-src)`），不需要 JS 浮层。
  dom.dataset.imageSrc = src;
  if (alt) dom.dataset.imageAlt = alt;

  const cached = resolved.get(key);
  if (cached) {
    dom.appendChild(buildImg(cached, alt, width, height));
    return { dom, key: `${key}\u0000${cached}` };
  }

  // 占位：先给一个带骨架样式的框，图片到位后替换
  const placeholder = document.createElement("span");
  placeholder.className = "cm-md-image__placeholder";
  placeholder.textContent = alt || t("图片");
  Object.assign(placeholder.style, SKELETON);
  dom.appendChild(placeholder);

  void resolveImageSrc(docPath, src)
    .then((url) => {
      remember(key, url);
      // widget 可能已经被销毁/替换：只在自己仍是当前占位时才动手
      if (placeholder.parentNode !== dom) return;
      dom.replaceChild(buildImg(url, alt, width, height), placeholder);
      dom.dataset.imageLoaded = "1";
    })
    .catch(() => {
      if (placeholder.parentNode !== dom) return;
      placeholder.classList.add("cm-md-image__placeholder--failed");
      placeholder.textContent = alt || src || t("图片加载失败");
      dom.title = src;
    });

  return { dom, key };
}

/** 真正的 `<img>` */
function buildImg(
  url: string,
  alt: string,
  width?: number,
  height?: number,
): HTMLImageElement {
  const img = document.createElement("img");
  img.src = url;
  img.alt = alt;
  img.loading = "lazy";
  img.draggable = false;
  // 只给宽度时必须让高度自动：两个都设会按原比例拉伸变形。
  // 反过来（只给高度）不常见，但同样只设一个。
  //
  // **必须用 setAttribute，不能用 `img.width = …`**（浏览器实测）：
  // IDL 属性走反射，SVG 这类**没有固有尺寸**的图片上不落 attribute——
  // 产物里确实带着赋值语句，DOM 上却查不到 width，形不成尺寸。
  // 显式写 attribute 在任何图片类型上都一致。
  if (width !== undefined) img.setAttribute("width", String(width));
  if (height !== undefined) img.setAttribute("height", String(height));
  return img;
}

/** 供测试与「图片变了要重建」判断 */
export class ImageWidget extends WidgetType {
  constructor(
    readonly result: ImageRenderResult,
    readonly from: number,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    return this.result.dom;
  }

  eq(other: ImageWidget): boolean {
    return other.result.key === this.result.key;
  }

  ignoreEvent(): boolean {
    // 返回 false：点击图片要把光标移回源码位置，所以事件要冒泡出去
    return false;
  }
}

/** 清空缓存（切换文档时用，避免旧文档的图片路径污染新文档） */
export function clearImageCache(): void {
  resolved.clear();
}

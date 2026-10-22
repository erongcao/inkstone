/**
 * 图片资源的前端入口：落盘一张图、把 Markdown 里的图片地址变成能显示的 URL。
 *
 * 与 `ipc/document.ts` 同一套约定：**有 Tauri 走命令，没有就降级**。
 * 降级不是「假装成功」——浏览器里没法往文件系统写，
 * 所以 `saveImage` 直接报错，让 UI 告诉用户「保存文档后再拖图片」，
 * 而不是插一句指向不存在文件的 Markdown 进去（那会污染文档、红线 1）。
 */

const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** 图片扩展名白名单：拖进来的其它文件按普通文本处理，不当图片 */
const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "ico",
  "avif",
  "heic",
  "heif",
  "tif",
  "tiff",
]);

/** 取小写扩展名（不含点） */
export function extensionOf(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** 这个文件名看起来是不是一张图片 */
export function isImageFileName(name: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(name));
}

/**
 * 从文件名猜一个替代文本。
 *
 * 截图粘贴进来的文件叫 `image.png`、`Screen Shot 2026-10-23.png`——
 * 直接当替代文本会很怪。Typora 的做法是**留空**：
 * `![](assets/xxx.png)`，空 alt 既是通行约定，也对读屏软件更友好
 * （装饰性图片就该标成装饰性）。这里照做。
 */
export function altTextFor(_fileName: string): string {
  return "";
}

/**
 * 把图片存到文档旁边的 `assets/` 目录，返回写进 Markdown 的路径。
 *
 * @param docPath 当前文档路径；null 表示未命名（存到 `~/Pictures/Inkstone/`）
 */
export async function saveImage(
  docPath: string | null,
  fileName: string,
  bytes: ArrayBuffer,
): Promise<string> {
  if (!isTauri()) {
    throw new Error("浏览器里无法写入图片文件，请先保存文档再插入图片");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<string>("save_image", {
    docPath,
    fileName,
    dataBase64: arrayBufferToBase64(bytes),
  });
}

/**
 * 把 Markdown 里的图片地址解析成 WebView 能显示的 URL。
 *
 * `http(s)` / `data:` 原样返回（不必绕一圈磁盘）；
 * 相对路径与绝对路径交给 Rust 按**文档目录**解析。
 */
export async function resolveImageSrc(
  docPath: string | null,
  src: string,
): Promise<string> {
  const trimmed = src.trim();
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("http://") ||
    lower.startsWith("https://") ||
    lower.startsWith("data:")
  ) {
    return trimmed;
  }
  if (!isTauri()) {
    throw new Error("浏览器里无法读取本地图片文件");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<string>("read_image_data_url", { docPath, src: trimmed });
}

/**
 * ArrayBuffer → base64。
 *
 * 自己转而不是 `btoa(String.fromCharCode(...bytes))`：
 * 后者对大图会**爆栈**（一次 spread 上百万个参数），
 * 而且 `btoa` 只接受 Latin-1，遇到中文文件名会直接抛 `InvalidCharacterError`。
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  // 分块 0x8000（32 KB）：既不会爆栈，也不会生成几百万个中间字符串
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * 从一段 HTML 里抠出第一张 `data:` 图片。
 *
 * 从浏览器复制图片时，剪贴板里同时有 `text/html`（`<img src="data:image/png;base64,…">`）
 * 和 `text/plain`（可能是一段 URL 甚至什么都没有）。
 * 只看 `files` 会漏掉这一路，所以这里补一条兜底。
 */
export function extractDataImageUrl(html: string): { url: string; ext: string } | null {
  const match =
    /<img\b[^>]*\bsrc\s*=\s*["'](data:image\/([a-z0-9.+-]+);base64,[^"']+)["']/i.exec(
      html,
    );
  if (!match) return null;
  const mime = match[2].toLowerCase();
  const ext = mime === "jpeg" ? "jpg" : mime === "svg+xml" ? "svg" : mime;
  return { url: match[1], ext };
}

/** 从 `data:` URL 取出裸 base64 部分 */
export function dataUrlToBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma === -1 ? "" : dataUrl.slice(comma + 1);
}

/**
 * 把图片插进文档：拖放与剪贴板两条路径共用。
 *
 * 流程固定三步（截图粘贴 / 拖文件进来完全一样）：
 *   1. 拿到原始字节
 *   2. 存到文档旁边的 `assets/`，换回一个**相对文档**的路径
 *   3. 把 `![替代文本](路径)` 插进光标处
 *
 * ## 为什么一定要落盘，而不是插 `data:` URL
 *
 * `![](data:image/png;base64,…)` 在 Markdown 里能渲染，但它是一坨不可读的
 * 源码、永远无法被检索/替换，导出到别处（GitHub、PDF）体积也会暴涨。
 * 而且这违反架构红线 1：图片**不是**正文，把它塞进正文里就是在污染文档。
 *
 * ## 为什么一次只 dispatch 一次
 *
 * 多张图要连续保存，每次保存一次事务会让撤销栈里出现 N 步，
 * 按一次 ⌘Z 只能撤掉最后一张——用户预期是「一次撤销掉刚才整个拖放」。
 */

import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { currentDocumentPath } from "@/ipc/document";
import {
  altTextFor,
  dataUrlToBase64,
  extensionOf,
  isImageFileName,
  saveImage,
} from "@/ipc/image";

/** 一个待插入的图片 */
interface PendingImage {
  /** 存好之后的相对/绝对路径 */
  path: string;
}

/** 构造 Markdown：空 alt，路径里的空格不转义（源码里可读优先） */
function imageMarkdown(path: string): string {
  return `![${altTextFor(path)}](${path})`;
}

/**
 * 一次性把若干图片插到 `pos`。
 *
 * 任一张存失败就整批放弃：不插一半——那会留下指向不存在文件的链接。
 */
async function insertAll(view: EditorView, pos: number, files: File[]): Promise<boolean> {
  if (files.length === 0) return false;
  const docPath = currentDocumentPath();
  const saved: PendingImage[] = [];
  try {
    for (const file of files) {
      const path = await saveImage(docPath, file.name, await file.arrayBuffer());
      saved.push({ path });
    }
  } catch (error) {
    console.warn("[Inkstone] 图片插入失败：", error);
    return false;
  }
  applyInsert(view, pos, saved.map((item) => imageMarkdown(item.path)).join("\n\n"));
  return true;
}

/** 从一段 `data:` 图片 URL 插入（从浏览器复制图片时的兜底路径） */
async function insertDataUrl(
  view: EditorView,
  pos: number,
  dataUrl: string,
): Promise<boolean> {
  const base64 = dataUrlToBase64(dataUrl);
  if (!base64) return false;
  try {
    const path = await saveImage(
      currentDocumentPath(),
      `image.${dataUrlExtension(dataUrl)}`,
      base64ToArrayBuffer(base64),
    );
    applyInsert(view, pos, imageMarkdown(path));
    return true;
  } catch (error) {
    console.warn("[Inkstone] 图片插入失败：", error);
    return false;
  }
}

/** 真正的写文档动作：一次事务，可撤销 */
function applyInsert(view: EditorView, pos: number, markdown: string): void {
  view.dispatch({
    changes: { from: pos, insert: markdown },
    selection: { anchor: pos + markdown.length },
    userEvent: "input.drop",
    scrollIntoView: true,
  });
  view.focus();
}

/** `data:image/png;base64,…` → `png` */
function dataUrlExtension(dataUrl: string): string {
  const match = /^data:image\/([a-z0-9.+-]+);/i.exec(dataUrl);
  const mime = (match?.[1] ?? "png").toLowerCase();
  return mime === "jpeg" ? "jpg" : mime === "svg+xml" ? "svg" : mime;
}

/** base64 → ArrayBuffer（走 `atob`，不经过 `btoa` 的 Latin-1 限制） */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** 从剪贴板里挑出图片文件 */
export function imageFilesFrom(data: DataTransfer | null): File[] {
  if (!data?.files) return [];
  return Array.from(data.files).filter((file) => isImageFileName(file.name));
}

/**
 * 这个拖进来的文件是不是图片。
 *
 * 看**文件名或 MIME**，两个都认：从网页拖图片有时文件名是 `blob`
 * 或空串，只有 `type` 靠谱；从 Finder 拖则反过来。
 * 两者都判不出来才放弃——宁可漏一张图，也不要把 .md 当图片存进 assets/。
 */
export function looksLikeImage(file: File): boolean {
  if (isImageFileName(file.name)) return true;
  if (file.type.startsWith("image/")) return true;
  // 有些来源 type 是空的，但扩展名还挂在 `name` 的 query 上（某些浏览器）
  const name = file.name.split(/[?#]/)[0];
  return isImageFileName(name) || isImageFileName(extensionOf(file.type));
}

/** 这次拖放里有没有图片 */
export function dropHasImage(data: DataTransfer | null): boolean {
  return Array.from(data?.files ?? []).some(looksLikeImage);
}

/** 这次粘贴里有没有图片（文件优先，其次 HTML 里的 data URL） */
export function pasteHasImage(
  data: DataTransfer | null,
  dataUrl: string | null,
): boolean {
  return imageFilesFrom(data).length > 0 || dataUrl !== null;
}

/**
 * 处理一次图片拖放。
 *
 * **必须同步返回**：CM6 的 `domEventHandlers` 签名是 `(event, view) => boolean`，
 * 返回 `Promise` 类型都对不上。所以这里同步 `preventDefault()` 顶掉浏览器默认落点，
 * 真正的「读字节 → 存盘 → 插文档」在后台异步跑。
 *
 * @returns true 表示已处理
 */
export function handleImageDrop(view: EditorView, event: DragEvent): boolean {
  if (view.state.readOnly) return false;
  const files = Array.from(event.dataTransfer?.files ?? []).filter(looksLikeImage);
  if (files.length === 0) return false;

  event.preventDefault();
  // 落点用坐标算；算不出来（例如拖到编辑器外）就退回当前光标
  const coords = view.posAtCoords({ x: event.clientX, y: event.clientY });
  const pos = coords ?? view.state.selection.main.head;
  void insertAll(view, pos, files);
  return true;
}

/** 处理剪贴板里的图片（供 paste 模块调用；同样必须同步返回） */
export function handleImagePaste(
  view: EditorView,
  data: DataTransfer | null,
  dataUrl: string | null,
): boolean {
  if (view.state.readOnly) return false;
  const files = imageFilesFrom(data);
  if (files.length > 0) {
    void insertAll(view, view.state.selection.main.head, files);
    return true;
  }
  if (dataUrl) {
    void insertDataUrl(view, view.state.selection.main.head, dataUrl);
    return true;
  }
  return false;
}
/**
 * 图片拖放扩展。
 *
 * 注册在 `dragover` / `drop` 上。**`dragover` 必须 `preventDefault`**——
 * 浏览器默认不允许放置，不接管的话连 `drop` 都不会触发。
 */
export function imageDrop(): Extension {
  return EditorView.domEventHandlers({
    dragover: (event) => {
      const drag = event as DragEvent;
      if (drag.dataTransfer?.types?.includes("Files")) {
        drag.preventDefault();
        return true;
      }
      return false;
    },
    drop: (event, view) => handleImageDrop(view, event as DragEvent),
  });
}

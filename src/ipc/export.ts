/**
 * 导出相关的 IPC 绑定。
 *
 * 与 `ipc/document.ts` 同一套约定：**有 Tauri 走命令，没有就降级**。
 *
 * ## 降级不是「假装成功」
 *
 * 浏览器里没法弹原生保存对话框、没法跑 pandoc。所以：
 *   - 存盘 → 走浏览器下载（Blob + `<a download>`），这是真能用的
 *   - pandoc → **如实报错**，不静默产出空文件
 *
 * 静默产出空文件是最坏的结果：用户以为导出了，打开一看是 0 字节。
 */

import type { ExportFormat } from "@/export/registry";
import { t } from "@/i18n";

/** pandoc 探测结果（与 Rust 侧 `PandocInfo` 对应） */
export interface PandocInfo {
  available: boolean;
  version: string;
  path: string;
  reason: string;
}

const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * 当前是不是浏览器降级模式。
 *
 * 导出流程要靠它区分两件本质不同的事：
 *   - 「用户取消了保存对话框」→ 该停下来，不产出任何东西
 *   - 「浏览器里根本没有保存对话框」→ 该走下载路径把内容产出来
 *
 * 把这两者混为一谈（都当成 null 返回）的话，浏览器里点导出什么都不会发生，
 * 而用户看到的提示是「已取消导出」——那是在**撒谎**。
 */
export function isBrowserFallback(): boolean {
  return !isTauri();
}

/* ── 浏览器降级 ── */

/** 浏览器里用 Blob 下载，文件名沿用后缀 */
function downloadInBrowser(content: string, fileName: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // 立刻 revoke 会让还没开始的下载拿到空内容
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/* ── 公共 API ── */

/**
 * 弹「另存为」对话框，返回目标路径；用户取消时返回 null。
 *
 * 浏览器降级模式**返回 null 但不下载**——下载发生在 `writeTextFile` 里。
 * 在这里下载一次、`writeTextFile` 再下载一次，会得到两个文件，
 * 而且第一个是空的。
 *
 * @param format 导出格式（决定过滤器与默认扩展名）
 * @param suggestedName 建议文件名（**不带**扩展名）
 */
export async function pickExportPath(
  format: ExportFormat,
  suggestedName: string,
): Promise<string | null> {
  if (!isTauri()) {
    // 浏览器里没有路径概念，留给 writeTextFile 用 Blob 下载
    return null;
  }

  const { invoke } = await import("@tauri-apps/api/core");
  if (format.kind === "pandoc") {
    return await invoke<string | null>("pick_pandoc_output", {
      format: format.pandocFormat ?? format.id,
      suggestedName: `${suggestedName}${format.extension}`,
    });
  }

  // HTML / PDF 走通用的「另存为」
  const { save } = await import("@tauri-apps/plugin-dialog");
  const picked = await save({
    title: t("导出"),
    defaultPath: `${suggestedName}${format.extension}`,
    filters: [{ name: format.label, extensions: [format.extension.replace(".", "")] }],
  });
  return typeof picked === "string" ? picked : null;
}

/**
 * 把文本内容写到磁盘。
 *
 * 只用于 HTML 导出（文本）。二进制格式由 pandoc 自己写文件，
 * 不经过这里（见 pandoc.ts 的说明）。
 */
export async function writeTextFile(path: string, content: string): Promise<void> {
  if (!isTauri()) {
    const name = path.split(/[/\\]/).pop() ?? "export.html";
    downloadInBrowser(content, name);
    return;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("write_export_file", { path, content });
}

/**
 * 探测 pandoc 是否可用。
 *
 * 浏览器里一律返回「不可用」——不假装有。
 */
export async function detectPandoc(): Promise<PandocInfo> {
  if (!isTauri()) {
    return {
      available: false,
      version: "",
      path: "",
      reason: t("浏览器降级模式无法调用 pandoc"),
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<PandocInfo>("detect_pandoc");
}

/**
 * pandoc 的输出。
 *
 * `warnings` 是 pandoc 自己的警告——不影响导出成功，但用户应该知道。
 * 实测例子：转 docx/odt/epub 时遇到块级公式会警告
 * 「Could not convert TeX math … rendering as TeX」，
 * 也就是说 Word 里的公式会变成一段 TeX 源码。
 */
export interface PandocOutput {
  warnings: string[];
}

/**
 * 用 pandoc 把 Markdown 转成目标格式。
 *
 * @param format pandoc 的输出格式名（`docx` / `epub` / …）
 * @param source Markdown 源码（含 front matter）
 * @param outputPath 目标文件路径（由 pickExportPath 取得）
 * @param resourceDir 文档所在目录，供 pandoc 解析相对路径图片
 */
export async function convertWithPandoc(
  format: string,
  source: string,
  outputPath: string,
  resourceDir: string,
): Promise<PandocOutput> {
  if (!isTauri()) {
    throw new Error(t("浏览器降级模式无法调用 pandoc，请在桌面应用里导出"));
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<PandocOutput>("convert_with_pandoc", {
    format,
    source,
    outputPath,
    resourceDir,
  });
}

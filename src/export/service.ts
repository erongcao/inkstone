/**
 * 导出服务：把「当前文档 + 用户设置」变成「磁盘上的一个文件」。
 *
 * ## 编排顺序（每一步的顺序都有讲究）
 *
 *   1. 读文档内容（**从 store 拿**，不是从 DOM——DOM 里的是编辑器状态，存盘用的一定是文本）
 *   2. 解析 front matter（拿元数据 + 导出设置覆盖）
 *   3. 算出变量上下文（标题、作者、路径、字数…）
 *   4. 算目标文件名（变量模板 → 实际文件名）
 *   5. 弹「另存为」→ 拿到路径
 *   6. 按 kind 分派：HTML 自己写 / pandoc 自己写 / PDF 走打印
 *
 * 第 4 步在第 5 步之前：文件名要用变量替换完的结果，而变量依赖 front matter。
 *
 * ## 红线 1 的体现
 *
 * 整个流程**只读**文档内容，从不写回。
 * 导出是一次「读 → 转换 → 写到别处」的操作，
 * 绝不能把导出的中间产物写回源文件（那会污染用户的 Markdown）。
 */

import { parseMarkdown } from "@/parser/markdown";
import { readFrontMatter, readExportOverrides, stringField } from "./frontmatter";
import type { FrontMatterExportOverrides } from "./frontmatter";
import {
  applyVariables,
  basenameOf,
  dirnameOf,
  type ExportVariable,
  type VariableContext,
} from "./variables";
import { exportToHtml } from "./html";
import { sanitizeFileName, suggestFileName, type ExportFormat } from "./registry";
import { findResolvedExportItem } from "./items";
import {
  convertWithPandoc,
  detectPandoc,
  isBrowserFallback,
  pickExportPath,
  writeTextFile,
} from "@/ipc/export";
import { getDocumentContent, getDocumentState } from "@/ipc/document";
import { readSettings } from "@/settings/store";
import { buildIndexFromTree } from "@/editor/document-index";
import { ensureMathRenderer } from "@/editor/render/math-loader";

/** 导出结果 */
export interface ExportResult {
  /** 是否成功 */
  ok: boolean;
  /** 产出文件的路径；用户取消时为 null */
  path: string | null;
  /** 给用户看的一句话 */
  message: string;
  /** 失败原因 */
  error: string | null;
  /**
   * 导出过程中的警告。
   *
   * 目前主要来自 pandoc——它会警告「块级公式无法转成 OMML，降级成 TeX」这类事。
   * 导出**成功**了，但产物里有瑕疵，用户应该知道。
   */
  warnings?: string[];
}

/** 导出过程中的中间产物（供测试与 UI 复用） */
export interface ExportContext {
  /** 文档正文（含 front matter 原文） */
  content: string;
  /** 文档标题 */
  title: string;
  /** 变量上下文 */
  variables: VariableContext;
  /** 变量定义表（applyVariables 需要它） */
  definitions: ExportVariable[];
  /** 要用的导出格式 */
  format: ExportFormat;
  /** 最终文件名（含扩展名） */
  fileName: string;
  /**
   * front matter 里读到的导出设置覆盖。
   *
   * 空的（`{}`）表示「没开 front matter 覆盖」或「front matter 里没写相关内容」，
   * 此时一律用设置面板里的值。
   */
  overrides: FrontMatterExportOverrides;
}

/**
 * 从 front matter 与正文里推出文档标题。
 *
 * 优先级：front matter 的 `title` → 第一个一级标题 → 文件名 → 「未命名」。
 * 与 Typora 一致。
 */
export function deriveTitle(
  fields: Record<string, unknown>,
  content: string,
  filePath: string | null,
): string {
  const fromFrontMatter = stringField(fields, "title");
  if (fromFrontMatter?.trim()) return fromFrontMatter.trim();

  // 第一个一级标题
  const match = /^#\s+(.+)$/m.exec(content);
  if (match) {
    const text = match[1].trim();
    if (text) return text;
  }

  if (filePath) {
    const name = basenameOf(filePath).replace(/\.(md|markdown|mdown|mkd|txt)$/i, "");
    if (name) return name;
  }
  return "未命名";
}

/**
 * 组装变量上下文。
 *
 * @param extraVariables 用户在设置里配的变量（front matter 的会叠加在上面）
 * @returns 变量上下文，以及完整的变量**定义表**（applyVariables 需要它）
 */
export function buildVariableContext(
  fields: Record<string, unknown>,
  content: string,
  filePath: string | null,
  extraVariables: ExportVariable[] = [],
): { ctx: VariableContext; definitions: ExportVariable[] } {
  const index = buildIndexFromTree(parseMarkdown(content));
  const fileName = filePath ? basenameOf(filePath) : "";

  // 内置变量：名字与 `src/export/variables.ts` 的 `BUILTIN_VARIABLE_LABELS` 一一对应。
  // 顺序即面板里的显示顺序。
  const builtin: Array<[string, ExportVariable["source"]]> = [
    ["title", "title"],
    ["author", "author"],
    ["date", "date"],
    ["filename", "filename"],
    ["filenameNoExt", "filenameNoExt"],
    ["path", "path"],
    ["directory", "directory"],
    ["today", "today"],
    ["now", "now"],
    ["words", "words"],
    ["chars", "chars"],
  ];

  const definitions: ExportVariable[] = [
    ...builtin.map(([name, source]) => ({ name, source })),
    ...extraVariables,
  ];

  const ctx: VariableContext = {
    title: deriveTitle(fields, content, filePath),
    author: stringField(fields, "author") ?? "",
    date: stringField(fields, "date") ?? "",
    filename: fileName,
    path: filePath,
    words: index.stats.words,
    chars: index.stats.chars,
    now: new Date(),
  };

  return { ctx, definitions };
}

/**
 * 组装完整的导出上下文。
 *
 * 单独抽出来是为了能测：「给定一份文档 + 一份设置，算出该导出什么、叫什么名字」，
 * 这一步不需要真的弹对话框也不需要真的写盘。
 */
export function prepareExport(
  format: ExportFormat,
  content = getDocumentContent(),
  path = getDocumentState().path,
): ExportContext {
  const settings = readSettings();
  const tree = parseMarkdown(content);
  const frontMatter = readFrontMatter(tree);
  const fields = frontMatter.fields;

  // front matter 覆盖导出设置——**只在显式开启时生效**（安全默认）
  const overrides = settings.export.readExportSettingsFromFrontMatter
    ? readExportOverrides(fields)
    : {};

  // 用户在设置里配的变量 + front matter 里的变量（front matter 优先）
  const configured = settings.export.variables ?? [];
  const fromFrontMatter: ExportVariable[] = Object.entries(overrides.variables ?? {}).map(
    ([name, value]) => ({
      name,
      source: "custom" as const,
      value,
    }),
  );
  const variables = [...configured, ...fromFrontMatter];

  const { ctx, definitions } = buildVariableContext(fields, content, path, variables);

  // 文件名模板：front matter 的优先于设置里的
  const template = overrides.fileNameTemplate ?? settings.export.fileNameTemplate;
  const rawName = template ? applyVariables(template, definitions, ctx) : ctx.title;
  // 再兜一层：模板里可能有非法字符
  // 注意 suggestFileName 已经带过扩展名，所以这里不能重复加——
  // 否则会得到「我的文档.html.html」
  const fileName = template
    ? `${sanitizeFileName(rawName)}${format.extension}`
    : suggestFileName(rawName, format.extension);

  return {
    content,
    title: ctx.title,
    variables: ctx,
    definitions,
    format,
    fileName,
    overrides,
  };
}

/**
 * 把文件名里的非法字符清掉。
 *
 * 实现在 `registry.ts`（与 `suggestFileName` 共用一份）——
 * 文件名清理的规则只有一处，两处各写一份必然漂移。
 */
export { sanitizeFileName };

/**
 * 执行一次导出。
 *
 * @param formatId 导出格式 id
 */
export async function exportDocument(formatId: string): Promise<ExportResult> {
  const settings = readSettings();
  // 按**解析后的导出项**查找，而不是直接查内置清单——
  // 用户加的额外格式（pandoc:gfm 之类）也要能导出，
  // 而被移除的项不该还能被触发。
  const item = findResolvedExportItem(formatId, settings.export.items);
  if (!item) {
    return {
      ok: false,
      path: null,
      message: "未知导出格式",
      error: `未知的导出格式: ${formatId}`,
    };
  }
  if (!item.visible) {
    return {
      ok: false,
      path: null,
      message: "该导出项已被移除",
      error: `导出项 ${formatId} 已被用户移除`,
    };
  }
  const format = item.format;
  const context = prepareExport(format);

  // pandoc 格式：先探测可用性，别让用户等完对话框才发现没装
  if (format.kind === "pandoc") {
    const pandoc = await detectPandoc();
    if (!pandoc.available) {
      return {
        ok: false,
        path: null,
        message: `无法导出 ${format.label}：${pandoc.reason}`,
        error: pandoc.reason,
      };
    }
  }

  const suggestedBase = context.fileName.replace(/\.[^.]+$/, "");
  const path = await pickExportPath(format, suggestedBase);

  // 「没有路径」有两种含义，必须分开：
  //   - 浏览器降级模式：没有保存对话框，但仍然要把内容产出出来（走下载）
  //   - 用户取消了对话框：那就该停下，什么都不产出
  const browserFallback = isBrowserFallback();
  if (!path && !browserFallback) {
    return { ok: false, path: null, message: "已取消导出", error: null };
  }
  // 浏览器降级时用建议文件名当「路径」——
  // writeTextFile 只取它的最后一段作为下载文件名
  const targetPath = path ?? context.fileName;

  // 导出过程中的警告（目前来自 pandoc）
  const warnings: string[] = [];

  try {
    if (format.kind === "pandoc") {
      // pandoc 自己写文件（二进制不经 JS 边界）
      const resourceDir = context.variables.path ? dirnameOf(context.variables.path) : "";
      const output = await convertWithPandoc(
        format.pandocFormat ?? format.id,
        context.content,
        targetPath,
        resourceDir,
      );
      // pandoc 的警告要带回给用户——
      // 典型场景：转 Word 时块级公式无法变成 OMML，会降级成 TeX 源码。
      // 用户打开文件才发现公式不对，却不知道原因；
      // 而这个信息 pandoc 已经告诉我们了。
      if (output.warnings.length > 0) {
        warnings.push(...output.warnings);
      }
    } else if (format.kind === "html") {
      // 大纲与字数统计：从**同一棵** mdast 树派生（架构约束 3）
      const tree = parseMarkdown(context.content);
      const index = buildIndexFromTree(tree);

      // 是否带大纲：设置里的默认值，可能被 front matter 覆盖
      const includeOutline =
        context.overrides.htmlIncludeOutline ?? settings.export.htmlIncludeOutline;

      // 等公式渲染器就绪——KaTeX 的 CSS 是跟着 math-render chunk 一起加载的，
      // 渲染器没就绪就拿不到那张样式表，导出的公式会显示成「两份」
      // （KaTeX 渲染结果 + 一串裸 LaTeX）。
      // 详见 export/html.ts 里关于 `.katex-mathml` 的说明。
      await ensureMathRenderer();

      const html = exportToHtml(context.content, {
        title: context.title,
        theme: settings.appearance.theme,
        mode: settings.appearance.colorMode,
        outline: index.outline,
        includeOutline,
        extraHead: settings.export.htmlExtraHead,
        extraBody: settings.export.htmlExtraBody,
        words: index.stats.words,
        chars: index.stats.chars,
      });
      await writeTextFile(targetPath, html);
    } else {
      // PDF：走 WebView 打印路径（见 export/pdf.ts）
      const { printToPdf } = await import("./pdf");
      return await printToPdf(context, targetPath);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      path: null,
      message: `导出失败：${message}`,
      error: message,
    };
  }

  // 导出后按设置打开文件 / 文件夹
  if (settings.export.openFileAfterExport) {
    await openPath(targetPath);
  } else if (settings.export.openFolderAfterExport) {
    const dir = dirnameOf(targetPath);
    if (dir) await openPath(dir);
  }

  return {
    ok: true,
    path: targetPath,
    message: browserFallback ? `已导出 ${targetPath}` : `已导出到 ${targetPath}`,
    error: null,
    warnings,
  };
}

/** 用系统默认程序打开一个路径 */
async function openPath(path: string): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_path", { path });
  } catch {
    // 打不开就算了——导出本身已经成功了，
    // 不能因为「顺手打开一下」失败就说导出失败
  }
}

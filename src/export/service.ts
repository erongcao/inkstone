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
import { exportToHtml, typographyFromAppearance } from "./html";
import { renderMermaidBlocks } from "./mermaid";
import { inlineImages, type ImageResolver } from "./inline-images";
import { pandocInputFormat } from "./pandoc-format";
import { rewriteAlertsForPandoc } from "./alerts";
import {
  escapeUnusedFootnotes,
  findUnusedFootnoteDefinitions,
  type UnusedFootnoteDefinition,
} from "@/parser/footnotes";
import { featuresFromSettings } from "@/parser/features";
import { applyCaptionsToSource, collectCaptions } from "@/parser/captions";
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
import type { Settings } from "@/settings/schema";
import { buildIndexFromTree } from "@/editor/document-index";
import { ensureMathRenderer } from "@/editor/render/math-loader";
import { t } from "@/i18n";
import { currentColorMode } from "@/theme/themes";

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
  /**
   * 文档**有没有正文**（除了 front matter 之外还有别的内容）。
   *
   * 给 pandoc 那条链路的回读自检用：产出被读回来时，
   * 若读出来是空的而源本来有正文，那说明内容整个丢了。
   *
   * 只有 front matter 的文档读回来**本来就是空的**（实测回读长度 1，
   * 只有一个换行）——所以这条判断不能反过来做。
   */
  hasBodyContent: boolean;
  /**
   * 「定义了却没人引用」的脚注定义。
   *
   * remark 与 pandoc 都会把这种定义**整条丢掉**——
   * 那就是静默丢用户的内容。它们在导出前会被改成字面文本，
   * 内容留在原处（与屏幕逐字一致）。
   *
   * 顺带用来给用户一条提醒：这个定义没人引用，多半是漏写了一个引用。
   */
  unusedFootnotes: UnusedFootnoteDefinition[];
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
  return t("未命名");
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
    // 「有没有正文」——除了 front matter 之外还有别的节点吗？
    //
    // 从 mdast 树看：**唯一**的 yaml 节点就是 front matter 本身
    // （remark-frontmatter 把它放在第一个子节点位置）。
    // 所以「有没有非 yaml 的子节点」就是「有没有正文」。
    hasBodyContent: tree.children.some((child) => child.type !== "yaml"),
    // 没人引用的脚注定义——按用户的 Markdown 开关解析（关掉脚注时不该有）
    unusedFootnotes: findUnusedFootnoteDefinitions(
      parseMarkdown(content, { features: featuresFromSettings(settings.markdown) }),
    ),
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
 * 给 pandoc 的源码：题注标记换成编号前缀。
 *
 * pandoc 不认识「图：」这种约定——不做这一步，
 * 导出的 Word / EPUB 里就只剩一句「图：说明」，没有编号，
 * 而屏幕上明明写着「图 1-1 说明」（屏幕与导出必须一致）。
 *
 * 改的是**喂给 pandoc 的那份副本**，用户的源文件一个字节都不动。
 */
function withCaptionNumbers(source: string, settings: Settings): string {
  const captionSettings = settings.markdown.captions;
  if (!captionSettings.enabled) return source;
  const features = featuresFromSettings(settings.markdown);
  const tree = parseMarkdown(source, { features });
  const captions = collectCaptions(tree, source, {
    numbering: captionSettings.numbering,
  });
  return applyCaptionsToSource(source, captions);
}

/**
 * 给 pandoc 的源码：把 GitHub 提示块改写成它认得的形态。
 *
 * 屏幕上 `> [!NOTE]` 是一个带标题的彩色提示块，
 * 而 pandoc 不认识这个语法（实测没有 `alert` / `callout` 扩展）——
 * 直接喂过去，Word 里就是一段普通引用，正文里还留着字面量 `[!NOTE]`。
 *
 * **用户关掉「GitHub 提示块」时不做这个变换**：
 * 屏幕上那会儿就是普通引用，导出也得是普通引用（架构约束 C）。
 *
 * 同样只改副本，源文件不动。
 */
function withAlertBlocks(source: string, settings: Settings): string {
  if (!settings.markdown.githubAlerts) return source;
  return rewriteAlertsForPandoc(source);
}

/**
 * 喂给 pandoc 的那份源码。
 *
 * 三件事都在这里做——
 * 题注编号、提示块改写、没人引用的脚注定义转字面文本。
 * 共同点是「**改的是副本，用户的源文件一个字节都不动**」。
 */
function pandocSource(
  source: string,
  settings: Settings,
  unused: UnusedFootnoteDefinition[],
): string {
  const withAlerts = withAlertBlocks(withCaptionNumbers(source, settings), settings);
  // 没人引用的脚注定义：pandoc 会整条丢掉（它自己会告警），
  // 但我们要的是**内容不丢**——改成字面文本，内容与屏幕逐字一致。
  return escapeUnusedFootnotes(withAlerts, unused);
}

/**
 * 产出 HTML 导出的内容（**不含写盘**）。
 *
 * ## 为什么要单独一个函数
 *
 * 守卫要能**拿到产物**来断言「图到底变成什么了」——
 * 而 `exportDocument` 的最后一步是写盘（浏览器降级时是 Blob 下载），
 * 写出去的内容在测试里看不见。
 *
 * 把「产出内容」与「写盘」分开，产物就能被直接检查。
 *
 * @param context 导出上下文
 * @param deps 依赖注入（测试用；生产不传）
 */
export async function buildHtmlExport(
  context: ExportContext,
  deps?: { resolveImage?: ImageResolver },
): Promise<string> {
  const settings = readSettings();

  // 是否带大纲：设置里的默认值，可能被 front matter 覆盖
  const includeOutline =
    context.overrides.htmlIncludeOutline ?? settings.export.htmlIncludeOutline;

  // 等公式渲染器就绪——KaTeX 的 CSS 是跟着 math-render chunk 一起加载的，
  // 渲染器没就绪就拿不到那张样式表，导出的公式会显示成「两份」
  // （KaTeX 渲染结果 + 一串裸 LaTeX）。
  // 详见 export/html.ts 里关于 `.katex-mathml` 的说明。
  await ensureMathRenderer();

  // 大纲由导出链路**自己**从同一棵树派生——
  // 不在这里另外解析一棵：两棵树的锚点可能对不上，
  // 目录里的链接就会指错地方。理由见 parser/heading-anchors.ts。
  // Mermaid 图渲染成内联 SVG。
  //
  // 屏幕上看到的是图，导出后却是一坨 mermaid 源码——
  // 那就是「屏幕与导出不一致」（架构约束 C）。
  //
  // 放在 `exportToHtml` **之后**是安全的：`highlightCodeBlocks` 现在
  // 放过 mermaid 块（`language-mermaid` 标记原样保留），
  // 所以这一步照样认得出哪些块是图。
  //
  // 渲染失败时那一步会**原样保留源码块**——绝不能静默丢内容。
  const html = await renderMermaidBlocks(
    exportToHtml(context.content, {
      title: context.title,
      theme: settings.appearance.theme,
      mode: currentColorMode(),
      includeOutline,
      extraHead: settings.export.htmlExtraHead,
      extraBody: settings.export.htmlExtraBody,
      // 自定义 CSS 也要进导出——编辑器里有、导出里没有就是「屏幕与导出不一致」
      customCss: settings.appearance.customCss,
      // 排版（字号 / 行高 / 写作区宽度 / 字体 / 页面背景）同样要跟屏幕一致
      typography: typographyFromAppearance(settings.appearance),
      words: context.variables.words,
      chars: context.variables.chars,
      // 打印 / 分页样式
      //
      // **不传纸张尺寸**：HTML 导出是一份「拿到哪都能打开」的文件，
      // 把 A4 写死进去，用户在 Letter 纸上打印会被浏览器按 A4 排版。
      // 纸张由浏览器 / 打印面板决定；页边距与分页规则由我们决定。
      print: {
        margin: context.overrides.pdfMargin ?? settings.export.pdfMargin,
        chapterBreak:
          context.overrides.pdfChapterBreak ?? settings.export.pdfChapterBreak,
        includeOutline:
          context.overrides.pdfIncludeOutline ?? settings.export.pdfIncludeOutline,
      },
    }),
  );

  // 图片内联成 data: URI。
  //
  // 为什么必须内联：导出文件一旦离开文档目录，
  // `![](assets/fig.png)` 这种相对路径就断了。
  // 内联之后导出物是**自足**的——挪走、发给别人都还带图。
  // 理由与代价见 `src/export/inline-images.ts` 的文件头。
  return inlineImages(html, {
    docPath: context.variables.path,
    resolve: deps?.resolveImage,
  });
}

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
      message: t("未知导出格式"),
      error: t("未知的导出格式: {format}", { format: formatId }),
    };
  }
  if (!item.visible) {
    return {
      ok: false,
      path: null,
      message: t("该导出项已被移除"),
      error: t("导出项 {format} 已被用户移除", { format: formatId }),
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
        message: t("无法导出 {format}：{reason}", {
          format: t(format.label),
          reason: pandoc.reason,
        }),
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
    return { ok: false, path: null, message: t("已取消导出"), error: null };
  }
  // 浏览器降级时用建议文件名当「路径」——
  // writeTextFile 只取它的最后一段作为下载文件名
  const targetPath = path ?? context.fileName;

  // 导出过程中的警告（目前来自 pandoc）
  const warnings: string[] = [];

  // 没人引用的脚注定义：内容没丢（已按原文保留），但多半是漏写了一个引用。
  // 提醒一句——用户自己看得见，导出物里也看得见，只是没人跳过去。
  if (context.unusedFootnotes.length > 0) {
    warnings.push(
      t("有 {count} 个脚注定义没有被引用，已按原文保留在原处。", {
        count: context.unusedFootnotes.length,
      }),
    );
  }

  try {
    if (format.kind === "pandoc") {
      // pandoc 自己写文件（二进制不经 JS 边界）
      const resourceDir = context.variables.path ? dirnameOf(context.variables.path) : "";
      // 输入格式按 Inkstone 的开关算——
      // 用户关掉「表格」，导出的 Word 里就不该还有一张表（屏幕与导出必须一致）。
      const from = pandocInputFormat(featuresFromSettings(settings.markdown));
      const output = await convertWithPandoc(
        format.pandocFormat ?? format.id,
        // 题注在这里换成编号前缀、提示块在这里换成 pandoc 认得的形态、
        // 没人引用的脚注定义在这里转成字面文本（不然会被丢掉）。
        // 改的是喂给 pandoc 的副本，用户的 .md 文件不动。
        pandocSource(context.content, settings, context.unusedFootnotes),
        targetPath,
        resourceDir,
        from,
        // 「源有没有正文」——Rust 侧转换完会把产出读回来自检，
        // 这一条告诉它「读出来是空的」到底算不算失败。
        context.hasBodyContent,
      );
      // pandoc 的警告要带回给用户——
      // 典型场景：转 Word 时块级公式无法变成 OMML，会降级成 TeX 源码。
      // 用户打开文件才发现公式不对，却不知道原因；
      // 而这个信息 pandoc 已经告诉我们了。
      if (output.warnings.length > 0) {
        warnings.push(...output.warnings);
      }
    } else if (format.kind === "html") {
      const html = await buildHtmlExport(context);
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
      message: t("导出失败：{error}", { error: message }),
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
    message: browserFallback
      ? t("已导出 {path}", { path: targetPath })
      : t("已导出到 {path}", { path: targetPath }),
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

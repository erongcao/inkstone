/**
 * YAML front matter 的读取与解析。
 *
 * ## 为什么需要它
 *
 * M4 要支持两件事：
 *   1. 导出变量 `${title}` `${author}` `${date}` 取值 —— 得知道文档的元数据
 *   2. front matter 覆盖导出设置 —— 得能**结构化**地读出设置
 *
 * 而 `remark-frontmatter` 只把 front matter 当成一个**原始文本块**放进 mdast
 * （实测：节点是 `{ type: "yaml", value: "title: 我的标题\nauthor: 张三" }`），
 * 它不做任何 YAML 解析——那是 `remark-mdx` 之类上层插件的活。
 *
 * 所以这里要自己解析。用 `yaml` 包（ISC 许可，在 `scripts/check-licenses.mjs`
 * 的白名单里），不自己手写 YAML 解析器：
 *
 * 手写 YAML 解析是个无底洞——锚点、别名、多行标量、流式映射、类型推断……
 * 每一条都能写出一堆边界 bug。而 front matter 里的内容是**用户写的**，
 * 意味着它必须是**完整的** YAML 解析器才能保证「用户写什么都能读出来」。
 * 自己写个「支持基本键值对」的子集解析器，遇上稍微复杂一点的文件就静默丢字段——
 * 那比报错更糟。
 *
 * ## 安全：front matter 是外部输入
 *
 * front matter 来自用户写的文件，属于外部输入。所以：
 *   - 解析失败**如实报错**，不静默忽略
 *   - `yaml` 包默认不执行任何自定义 tag（无 `!!js/function` 之类的代码执行面）
 *   - 覆盖导出设置时**逐字段白名单校验**，未知键忽略
 */

import { parse as parseYaml } from "yaml";
import type { MarkdownAst } from "@/parser/markdown";
import { t } from "@/i18n";

/** front matter 里的原始 YAML 文本 */
export interface FrontMatter {
  /** 是否存在 front matter */
  present: boolean;
  /** 原始 YAML 文本 */
  raw: string;
  /** 解析后的字段；解析失败时为空对象 */
  fields: Record<string, unknown>;
  /** 解析错误信息；null = 解析成功 */
  error: string | null;
}

/** 空 front matter */
export const EMPTY_FRONT_MATTER: FrontMatter = {
  present: false,
  raw: "",
  fields: {},
  error: null,
};

/**
 * 从 mdast 里取出 front matter 的原始文本。
 *
 * front matter 在 mdast 里是**第一个**子节点，类型 `yaml`。
 * 只看第一个子节点——front matter 按定义就在文件开头。
 */
export function extractFrontMatterRaw(tree: MarkdownAst): string | null {
  const first = tree.children[0];
  if (!first || first.type !== "yaml") return null;
  const value = (first as { value?: unknown }).value;
  return typeof value === "string" ? value : null;
}

/**
 * 解析 front matter。
 *
 * @param tree mdast 树
 */
export function readFrontMatter(tree: MarkdownAst): FrontMatter {
  const raw = extractFrontMatterRaw(tree);
  if (raw === null) return EMPTY_FRONT_MATTER;

  try {
    const parsed = parseYaml(raw);
    // 合法 YAML 可能解析出 null（空文件）、字符串、数组——都不是「键值映射」
    if (parsed === null || parsed === undefined) {
      return { present: true, raw, fields: {}, error: null };
    }
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        present: true,
        raw,
        fields: {},
        error: t("front matter 不是键值映射，已忽略"),
      };
    }
    return {
      present: true,
      raw,
      fields: parsed as Record<string, unknown>,
      error: null,
    };
  } catch (error) {
    return {
      present: true,
      raw,
      fields: {},
      error: t("front matter 解析失败: {error}", {
        error: error instanceof Error ? error.message : String(error),
      }),
    };
  }
}

/**
 * 取一个字符串字段。
 *
 * 只接受字符串——数字、布尔会被转成字符串吗？
 * **不转**。`author: 2024` 到底是年份还是作者名，写的人自己清楚；
 * 我们替他猜就可能猜错。数字型字段由调用方显式处理。
 */
export function stringField(fields: Record<string, unknown>, key: string): string | null {
  const value = fields[key];
  if (typeof value === "string") return value;
  return null;
}

/**
 * front matter 里能覆盖的导出设置。
 *
 * 键名与 `settings/schema.ts` 的 `ExportSettings` 对应，但**只开放安全的那几项**：
 *
 *   - `html.includeOutline`  导出 HTML 时是否带大纲
 *   - `pdf.paperSize`         PDF 纸张尺寸
 *   - `pdf.margin`            打印页边距预设
 *   - `pdf.chapterBreak`      一级标题是否另起一页
 *   - `pdf.includeOutline`    纸上是否带目录
 *   - `fileNameTemplate`      导出文件名模板（用变量系统）
 *   - `variables`             自定义变量
 *
 * **不开放**的：`openFolderAfterExport` / `openFileAfterExport`。
 * 那两项是「导出完自动打开文件/文件夹」——如果一份来路不明的 .md 能让
 * 导出动作自动打开任意路径，那是个安全洞。front matter 只能影响**产出什么**，
 * 不能影响**产出之后做什么**。
 */
export interface FrontMatterExportOverrides {
  htmlIncludeOutline?: boolean;
  pdfPaperSize?: "A4" | "Letter" | "Legal" | "A5";
  /** 页边距预设 */
  pdfMargin?: "compact" | "normal" | "wide";
  /** 一级标题是否另起一页 */
  pdfChapterBreak?: boolean;
  /** 纸上是否带目录 */
  pdfIncludeOutline?: boolean;
  fileNameTemplate?: string;
  variables?: Record<string, string>;
}

/** 合法纸张尺寸 */
const PAPER_SIZES = new Set(["A4", "Letter", "Legal", "A5"]);

/** 合法页边距预设 */
const MARGINS = new Set(["compact", "normal", "wide"]);

/**
 * 从 front matter 里读出导出的覆盖设置。
 *
 * **只认已知的键**，其余一律忽略。理由：front matter 常常还塞着别的工具的
 * 配置（Obsidian 的 `tags`、Hugo 的 `draft`…），那些字段不该影响 Inkstone 的行为。
 *
 * 校验失败时**忽略该字段而不是报错**——比如 `pdfPaperSize: A3`（不合法）
 * 就该退回默认值，而不是让整个导出失败。用户不该因为 front matter 里一个
 * 笔误就导不出东西。
 */
export function readExportOverrides(
  fields: Record<string, unknown>,
): FrontMatterExportOverrides {
  const overrides: FrontMatterExportOverrides = {};
  const exportNode = fields.export;
  if (
    exportNode !== null &&
    typeof exportNode === "object" &&
    !Array.isArray(exportNode)
  ) {
    const exportFields = exportNode as Record<string, unknown>;

    const htmlNode = exportFields.html;
    if (htmlNode !== null && typeof htmlNode === "object" && !Array.isArray(htmlNode)) {
      const includeOutline = (htmlNode as Record<string, unknown>).includeOutline;
      if (typeof includeOutline === "boolean") {
        overrides.htmlIncludeOutline = includeOutline;
      }
    }

    const pdfNode = exportFields.pdf;
    if (pdfNode !== null && typeof pdfNode === "object" && !Array.isArray(pdfNode)) {
      const pdfFields = pdfNode as Record<string, unknown>;
      const paperSize = pdfFields.paperSize;
      if (typeof paperSize === "string" && PAPER_SIZES.has(paperSize)) {
        overrides.pdfPaperSize = paperSize as "A4" | "Letter" | "Legal" | "A5";
      }
      const margin = pdfFields.margin;
      if (typeof margin === "string" && MARGINS.has(margin)) {
        overrides.pdfMargin = margin as "compact" | "normal" | "wide";
      }
      const chapterBreak = pdfFields.chapterBreak;
      if (typeof chapterBreak === "boolean") {
        overrides.pdfChapterBreak = chapterBreak;
      }
      const includeOutline = pdfFields.includeOutline;
      if (typeof includeOutline === "boolean") {
        overrides.pdfIncludeOutline = includeOutline;
      }
    }
  }

  const template = stringField(fields, "fileNameTemplate");
  if (template !== null) {
    overrides.fileNameTemplate = template;
  }

  const variablesNode = fields.variables;
  if (
    variablesNode !== null &&
    typeof variablesNode === "object" &&
    !Array.isArray(variablesNode)
  ) {
    const variables: Record<string, string> = {};
    for (const [name, value] of Object.entries(
      variablesNode as Record<string, unknown>,
    )) {
      if (typeof value === "string") variables[name] = value;
    }
    overrides.variables = variables;
  }

  return overrides;
}

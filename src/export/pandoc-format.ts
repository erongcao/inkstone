/**
 * Inkstone 的 Markdown 开关 → pandoc 的**输入格式串**。
 *
 * ## 为什么要有这个文件
 *
 * pandoc 那条导出链路（DOCX / ODT / EPUB / RTF / LaTeX / MediaWiki… 共 21 种）
 * 把**原始 Markdown** 交给外部的 pandoc 进程转换。
 *
 * 而 Inkstone 自己有一套 Markdown 开关（表格 / 任务列表 / 脚注 / 高亮 / 公式…），
 * 用户在设置面板里关掉哪一个，那段语法在**编辑器里**就该显示成字面文本。
 *
 * 但 pandoc 那条路以前**完全不理这些开关**——
 * 输入格式是写死的一条：
 *
 * ```
 * --from=markdown+tex_math_dollars+yaml_metadata_block
 * ```
 *
 * 于是用户关掉「表格」，屏幕上表格变成了字面文本，
 * 导出的 Word 里却**还是一张表**——屏幕与导出不一致。
 *
 * `src/parser/features.ts` 的文件头写着「导出与剪贴板（同一套规则，
 * 屏幕与导出必须一致）」，这条承诺在 pandoc 这条路上**没兑现**。
 *
 * ## 做法：翻译成 pandoc 的扩展开关
 *
 * pandoc 的输入格式串支持 `+扩展` / `-扩展`：
 *
 * ```
 * markdown+mark-pipe_tables+yaml_metadata_block
 * ```
 *
 * 于是 Inkstone 关掉的开关 → pandoc 关掉同名扩展；
 * Inkstone 开着的开关 → pandoc 打开同名扩展。
 *
 * ## 为什么不用「先按开关解析一遍再交给 pandoc」
 *
 * 另一条路是：先用 Inkstone 的解析器把 Markdown 解析成 mdast（开关的效果
 * 已经体现在树里了），再序列化回 Markdown 交给 pandoc。
 *
 * 那样开关会**精确**生效，但代价是**用户的原文被重写**：
 * `*斜体*` 会被改成 `_斜体_`、列表符号会被归一化、
 * 属性顺序会变。对 DOCX 来说无所谓（反正看不到），
 * 但导出格式里有 `.md`（`pandoc:gfm` / `pandoc:commonmark`）——
 * 那是**给人看、给人再编辑**的产物，不该被悄悄重排。
 *
 * 所以这里只翻译扩展，**原文一个字不动**。
 *
 * ## 已知的粒度限制：公式
 *
 * Inkstone 有**三个**公式开关：
 *
 * | Inkstone | 含义 |
 * |---|---|
 * | `inlineMath` | 行内公式 `$…$` |
 * | `inlineMathSingleDollar` | 单个 `$` 也当行内公式（只在 `inlineMath` 开着时有意义） |
 * | `blockMath` | 块级公式 `$$…$$` |
 *
 * pandoc 只有**一个** `tex_math_dollars`，管全部美元符号公式
 * （单 $、行内 $$、块级 $$ 一视同仁——实测：`markdown-tex_math_dollars`
 * 会把三种一起关掉）。
 *
 * 所以：
 *
 * - 两个公式开关**都关**时 → 精确（pandoc 的 `tex_math_dollars` 关掉）
 * - 只关其中一个时 → **不精确**：另一个也跟着关（或跟着开）
 *
 * 这条限制记在这里，别当成 bug 反复查。
 */

import type { MarkdownFeatures } from "@/parser/features";

/**
 * 算出 pandoc 的输入格式串。
 *
 * @param features Inkstone 当前的 Markdown 开关
 * @returns pandoc 的 `--from=` 参数值
 */
export function pandocInputFormat(features: MarkdownFeatures): string {
  const parts: string[] = ["markdown"];

  // ── Inkstone 关掉的 → pandoc 关掉同名扩展 ──
  //
  // `simple_tables` 是 pandoc 特有的「无表头表格」语法，
  // Inkstone **根本不支持**它——所以它总是该关着，
  // 否则用户写了个 pandoc 风格的无表头表格，屏幕上是一段文字、导出里却是一张表。
  if (!features.tables) {
    parts.push("-pipe_tables", "-grid_tables", "-multiline_tables", "-simple_tables");
  } else {
    // 只保留 Inkstone 真正支持的表格语法（GFM 的竖线表格）。
    parts.push("-grid_tables", "-multiline_tables", "-simple_tables");
  }

  if (!features.taskLists) parts.push("-task_lists");
  if (!features.footnotes) parts.push("-footnotes");
  if (!features.subscriptSuperscript) parts.push("-subscript", "-superscript");
  if (!features.frontMatter) parts.push("-yaml_metadata_block");

  // 公式：两个开关都关时才关掉（pandoc 的粒度限制见文件头）
  if (!features.inlineMath && !features.blockMath) parts.push("-tex_math_dollars");

  // ── Inkstone 开着的 → pandoc 打开同名扩展 ──
  //
  // `mark` 是 pandoc 的 `==高亮==` 语法（**默认关着**）。
  // 少了它，用户在编辑器里看到的黄色高亮，导出到 Word 里会变成
  // 一对字面的 `==` —— 21 种 pandoc 格式全中。
  if (features.highlight) parts.push("+mark");

  // **直接拼接，不加分隔符**——
  // pandoc 的格式串里 `+` / `-` 是**扩展名的符号**，不是分隔符：
  // `markdown+mark-pipe_tables` 才是对的，
  // `markdown++mark--pipe_tables` 会被 pandoc 读成「名字为空的扩展」。
  return parts.join("");
}

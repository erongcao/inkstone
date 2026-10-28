/**
 * HTML 导出：把当前文档产出一份**自包含**的网页。
 *
 * 「自包含」= 单个 .html 文件，双击就能在浏览器里看，样式不依赖外部资源。
 * 这也是 Typora 的 HTML 导出的默认行为。
 *
 * ## 产出包含什么
 *
 *   1. 主题 CSS（颜色令牌 + 版式令牌）—— 内联进 `<style>`
 *   2. 导出专用的排版 CSS —— 内联进 `<style>`
 *   3. 代码高亮 —— 与编辑器内**同一套** highlight.js 结果
 *   4. 公式 —— 复用 `parser/html.ts` 的 KaTeX 链路
 *   5. 可选的大纲 —— `<nav>` 里一份标题目录
 *
 * ## 为什么导出要单独一套排版 CSS
 *
 * 编辑器里的样式是给 CodeMirror 用的：正文是 `.cm-line` 里的行内装饰器，
 * 代码块是 `.cm-md-code` 包裹的 widget。而导出的 HTML 是**普通语义标签**
 * （`<h1>` `<pre>` `<table>`），没有那些 class。
 *
 * 直接把编辑器 CSS 套上去不会生效——那套 CSS 描述的是 CodeMirror 的 DOM 结构，
 * 不是 Markdown 的语义结构。所以导出必须有自己的一份。
 *
 * 这**不违反**架构约束 3（解析规则唯一）：约束管的是「怎么解析」，
 * 而这里是「解析完之后按什么样式排版」。解析仍然只有 remark 一套。
 */

import { htmlFromAst } from "@/parser/html";
import { parseMarkdown } from "@/parser/markdown";
import { featuresFromSettings } from "@/parser/features";
import { headingAnchorId } from "@/parser/heading-anchors";
import { readSettings } from "@/settings/store";
import { highlightCode, resolveLanguage } from "@/editor/render/code-block";
import { buildIndexFromTree, type OutlineItem } from "@/editor/document-index";
import type { AppearanceSettings, ColorMode } from "@/settings/schema";
import { katexStylesheet } from "@/parser/rehype-math";
import { t, htmlLang } from "@/i18n";
import { THEME_FONTS, THEME_TOKENS } from "./theme-tokens.generated";

/**
 * 导出的排版：跟随用户在设置面板里的选择。
 *
 * 应用里这些值是**写在 `<html>` 上的 inline style**（见 `useThemeRuntime.ts`），
 * 优先级高于样式表规则。导出是独立的 HTML 文件，没有 inline style 可写，
 * 所以只能在 `<style>` 里按同样的优先级排。
 *
 * 不跟的后果：用户把字号调到 18px、写作区调到 64rem，
 * 导出的文件还是 16px / 46rem——屏幕与导出不一致（架构约束 C）。
 */
export interface ExportTypography {
  /** 正文字体族（CSS font-family 值） */
  fontFamily?: string;
  /** 等宽字体族 */
  monoFontFamily?: string;
  /** 正文字号（px） */
  fontSize?: number;
  /** 行高倍数 */
  lineHeight?: number;
  /** 写作区最大宽度（rem） */
  contentWidth?: number;
  /** 页面背景色（CSS color）；空 = 用主题底色 */
  backgroundColor?: string;
}

/** HTML 导出的选项 */
export interface HtmlExportOptions {
  /** 文档标题（进 `<title>` 与 `<h1>` 兜底） */
  title: string;
  /** 主题 id；决定用哪套颜色令牌 */
  theme: string;
  /** 明暗模式 */
  mode: ColorMode;
  /**
   * 是否包含大纲。
   *
   * 大纲**由本文档自己派生**（不走选项传入）——
   * 大纲里的链接要指向正文里的标题，两边必须来自**同一棵** mdast 树，
   * 否则锚点会对不上。理由见 `parser/heading-anchors.ts`。
   */
  includeOutline: boolean;
  /** 追加进 `<head>` 的原始 HTML */
  extraHead?: string;
  /** 追加进 `<body>` 末尾的原始 HTML */
  extraBody?: string;
  /**
   * 用户自定义 CSS（设置里的「附加样式」）。
   *
   * 与编辑器一致：**排在 `<head>` 最后**，能覆盖导出文件里的任何样式
   * （编辑器里它也是最后注入的那张样式表）。
   *
   * 原样注入——这是用户自己写的 CSS、进的是用户自己的文件，
   * 与 `extraHead` / `extraBody` 同一套信任模型。
   */
  customCss?: string;
  /** 正文字数（用于页脚统计） */
  words?: number;
  /** 正文字符数 */
  chars?: number;
  /** 用户的排版设置（字号 / 行高 / 写作区宽度 / 字体 / 背景色） */
  typography?: ExportTypography;
}

/**
 * 把设置里的外观选项翻译成导出的排版选项。
 *
 * **只有这六项进导出**——主题与明暗模式有各自的通道
 * （`options.theme` / `options.mode`），自定义 CSS 也是单独一个字段。
 */
export function typographyFromAppearance(
  appearance: AppearanceSettings,
): ExportTypography {
  return {
    fontFamily: appearance.fontFamily,
    monoFontFamily: appearance.monoFontFamily,
    fontSize: appearance.fontSize,
    lineHeight: appearance.lineHeight,
    contentWidth: appearance.contentWidth,
    backgroundColor: appearance.backgroundColor,
  };
}

/* ── 主题 CSS ── */

/**
 * 主题的颜色令牌**从 CSS 生成**——见 `theme-tokens.generated.ts`。
 *
 * 以前这里是手抄的一份，于是和应用内的 `src/themes/*.css` 漂移了：
 * `academic` 主题的导出配色是暗红调、字体是无衬线，
 * 而应用里是蓝调 + 衬线——同一份文档，导出后看着像另一个主题。
 *
 * 现在令牌只有一份（CSS 文件），导出用的表由 `pnpm gen:theme-tokens` 派生。
 */

/**
 * 导出专用的排版 CSS。
 *
 * 描述的是**标准语义标签**的样式（`h1` / `p` / `pre` / `table`…），
 * 与编辑器里给 CodeMirror 装饰器写的那套是两回事。
 *
 * 代码高亮的 class 映射（`.hljs-keyword` 等）与 `src/editor/live-preview.css`
 * 里的那份保持一致——同一套 highlight.js 输出，在两处用同一套配色。
 */
const EXPORT_STYLES = `
* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 0;
  /* 页面背景走 --ink-page-bg——设置里的「页面背景色」写进这个变量 */
  background: var(--ink-page-bg, var(--ink-bg));
  color: var(--ink-fg);
  font-family: var(--ink-font-family);
  font-size: var(--ink-font-size);
  line-height: var(--ink-line-height);
  -webkit-font-smoothing: antialiased;
}

.inkstone-doc {
  max-width: var(--ink-content-width);
  margin: 0 auto;
  padding: 3rem 1.5rem 6rem;
  /* 正文区用主题底色：页面背景是用户另设的，正文底色仍跟主题 */
  background: var(--ink-bg);
}

.inkstone-doc h1,
.inkstone-doc h2,
.inkstone-doc h3,
.inkstone-doc h4,
.inkstone-doc h5,
.inkstone-doc h6 {
  margin: 1.8em 0 0.6em;
  font-weight: 700;
  line-height: 1.3;
  scroll-margin-top: 1rem;
}
.inkstone-doc h1 { font-size: 2em; padding-bottom: 0.3em; border-bottom: 1px solid var(--ink-border); }
.inkstone-doc h2 { font-size: 1.5em; padding-bottom: 0.3em; border-bottom: 1px solid var(--ink-border); }
.inkstone-doc h3 { font-size: 1.25em; }
.inkstone-doc h4 { font-size: 1em; }
.inkstone-doc h5 { font-size: 0.875em; }
.inkstone-doc h6 { font-size: 0.85em; color: var(--ink-fg-muted); }

.inkstone-doc p { margin: 0 0 1em; }

.inkstone-doc a { color: var(--ink-accent); text-decoration: none; }
.inkstone-doc a:hover { text-decoration: underline; }

.inkstone-doc ul,
.inkstone-doc ol { margin: 0 0 1em; padding-left: 2em; }
.inkstone-doc li { margin: 0.25em 0; }
.inkstone-doc li > ul,
.inkstone-doc li > ol { margin: 0.25em 0; }

.inkstone-doc blockquote {
  margin: 0 0 1em;
  padding: 0.2em 1em;
  color: var(--ink-quote-fg);
  border-left: 4px solid var(--ink-quote-border);
}

/* GitHub 提示块：类名由 remark-github-blockquote-alert 生成 */
.inkstone-doc .markdown-alert {
  margin: 0 0 1em;
  padding: 0.4em 0.9em;
  border-left: 4px solid var(--ink-border-strong);
  border-radius: 0 4px 4px 0;
  background-color: rgba(127, 127, 127, 0.08);
}

.inkstone-doc .markdown-alert-title {
  display: flex;
  align-items: center;
  gap: 0.4em;
  margin: 0 0 0.3em;
  font-weight: 600;
}

.inkstone-doc .markdown-alert-title .octicon {
  width: 16px;
  height: 16px;
  fill: currentColor;
  flex: none;
}

.inkstone-doc .markdown-alert-note { border-left-color: #0969da; }
.inkstone-doc .markdown-alert-tip { border-left-color: #1a7f37; }
.inkstone-doc .markdown-alert-important { border-left-color: #8250df; }
.inkstone-doc .markdown-alert-warning { border-left-color: #bf8700; }
.inkstone-doc .markdown-alert-caution { border-left-color: #cf222e; }

.inkstone-doc .markdown-alert-note .markdown-alert-title { color: #0969da; }
.inkstone-doc .markdown-alert-tip .markdown-alert-title { color: #1a7f37; }
.inkstone-doc .markdown-alert-important .markdown-alert-title { color: #8250df; }
.inkstone-doc .markdown-alert-warning .markdown-alert-title { color: #bf8700; }
.inkstone-doc .markdown-alert-caution .markdown-alert-title { color: #cf222e; }

.inkstone-doc code {
  font-family: var(--ink-mono-family);
  font-size: 0.875em;
  padding: 0.15em 0.35em;
  border-radius: 4px;
  background: var(--ink-code-bg);
  color: var(--ink-code-fg);
  border: 1px solid var(--ink-code-border);
}

.inkstone-doc pre {
  margin: 0 0 1em;
  padding: 1em;
  overflow-x: auto;
  background: var(--ink-code-bg);
  border: 1px solid var(--ink-code-border);
  border-radius: 6px;
}

.inkstone-doc pre code {
  display: block;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--ink-code-fg);
  font-size: 0.875em;
  line-height: 1.55;
}

.inkstone-doc table {
  border-collapse: collapse;
  margin: 0 0 1em;
  width: 100%;
  display: block;
  overflow-x: auto;
}
.inkstone-doc th,
.inkstone-doc td {
  border: 1px solid var(--ink-table-border);
  padding: 0.5em 0.75em;
  text-align: left;
}
.inkstone-doc th { background: var(--ink-table-header-bg); font-weight: 600; }
.inkstone-doc tbody tr:nth-child(2n) { background: var(--ink-table-stripe-bg); }

.inkstone-doc img { max-width: 100%; height: auto; }

.inkstone-doc hr {
  height: 1px;
  margin: 2em 0;
  border: none;
  background: var(--ink-border);
}

.inkstone-doc mark {
  background: var(--ink-mark-bg);
  color: var(--ink-mark-fg);
  padding: 0 0.15em;
  border-radius: 3px;
}

.inkstone-doc .task-list-item { list-style: none; }
.inkstone-doc .task-list-item input { margin-right: 0.5em; }

.inkstone-doc .footnotes { margin-top: 3em; padding-top: 1em; border-top: 1px solid var(--ink-border); font-size: 0.9em; }
.inkstone-doc .footnotes h2 { font-size: 1.1em; border: none; margin-top: 0; }

/* 大纲 */
.inkstone-outline {
  max-width: var(--ink-content-width);
  margin: 0 auto;
  padding: 2rem 1.5rem 0;
}
.inkstone-outline h2 {
  margin: 0 0 0.8em;
  font-size: 1.1em;
  color: var(--ink-fg-muted);
  font-weight: 600;
}
.inkstone-outline ol { list-style: none; margin: 0; padding: 0; }
.inkstone-outline li { margin: 0.3em 0; }
.inkstone-outline a { color: var(--ink-fg-muted); text-decoration: none; }
.inkstone-outline a:hover { color: var(--ink-accent); text-decoration: underline; }
.inkstone-outline li[data-depth="2"] { padding-left: 1.2em; }
.inkstone-outline li[data-depth="3"] { padding-left: 2.4em; }
.inkstone-outline li[data-depth="4"] { padding-left: 3.6em; }
.inkstone-outline li[data-depth="5"] { padding-left: 4.8em; }
.inkstone-outline li[data-depth="6"] { padding-left: 6em; }

.inkstone-footer {
  max-width: var(--ink-content-width);
  margin: 0 auto;
  padding: 1.5rem;
  border-top: 1px solid var(--ink-border);
  color: var(--ink-fg-faint);
  font-size: 0.85em;
}

/* ── 代码高亮（与编辑器内同一套 highlight.js class） ── */
.hljs-comment, .hljs-quote { color: var(--ink-code-comment); font-style: italic; }
.hljs-punctuation, .hljs-operator { color: var(--ink-code-punctuation); }
.hljs-keyword, .hljs-selector-tag, .hljs-literal, .hljs-section, .hljs-doctag, .hljs-name { color: var(--ink-code-keyword); }
.hljs-string, .hljs-attribute, .hljs-symbol, .hljs-bullet, .hljs-subst, .hljs-regexp { color: var(--ink-code-string); }
.hljs-number, .hljs-meta, .hljs-params { color: var(--ink-code-number); }
.hljs-title, .hljs-title.function_ { color: var(--ink-code-function); }
.hljs-title.class_, .hljs-class, .hljs-type, .hljs-built_in, .hljs-builtin-name { color: var(--ink-code-type); }
.hljs-tag { color: var(--ink-code-tag); }
.hljs-attr, .hljs-variable, .hljs-template-variable, .hljs-property { color: var(--ink-code-attr); }
.hljs-deletion { color: var(--ink-code-deleted); }
.hljs-addition { color: var(--ink-code-inserted); }
.hljs-emphasis { font-style: italic; }
.hljs-strong { font-weight: 600; }
.hljs-link { color: var(--ink-accent); text-decoration: underline; }

/* ── 打印 ── */
@media print {
  body { background: #fff; color: #000; }
  .inkstone-outline { display: none; }
  .inkstone-doc { max-width: none; padding: 0; }
  .inkstone-doc pre { white-space: pre-wrap; word-break: break-word; }
}
`;

/** 导出用的版式令牌（与 `src/styles/tokens.css` 的默认值一致） */
const LAYOUT_TOKENS = `
:root {
  --ink-font-size: 16px;
  --ink-line-height: 1.6;
  --ink-content-width: 46rem;
  /* 页面背景：空设置时用主题的底色 */
  --ink-page-bg: var(--ink-bg);
}
`;

/**
 * 组装主题 + 版式 + 排版三段 CSS
 *
 * ## 为什么导出的 CSS 要剥掉注释
 *
 * `EXPORT_STYLES` 里的注释是**给维护者看的实现说明**
 * （「类名由 remark-github-blockquote-alert 生成」「与编辑器内同一套 class」）。
 * 它们跟着样式表一起内联进导出文件，等于把源码里的中文注释
 * 原样发给用户——文件是给别人看的，注释对读者没有意义。
 *
 * 只剥**我们自己写的**这段样式表：
 *   - 用户的自定义 CSS（`options.customCss`）原样注入，一个字都不动
 *   - KaTeX 的样式表是 `?raw` 读进来的第三方文件，本来就没有注释
 *
 * 判据是「注释开始符 + 最短匹配到注释结束符」——
 * CSS 注释不能嵌套，配对匹配就是规范定义的行为。
 *
 * ## 顺序很重要
 *
 * 后面的覆盖前面的，同特异度下**后者胜**（与 CSS 层叠一致）：
 *
 * 1. `LAYOUT_TOKENS` —— 版式的默认值
 * 2. 主题的颜色令牌 —— 主题的配色
 * 3. 主题的字体栈 —— 学术主题的衬线体在这里
 * 4. **用户的排版设置** —— 设置面板里选的字体、字号、行高、写作区宽度
 *
 * 第 4 条必须在最后：应用里这些值是**写在 `<html>` 上的 inline style**，
 * 优先级高于任何样式表规则——导出要复现这个效果。
 */
function buildStyles(options: HtmlExportOptions): string {
  const theme = THEME_TOKENS[options.theme] ?? THEME_TOKENS["inkstone-light"];
  const mode: "light" | "dark" = options.mode === "dark" ? "dark" : "light";
  const fonts = THEME_FONTS[options.theme] ?? THEME_FONTS["inkstone-light"] ?? "";
  const css = `${LAYOUT_TOKENS}\n:root {\n${theme[mode]}\n${fonts}\n${buildTypographyTokens(options.typography)}\n}\n${EXPORT_STYLES}`;
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * 把用户在设置面板里选的排版翻译成 CSS 变量。
 *
 * 应用里这些是**写在 `<html>` 上的 inline style**（见 `useThemeRuntime.ts`），
 * 优先级高于样式表。导出是独立的 HTML 文件，没有 inline style 可写，
 * 所以只能在 `<style>` 里按同样的优先级排——
 * **放在主题令牌之后**，效果才与屏幕上一致。
 */
function buildTypographyTokens(typography: ExportTypography | undefined): string {
  if (!typography) return "";
  const lines: string[] = [];
  if (typography.fontFamily) lines.push(`--ink-font-family: ${typography.fontFamily};`);
  if (typography.monoFontFamily) {
    lines.push(`--ink-mono-family: ${typography.monoFontFamily};`);
  }
  if (typography.fontSize !== undefined) {
    lines.push(`--ink-font-size: ${typography.fontSize}px;`);
  }
  if (typography.lineHeight !== undefined) {
    lines.push(`--ink-line-height: ${typography.lineHeight};`);
  }
  if (typography.contentWidth !== undefined) {
    lines.push(`--ink-content-width: ${typography.contentWidth}rem;`);
  }
  if (typography.backgroundColor) {
    lines.push(`--ink-page-bg: ${typography.backgroundColor};`);
  }
  return lines.map((line) => `  ${line}`).join("\n");
}

/* ── 代码高亮 ── */

/**
 * 把 HTML 里的代码块换成高亮后的版本。
 *
 * 为什么不走 remark 插件：`markdownToHtml` 产出的 HTML 里，代码块是
 * `<pre><code class="language-xxx">转义后的文本</code></pre>`。
 * 要高亮，得先把 HTML 里的实体反转义回原文、跑 highlight.js、再转义回去——
 * 这条链路要处理 HTML 实体，很脆。
 *
 * 更稳的做法：**在 mdast 阶段做**。`markdown.ts` 的解析层已经知道每个代码块的
 * 语言和原文，在那里替换成高亮 HTML，再交给 remark-rehype 序列化成
 * `<pre><code class="hljs language-xxx">…</code></pre>`。
 *
 * 但 `markdownToHtml` 是通用入口（剪贴板复制也用它），改动它会波及那条路径。
 * 所以这里走**独立的导出管线**：自己 parse → 自己转 hast → 自己 stringify。
 * 解析规则仍然只有 remark 一套（红线 3 满足），只是输出端多了一步高亮。
 */

/** HTML 转义（高亮输出的反向操作：把原文转成可安全嵌入的文本） */
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * 解码 HTML 实体，还原成原文。
 *
 * ## 为什么要解码**两轮**
 *
 * `remark-rehype` 把代码块的文本放进 hast 的 `text` 节点，
 * 序列化时做 HTML 转义。于是 `<div>` 变成 `&#x3C;div&gt;`。
 * 但这个 `&` 本身又被转义了一次（text 节点里的 `&` → `&amp;`），
 * 所以实际序列化出来的是 `&amp;#x3C;div&amp;gt;`。
 *
 * 只解码一轮得到的是 `&#x3C;div&gt;`——仍然是实体，不是原文。
 * 而 highlight.js 收到实体文本时会把它当普通字符，
 * 输出 `&amp;#x3C;`——页面上就显示成 `&#x3C;div&gt;`，一层实体套一层。
 *
 * 所以要解码到**原文**为止：先解 `&amp;` 等命名实体，再解 `&#x3C;` 这类数字实体。
 * 两轮之后拿到的才是真正的 `<div>`，交给 highlight.js 由它做**唯一一次**转义。
 */
function decodeEntities(text: string): string {
  // 第一轮：命名实体（&amp; &lt; &gt; &quot; &#39;）
  let decoded = text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

  // 第二轮：数字实体（&#x3C; / &#60;）
  decoded = decoded.replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) =>
    String.fromCodePoint(Number.parseInt(hex, 16)),
  );
  decoded = decoded.replace(/&#(\d+);/g, (_m, dec: string) =>
    String.fromCodePoint(Number.parseInt(dec, 10)),
  );

  return decoded;
}

/**
 * 在 HTML 字符串里找到代码块并高亮。
 *
 * 用受限的正则而不是 DOM 解析：导出产物是我们自己刚生成的，结构已知
 * （`<pre><code class="language-xxx">…</code></pre>`），
 * 不需要通用 HTML 解析器的健壮性；而 DOM 解析在浏览器降级（vitest/jsdom）下
 * 会引入额外依赖。
 *
 * 匹配用**非贪婪**且要求 class 以 `language-` 开头——避免误伤普通 `<code>`。
 */
export function highlightCodeBlocks(html: string): string {
  const pattern = /<pre><code class="language-([^"]*)">([\s\S]*?)<\/code><\/pre>/g;

  return html.replace(pattern, (_match, language: string, escaped: string) => {
    // 反转义回原文（两轮，见 decodeEntities 的说明）
    const source = decodeEntities(escaped);

    const canonical = resolveLanguage(language);
    // highlight.js 的输出**已经**转义过了，直接拼进 HTML 即可——
    // 再转义一次就变成双重转义，页面上会显示成 &amp;lt; 这种东西
    const highlighted = highlightCode(source, canonical);
    const className = canonical
      ? `hljs language-${canonical}`
      : "hljs language-plaintext";
    return `<pre><code class="${className}">${highlighted}</code></pre>`;
  });
}

/* ── 大纲 ── */

/** 生成大纲 HTML */
function buildOutline(outline: OutlineItem[]): string {
  if (outline.length === 0) return "";
  // 大纲标题与 aria-label 都走 t()——
  // 写死中文的话，英文界面导出的 HTML 里会顶着两个「大纲」，
  // 读屏软件还会把导航区念成中文。
  const label = t("大纲");
  const items = outline
    .map((item) => {
      const text = item.text || t("（无标题）");
      // 锚点 id 与正文标题上的 id 用**同一个公式**——
      // 见 `parser/heading-anchors.ts`。这里不能自己另算一套。
      const anchor = headingAnchorId(item.depth, item.from);
      return `      <li data-depth="${item.depth}"><a href="#${anchor}">${escapeHtml(text)}</a></li>`;
    })
    .join("\n");
  return `  <nav class="inkstone-outline" aria-label="${escapeHtml(label)}">
    <h2>${escapeHtml(label)}</h2>
    <ol>
${items}
    </ol>
  </nav>`;
}

/* ── 主入口 ── */

/**
 * 产出完整的 HTML 文档。
 *
 * @param source Markdown 源码
 */
export function exportToHtml(source: string, options: HtmlExportOptions): string {
  const features = featuresFromSettings(readSettings().markdown);

  // **一棵**树：大纲与正文都从它派生。
  //
  // 早先是两棵——`service.ts` 自己解析一棵算大纲，这里再解析一棵出正文，
  // 锚点靠「第几个 `<hN>` 标签」配对。两棵树一旦对不上（嵌套标题、
  // 用户写的原始 HTML 都会多出标签），大纲里的链接就指错地方。
  // 实测过一次：目录项的 id 被贴到了引用块里那个标题上，
  // 真正的大纲标题反而没有 id，导出文件里点目录跳错位置。
  //
  // 理由与上游机制见 `parser/heading-anchors.ts`。
  const tree = parseMarkdown(source, { features });

  // 索引必须在渲染**之前**算：渲染会就地改树
  // （提示块变换会往引用块里插节点、图片尺寸会改 url）。
  const index = buildIndexFromTree(tree);

  // 正文：复用现成的 HTML 链路（含 KaTeX 公式渲染与标题锚点）
  //
  // **必须传当前的 Markdown 开关**——不然关掉表格/脚注/高亮的用户
  // 导出来的 HTML 里那些语法还在，与屏幕上看到的不一致（架构约束 C）。
  let body = htmlFromAst(tree, {
    features,
    // **保留**用户写在 Markdown 里的原始 HTML（2026-10-28 维护者拍板）。
    //
    // 为什么不能丢：实测丢掉之后，块级的原始 HTML **连里面的文字一起没了**——
    // `<div align="center">` 居中一张图、`<details>` 折叠一段说明，
    // 这些内容在导出的文件里**静默消失**。
    // 保留之后，导出物与用户写的东西一致（`<br>` 也不会再把两个词粘在一起）。
    //
    // 与剪贴板那条路**故意不一样**（那边维持丢弃），
    // 理由与安全边界见 `parser/html.ts` 的 `HtmlOptions`。
    allowRawHtml: true,
    // 标题锚点：大纲的链接要靠它。
    headingAnchors: true,
  });

  // 「公式没渲染」的检测必须发生在**高亮之前**。
  //
  // 原因：块级公式没渲染时是 `<pre><code class="language-math math-display">`，
  // 而下面这行高亮会把 class 改写成 `hljs language-plaintext`——
  // `math-display` 这个标记当场消失，之后再找就找不到了。
  const hasUnrenderedMath = /class="[^"]*\bmath-(?:inline|display)\b/.test(body);

  // 代码高亮：导出侧补上（编辑器里那份是 CodeMirror 装饰器，不在这条链路上）
  body = highlightCodeBlocks(body);

  const outline = options.includeOutline ? buildOutline(index.outline) : "";
  const katexCss = katexStylesheet();
  const title = escapeHtml(options.title || t("未命名"));

  const stats =
    options.words !== undefined
      ? `<footer class="inkstone-footer">${t("{words} 字 · {chars} 字符", { words: options.words, chars: options.chars ?? 0 })}</footer>`
      : "";

  // 公式的样式表拿不到时**如实说明**，而不是导出一份公式显示错乱的文件。
  //
  // 为什么这值得单独提示：KaTeX 的 CSS 里有 `.katex-mathml { position: absolute }`
  // 这条规则——它负责把「给读屏软件用的 MathML 副本」藏起来。
  // 少了这条规则，导出的文件里每条公式都会显示成
  // 「KaTeX 渲染结果 + 一串裸 LaTeX」两份，读者完全无法使用。
  const mathWarning =
    katexCss === "" && body.includes("katex")
      ? `\n<!-- 注意：未能内联 KaTeX 样式表，公式可能显示异常 -->\n`
      : "";

  // 公式**根本没渲染**时（KaTeX 渲染器没就绪）也要说明——
  // 否则产物里只剩一串裸 LaTeX，读者完全看不出那是公式，
  // 而文件本身没有任何地方记录这件事。
  //
  // 正常情况下到不了这里：HTML / PDF 两条导出链路都会先等渲染器就绪。
  // 这个分支是**兜底**——万一有人新加一条出口忘了等，
  // 至少产物里留下了痕迹，而不是悄悄降级。
  const unrenderedMathWarning = hasUnrenderedMath
    ? `\n<!-- 注意：公式渲染器未就绪，下列公式以源码形式导出 -->\n`
    : "";

  // `lang` 跟**界面语言**走，而不是跟文档内容走。
  //
  // 导出物里混着两种文本：我们生成的界面文字（大纲标题、页脚统计）
  // 与用户写的正文。前者一定是界面语言，后者我们**无从判断**
  // （不引入语言检测库的话就没有可靠依据）。
  //
  // 既然一部分是已知的，就用已知的那部分——
  // 至少读屏软件对大纲与页脚的朗读不会串味。
  // 写死 `zh-CN` 的话，英文界面导出的文件会被读屏软件当成中文，
  // 断词换行也跟着错。
  return `<!DOCTYPE html>
<html lang="${htmlLang()}" data-theme="${escapeHtml(options.theme)}" data-mode="${
    options.mode === "dark" ? "dark" : "light"
  }">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Inkstone">
<title>${title}</title>
<style>
${buildStyles(options)}
</style>
${katexCss ? `<style>\n${katexCss}\n</style>` : ""}${mathWarning}${unrenderedMathWarning}${options.extraHead ?? ""}
${options.customCss?.trim() ? `<style>\n${options.customCss}\n</style>\n` : ""}</head>
<body>
${outline}
<article class="inkstone-doc">
${body}
</article>
${stats}
${options.extraBody ?? ""}
</body>
</html>
`;
}

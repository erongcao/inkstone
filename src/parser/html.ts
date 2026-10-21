/**
 * Markdown → HTML 转换（mdast → hast → HTML 字符串）。
 *
 * 独立成模块而不是塞进 `markdown.ts`，是为了让它能被**按需加载**：
 * remark-rehype + hast-util-to-html 带来约 180 KB 的依赖，
 * 而它只服务「复制为 HTML」这一个低频功能，
 * 不该拖慢应用冷启动（见 `html-loader.ts`）。
 *
 * 插件组合与解析层保持一致（frontmatter / gfm / math），
 * 否则会出现「解析按 GFM、渲染不按 GFM」的语义分裂——
 * 那会直接违反架构约束 C（解析规则唯一）。
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import { parseMarkdown, type MarkdownAst } from "./markdown";

/**
 * 构建 HTML 输出处理器。
 *
 * 注意它**没有** remarkStringify：这条链路是 mdast → hast → HTML 字符串，
 * 与「mdast → Markdown 源码」是两条独立的出口。
 */
function buildHtmlProcessor() {
  return unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ["yaml"])
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype)
    .use(rehypeStringify);
}

type HtmlProcessor = ReturnType<typeof buildHtmlProcessor>;

let htmlProcessor: HtmlProcessor | null = null;

/** 获取（并缓存）HTML 输出处理器 */
function getHtmlProcessor(): HtmlProcessor {
  if (!htmlProcessor) {
    htmlProcessor = buildHtmlProcessor();
  }
  return htmlProcessor;
}

/**
 * 把 mdast 树转成 HTML 字符串。
 *
 * 直接吃 mdast（而不是源码），是为了保证「渲染出来的」与
 * 「解析出来的」出自同一棵语义树——这是架构约束 C 的要求。
 */
export function htmlFromAst(tree: MarkdownAst): string {
  const processor = getHtmlProcessor();
  // 第一步：mdast → hast。
  // 注意 `runSync` 返回的是**hast 树本身**（不是 VFile）——
  // remark-rehype 的 transformer 直接返回新树，unified 就把它当作 run 的结果。
  const hast = processor.runSync(tree);
  // 第二步：hast → HTML 字符串。
  // rehype-stringify 是 **compiler**，只在 stringify 阶段执行——
  // `run` 不会跑 compiler，所以必须显式分两步。
  return String(processor.stringify(hast));
}

/** 源码 → HTML，一步到位 */
export function markdownToHtml(source: string): string {
  return htmlFromAst(parseMarkdown(source));
}

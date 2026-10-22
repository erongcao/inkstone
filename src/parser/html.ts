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
import { parseMarkdown, type MarkdownAst, type ParseOptions } from "./markdown";
import { rehypeMath, katexStylesheet, type HastNode } from "./rehype-math";

/**
 * 构建 HTML 输出处理器。
 *
 * 注意它**没有** remarkStringify：这条链路是 mdast → hast → HTML 字符串，
 * 与「mdast → Markdown 源码」是两条独立的出口。
 *
 * `allowDangerousHtml` 是为了输出 KaTeX 的 HTML（走 hast 的 `raw` 节点）。
 * 前提与副作用都记在 `rehype-math.ts` 的说明里——
 * 简要说：raw 内容全部由 KaTeX 生成（`trust: false`），
 * 而用户写在 Markdown 里的原始 HTML 从此会被保留（本来就符合 Markdown 规范，
 * 默认的 `remark-rehype` 会丢弃它们）。
 */
/**
 * 这条管线的类型。
 *
 * 显式写出来而不是让 unified 推断：一旦中途混入按 hast 推断的插件，
 * `runSync` 的入参就会从 mdast 变成 hast Node，错误要等到调用点才炸出来。
 * 这里一次性说清「进 mdast、进 hast、出字符串」，类型错误会落在组装处而不是使用处。
 */
interface HtmlPipeline {
  runSync(tree: MarkdownAst): HastNode;
  stringify(tree: HastNode): string;
}

function buildHtmlProcessor(): HtmlPipeline {
  return unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ["yaml"])
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype)
    .use(rehypeStringify, { allowDangerousHtml: true }) as unknown as HtmlPipeline;
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
  // 第二步：公式 → KaTeX HTML。
  // 这里**手动调用**而不是 `.use(rehypeMath)`：插件内部用的是本项目自定义的
  // 最小 hast 结构（见 rehype-math.ts），挂进 unified 会让整条流水线的类型
  // 推断跑到 hast 上，`runSync` 的入参类型跟着变。手动调用既绕开这个，
  // 也让「公式在哪一步被替换」在代码里一目了然。
  const withMath = rehypeMath({ styles: katexStylesheet() })(hast);
  // 第三步：hast → HTML 字符串。
  // rehype-stringify 是 **compiler**，只在 stringify 阶段执行——
  // `run` 不会跑 compiler，所以必须显式分两步。
  return String(processor.stringify(withMath));
}

/**
 * 源码 → HTML，一步到位。
 *
 * `options` 必须原样传给 `parseMarkdown`：`singleDollarTextMath` 一开一关，
 * 屏幕上是公式的地方复制出去就不是公式（或者反过来）——
 * 这就是「解析规则唯一」被破坏的样子，签名与 `markdown-loader.ts` 保持一致。
 */
export function markdownToHtml(source: string, options?: ParseOptions): string {
  return htmlFromAst(parseMarkdown(source, options));
}

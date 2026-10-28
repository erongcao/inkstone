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
 *
 * `==高亮==` 的节点在解析层就定型了（`highlight`），
 * 这里只负责把它变成 `<mark>`，不重新判断什么是高亮。
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import { parseMarkdown, type MarkdownAst, type ParseOptions } from "./markdown";
import { resolveFeatures } from "./features";
import { applyAlerts } from "./alerts";
import { applyImageSizes } from "./image-size";
import { highlightHastHandlers } from "./highlight";
import { subSupHastHandlers } from "./subsup";
import { rehypeMath, katexStylesheet, type HastNode } from "./rehype-math";
import { t, getLocale } from "@/i18n";

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

/**
 * HTML 链路的选项。
 *
 * 在解析选项之外多一个 `allowRawHtml`——
 * 因为它管的不是「怎么解析」，而是「解析出来的原始 HTML 怎么处置」。
 */
export interface HtmlOptions extends ParseOptions {
  /**
   * 是否保留用户写在 Markdown 里的原始 HTML。
   *
   * ## 默认 `false`（丢弃）
   *
   * `remark-rehype` 的默认行为：mdast 的 `html` 节点直接被丢掉。
   *
   * ## `true` 时保留
   *
   * mdast 的 `html` 节点变成 hast 的 `raw` 节点，
   * 由 `rehype-stringify`（已经开着 `allowDangerousHtml`）原样序列化。
   *
   * ## 为什么两条链路要不一样
   *
   * - **导出**：保留。用户写 `<div align="center">` 居中一张图、
   *   `<details>` 折叠一段说明，导出的文件里就该有——
   *   否则这部分内容**静默消失**（实测：块级 HTML 连里面的文字一起没了）。
   * - **剪贴板**（⌘C / 菜单「复制为 HTML」）：丢弃。往 Word / 邮件正文里贴时，
   *   少一些意外内容（脚本、样式块）更安全。
   *
   * 2026-10-28 由维护者拍板：导出保留并渲染，剪贴板维持现状。
   *
   * ## 安全边界
   *
   * 开了之后，`<script>`、`<style>`、事件属性会**原样进入导出文件**——
   * 用浏览器打开那个文件时会执行。
   *
   * 这是**有意的取舍**：导出物是用户自己产出的本地文件，
   * 与「在服务器上渲染不可信内容」不是一回事（后者需要净化，GitHub 走那条路）。
   */
  allowRawHtml?: boolean;
}

/**
 * 构建 HTML 输出处理器。
 *
 * @param allowRawHtml 是否保留用户原始 HTML（见 `HtmlOptions`）
 */
function buildHtmlProcessor(allowRawHtml: boolean): HtmlPipeline {
  return (
    unified()
      .use(remarkParse)
      .use(remarkFrontmatter, ["yaml"])
      // 插件选项必须与解析层**完全一致**（`singleTilde: false` 的理由见 markdown.ts）——
      // 这里若用默认值，导出会把 `~x~` 变成删除线，而编辑器里它是普通文本。
      .use(remarkGfm, { singleTilde: false })
      .use(remarkMath)
      // `highlight` 节点 → `<mark>`；`subscript` / `superscript` → `<sub>` / `<sup>`。
      // handler 挂在 remarkRehype 的选项上——
      // 那是 mdast-util-to-hast 唯一开放的扩展入口。
      .use(remarkRehype, {
        // 用户写在 Markdown 里的原始 HTML 要不要变成 hast 的 raw 节点。
        //
        // 注意这与 `rehype-stringify` 上那个同名选项**不是一回事**：
        //   - 这里（remark-rehype）：决定 mdast 的 `html` 节点**要不要留下来**
        //   - rehype-stringify：决定 hast 里已有的 `raw` 节点**要不要序列化**
        // KaTeX 的输出走的是后者，所以后者必须一直开着。
        allowDangerousHtml: allowRawHtml,
        handlers: { ...highlightHastHandlers, ...subSupHastHandlers },
        // 脚注区的标题与回链的无障碍标签。
        //
        // 上游的默认值是英文，而上游自己的注释写着
        // 「When your page is not in English, you must define translated values」——
        // 这两项**只对读屏软件可见**（标题带 `sr-only` 类，回链是 `aria-label`），
        // 但恰恰是这类「只给辅助技术看」的文字最容易漏掉本地化：
        // 眼睛看不见，测试也难发现。
        footnoteLabel: t("脚注"),
        footnoteBackLabel: (referenceIndex: number, rereferenceIndex: number) => {
          const label = t("返回引用 {index}", { index: referenceIndex + 1 });
          // 同一个脚注被引用多次时，上游会加一个后缀区分（第 2 次、第 3 次…）
          return rereferenceIndex > 1 ? `${label}-${rereferenceIndex}` : label;
        },
      })
      .use(rehypeStringify, { allowDangerousHtml: true }) as unknown as HtmlPipeline
  );
}

type HtmlProcessor = ReturnType<typeof buildHtmlProcessor>;

/**
 * 处理器缓存。
 *
 * **按「语言 + 是否保留原始 HTML」分键**：
 *
 * - 语言：脚注标签是在 `.use()` 时定下的（`.use()` 的选项是静态的，
 *   不跟着设置里的语言变），语言一换就得重建处理器。
 * - 原始 HTML 开关：`remarkRehype` 的 `allowDangerousHtml` 同样是静态选项。
 *
 * 用 `Map` 而不是单个槽位：导出（保留）与剪贴板（丢弃）**交替调用**是常态，
 * 单槽位会来回重建——那正是缓存要避免的事。
 *
 * 键的取值空间有界（语言数 × 2），不会无限增长。
 */
const htmlProcessors = new Map<string, HtmlProcessor>();

/** 获取（并缓存）HTML 输出处理器 */
function getHtmlProcessor(allowRawHtml: boolean): HtmlProcessor {
  const locale = getLocale();
  const key = `${locale}|${allowRawHtml ? "raw" : "noraw"}`;
  let processor = htmlProcessors.get(key);
  if (!processor) {
    processor = buildHtmlProcessor(allowRawHtml);
    htmlProcessors.set(key, processor);
  }
  return processor;
}

/**
 * 把 mdast 树转成 HTML 字符串。
 *
 * 直接吃 mdast（而不是源码），是为了保证「渲染出来的」与
 * 「解析出来的」出自同一棵语义树——这是架构约束 C 的要求。
 *
 * ## 会**就地修改**传入的树
 *
 * 因为 GitHub 提示块（`> [!NOTE]`）的变换是**破坏性**的：
 * 上游插件会把 `[!NOTE]` 从正文里删掉，再往引用块里插一个标题段落。
 *
 * 这个变换**不能**放在解析层——放那儿的话，
 * 往返（mdast → Markdown → mdast）就丢了标记，
 * 而 Inkstone 对往返的要求是「再次解析后结构等价」。
 *
 * 所以它属于**表现层变换**，与公式的 `rehypeMath` 同性质，
 * 都发生在这条「mdast → HTML」的链路上。
 *
 * 代价：调用方要保证传进来的是一棵**一次性**的树
 * （`markdownToHtml` 传的就是刚解析出来的那棵）。
 */
export function htmlFromAst(tree: MarkdownAst, options: HtmlOptions = {}): string {
  const processor = getHtmlProcessor(options.allowRawHtml === true);
  const features = resolveFeatures(options.features);

  // 提示块变换要在 mdast → hast **之前**做：
  // 上游插件靠 `node.data.hName` 指定输出标签（`div` + `markdown-alert` 类名），
  // 那套机制是 `mdast-util-to-hast` 的，晚了就只剩一个普通引用块。
  if (features.githubAlerts) {
    applyAlerts(tree);
  }

  // 图片尺寸（`=WxH`）也要在 mdast → hast **之前**处理：
  // 有空格那种写法 mdast 根本认不出它是图片（只是一段文本），
  // 不在这里换成 image 节点，导出出来就是一串字面文本；
  // 无空格那种的 url 带着尺寸，不剥掉的话导出的图片地址是坏的。
  applyImageSizes(tree);

  // 第一步：mdast → hast。
  // 注意 `runSync` 返回的是**hast 树本身**（不是 VFile）——
  // remark-rehype 的 transformer 直接返回新树，unified 就把它当作 run 的结果。
  const hast = processor.runSync(tree);
  // 第二步：公式 → KaTeX HTML。
  // 这里**手动调用**而不是 `.use(rehypeMath)`：插件内部用的是本项目自定义的
  // 最小 hast 结构（见 rehype-math.ts），挂进 unified 会让整条流水线的类型
  // 推断跑到 hast 上，`runSync` 的入参类型跟着变。手动调用既绕开这个，
  // 也让「公式在哪一步被替换」在代码里一目了然。
  //
  // `mhchem` 开关要跟着走：关掉时 `\ce{…}` 降级成字面文本，
  // 与编辑器里的表现一致（架构约束 C）。
  const withMath = rehypeMath({
    styles: katexStylesheet(),
    mhchem: features.mhchem,
  })(hast);
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
 *
 * `allowRawHtml`（保留用户原始 HTML）默认**关**——
 * 导出那条路会显式打开，见 `HtmlOptions` 的说明。
 */
export function markdownToHtml(source: string, options?: HtmlOptions): string {
  return htmlFromAst(parseMarkdown(source, options), options);
}

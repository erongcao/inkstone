/**
 * Mermaid 图进 HTML 导出。
 *
 * ## 为什么需要这一步
 *
 * 导出链路是 `mdast → hast → HTML 字符串`（见 `src/parser/html.ts`），
 * 而 mermaid 是**运行时**渲染的：它要真实的 DOM 与布局引擎，
 * remark 那条管线里没有它。
 *
 * 结果是：屏幕上看到的是一张图，导出后看到的是一坨 mermaid 源码——
 * 这正是架构约束 C（屏幕与导出必须一致）要避免的事。
 *
 * 所以这里在 **HTML 字符串**这一层做替换：
 * 找到 ` ```mermaid ` 围栏产出的代码块，渲染成 SVG，塞回去。
 *
 * ## 为什么不在 mdast 层做
 *
 * 在 mdast 层做更「干净」（可以换节点类型），但那样每个出口
 * （导出 HTML、导出 PDF、剪贴板）都得改一遍解析流水线，
 * 而它们现在共用 `htmlFromAst`。
 * 在 HTML 字符串层做，**一处**变换覆盖所有出口。
 *
 * ## 接缝：代码高亮**放过** mermaid 块
 *
 * `src/export/html.ts` 的 `highlightCodeBlocks` 早先会把
 * `<pre><code class="language-mermaid">` 改写成
 * `<pre><code class="hljs language-plaintext">`——
 * 因为 mermaid 不是 highlight.js 的语言。
 * 一旦如此，`language-mermaid` 这个标记就没了，这里再也认不出来。
 *
 * 现在的做法是**高亮那一层放过 mermaid 块**（原样保留），
 * 于是本变换排在高亮**之后**也能认出那些块。
 *
 * 顺带的好处：图渲染失败时退回的那个源码块，**没有被高亮动过**——
 * 用户看到的就是他写的那段源码。
 */

import { renderDiagramAsync } from "@/editor/render/mermaid-loader";

/**
 * HTML 实体解码。
 *
 * ## ⚠️ 与 `src/export/html.ts` 的 `decodeEntities` **必须保持同步**
 *
 * 两份是**复制**而不是共用，原因是循环依赖：
 * `html.ts` 要调用本模块的变换，而本模块要从 `html.ts` 取解码函数。
 *
 * 若将来要合并，把函数提到第三个模块（例如 `src/export/entities.ts`），
 * 然后**两处一起改**——不要只改一处，否则两条链路的解码结果会分叉。
 *
 * ## 为什么解码**两轮**
 *
 * `rehype-stringify` 会把代码块的文本做 HTML 转义：
 * `<` → `&#x3C;`、`&` → `&#x26;`。
 * 而源码里**本来就写着** `&lt;` 这种字面量时，
 * 那个 `&` 还会被再转义一次（`&` → `&#x26;`），
 * 于是 `&lt;` 变成 `&#x26;lt;`。
 *
 * 只解一轮拿到的是 `&lt;`——仍然是实体，不是原文。
 * 两轮（先命名实体、再数字实体）之后拿到的才是真正的源码。
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

/** 一个待渲染的 mermaid 块 */
export interface MermaidBlock {
  /** 源码 */
  code: string;
  /** 在 HTML 字符串里的出现序号（从 0 起） */
  index: number;
}

/**
 * 渲染结果的最小形状。
 *
 * 与 `mermaid-loader` 的 `DiagramResult` 同形——
 * 那边的缓存条目就是 `{ ok, output }`。
 */
export interface MermaidRenderResult {
  /** 图是否渲染成功 */
  ok: boolean;
  /** 成功时是 SVG 源码，失败时是错误说明 */
  output: string;
}

/**
 * 渲染函数。
 *
 * 做成**依赖注入**是为了让整条变换不依赖真实 mermaid 也能测——
 * mermaid 带 5.0 MB 的传递依赖，在 jsdom 里跑也不稳（实测产出空 SVG）。
 */
export type MermaidRenderFn = (code: string) => Promise<MermaidRenderResult | null>;

/**
 * 一个代码块在 HTML 里的位置与内容 */
interface BlockSpan {
  /** 整块（含标签）在 HTML 里的起点 */
  start: number;
  /** 整块（含标签）在 HTML 里的终点 */
  end: number;
  /** 标签里的源码（仍是转义过的） */
  escaped: string;
}

/**
 * 逐个找出 mermaid 代码块。
 *
 * ## 匹配的是什么
 *
 * `remark-rehype` 对带 `lang` 的代码块产出
 * `<pre><code class="language-xxx">…</code></pre>`。
 *
 * 非贪婪是关键：`**` 换成 `[\s\S]*?` 是为了能跨行（代码块源码本来就是多行的），
 * 而不是为了让正则跨过多个代码块——`[\s\S]*?` 遇到第一个 `</code></pre>` 就停，
 * 所以不会把两个代码块一起吞掉。
 *
 * ## 正则**在函数里新建**，不用模块级的常量
 *
 * 带 `g` 标志的正则是**有状态的**（`lastIndex`）：
 * 复用同一个实例，第二次调用会从上一次的位置继续找——
 * 导出同一个字符串两次，第二次就会找不到块了。
 * （仓库里 `src/export/inline-images.ts` 踩过同一个坑。）
 */
function* iterateMermaidBlocks(html: string): Generator<BlockSpan> {
  const pattern = /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    yield {
      start: match.index,
      end: match.index + match[0].length,
      escaped: match[1],
    };
  }
}

/**
 * 找出 HTML 里所有 mermaid 代码块。
 *
 * 只认 `class="language-mermaid"` 的围栏——
 * 那是 `remark-rehype` 对 ` ```mermaid ` 围栏的固定产出形态
 * （` ```mermaid {theme: dark} ` 这种带参数的写法也归到它，
 * 因为 remark 把参数丢在 meta 里，不进 class）。
 *
 * @param html 导出产物（或其中一段）
 */
export function findMermaidBlocks(html: string): MermaidBlock[] {
  const blocks: MermaidBlock[] = [];
  for (const block of iterateMermaidBlocks(html)) {
    blocks.push({ code: decodeEntities(block.escaped), index: blocks.length });
  }
  return blocks;
}

/**
 * 渲染一块图；成功返回 figure 的 HTML，失败返回 `null`。
 *
 * **每块各自 catch**：一张图画崩了不能把整次导出带崩。
 */
async function renderOne(code: string, render: MermaidRenderFn): Promise<string | null> {
  let result: MermaidRenderResult | null;
  try {
    result = await render(code);
  } catch {
    // 渲染器抛异常 = 这张图画不出来，退回源码块
    return null;
  }
  if (!result || !result.ok) return null;
  const svg = result.output;
  if (!svg) return null;
  // mermaid 产出的 SVG 自带 `<style>`（含它自己的 CSS 变量），
  // **原样内嵌**进 figure——mermaid 官方建议的就是内联 SVG。
  return `<figure class="inkstone-mermaid">${svg}</figure>`;
}

/**
 * 默认渲染器：走编辑器那一份 mermaid 渲染器。
 *
 * 不用自己 `import("mermaid")`：导出出来的图必须和屏幕上那张
 * **配置完全一致**（架构约束 C）——同一套缓存、同一套主题逻辑。
 *
 * 顺带保住了懒加载：`mermaid-loader` 里是 `import("mermaid")`，
 * 那个 5.0 MB 的 chunk 不会进主 chunk。
 */
async function defaultRender(code: string): Promise<MermaidRenderResult | null> {
  return renderDiagramAsync(code);
}

/**
 * 把 mermaid 代码块替换成渲染好的图形。
 *
 * ## 失败时**原样保留**原代码块
 *
 * 坏图要退化成源码，**绝不能静默丢内容**——
 * 用户辛辛苦苦写的图表源码，导出后必须还在（能看懂、能修）。
 *
 * ## 逐块重建字符串
 *
 * 不用一次性的 `replace` + 回调：回调里要做异步渲染，
 * 既拿不到结果也不好处理单块失败。
 *
 * @param html 原始 HTML
 * @param render 渲染函数（依赖注入；默认走编辑器的 mermaid 渲染器）
 */
export async function renderMermaidBlocks(
  html: string,
  render: MermaidRenderFn = defaultRender,
): Promise<string> {
  const blocks = [...iterateMermaidBlocks(html)];
  if (blocks.length === 0) return html;

  let out = "";
  let cursor = 0;
  for (const block of blocks) {
    out += html.slice(cursor, block.start);
    const original = html.slice(block.start, block.end);
    const figure = await renderOne(decodeEntities(block.escaped), render);
    // 渲染失败 → 保留原代码块
    out += figure ?? original;
    cursor = block.end;
  }
  out += html.slice(cursor);
  return out;
}

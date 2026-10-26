/**
 * 真正调用 KaTeX 与 remark 的模块（按需加载的靶子）。
 *
 * 单独拆一个文件的意义：**只有这个文件同时 import KaTeX 和解析层**，
 * 于是 KaTeX 的 603 KB JS + CSS + 字体、以及 remark 管线（约 137 KB）
 * 全部落进同一个独立 chunk，不进主 chunk。
 *
 * 为什么把「渲染公式」和「定位行内公式」绑在同一个 chunk 里：
 *   两者都是公式功能的一部分，启动时本来就要一起加载，
 *   分成两个 chunk 只会多一次往返，还要维护两套就绪信号。
 *   代价是 KaTeX 加载失败会连累行内定位——但那本来就是同一条链路上的一环。
 *
 * 加载逻辑在 `math-loader.ts`。
 */

import katex from "katex";
import "katex/dist/katex.min.css";
import { parseMarkdown } from "@/parser/markdown";
import { MATH_OPTIONS, type MathRenderer, type InlineParser } from "./math-loader";
import { stripMhchem } from "./mhchem";

/**
 * 渲染公式。
 *
 * KaTeX 的输出同时含 HTML（显示）与 MathML（无障碍），是可信的生成结果，
 * 可以直接进 `innerHTML`——`trust: false`（默认）已经禁掉了
 * `\href` / `\url` 这类能注入任意地址或标签的宏。
 *
 * `displayMode` 由调用方按块级/行内分别指定；
 * 其余安全相关选项（`throwOnError` / `trust` / `output`）在
 * `MATH_OPTIONS` 里定死，调用方只能覆盖显示方式。
 */
export const renderMath: MathRenderer = (tex, overrides) => {
  // mhchem 关掉时，`\ce{…}` 降级成字面文本。
  //
  // 放在**这里**（而不是各调用点）是因为这是唯一的收口：
  // 编辑器内的行内公式、块级公式、复制出去的 HTML、导出的 HTML
  // 全都走这一个函数——一处处理，四处一致。
  const source = overrides?.mhchem === false ? stripMhchem(tex) : tex;
  return katex.renderToString(source, { ...MATH_OPTIONS, ...overrides });
};

/** 逐行解析出 mdast（供行内公式定位用） */
export const parseInline: InlineParser = (lineText, options) =>
  parseMarkdown(lineText, options);

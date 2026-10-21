/**
 * 真正调用 KaTeX 的模块（按需加载的靶子）。
 *
 * 单独拆一个文件的意义：**只有这个文件 `import "katex"`**，
 * 于是 KaTeX 的 603 KB JS + CSS + 字体全部落进独立的动态 chunk，
 * 不进主 chunk。加载逻辑在 `math-loader.ts`。
 */

import katex from "katex";
import "katex/dist/katex.min.css";
import { MATH_OPTIONS, type MathRenderer } from "./math-loader";

/**
 * 渲染块级公式。
 *
 * KaTeX 的输出同时含 HTML（显示）与 MathML（无障碍），是可信的生成结果，
 * 可以直接进 `innerHTML`——`trust: false`（默认）已经禁掉了
 * `\href` / `\url` 这类能注入任意地址或标签的宏。
 */
export const renderMath: MathRenderer = (tex) => katex.renderToString(tex, MATH_OPTIONS);

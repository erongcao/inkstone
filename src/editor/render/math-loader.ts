/**
 * KaTeX 的按需加载。
 *
 * 背景：`katex/dist/katex.mjs` 单文件就有 **603 KB**（raw），
 * 加上 `katex.min.css`（25 KB）与 20 个 woff2 字体（1.1 MB 目录，woff2 子集约 300 KB）。
 * 对一个桌面应用来说这不是包体问题，但它会拖慢冷启动——
 * 而冷启动有明确目标（< 1.5s），和 `html-loader.ts` 是同一条理由。
 *
 * 所以沿用 remark-rehype 那一套：**启动后空闲时预热**，之后所有同步调用点都能直接拿到结果。
 *
 * 与 HTML 渲染器的一处关键不同：
 *   `⌘C` 拿不到渲染器时还能退回纯文本，**用户体验只是降级**；
 *   但公式拿不到渲染器时，`render()` 返回 null → 块级装饰器不生成 →
 *   **公式块会直接显示成源码**。所以加载完成后必须主动通知编辑器重算装饰器，
 *   否则用户要敲一个字符才会看到公式出现（见 `onMathRendererReady`）。
 */

import type { KatexOptions } from "katex";
import type { MarkdownAst } from "@/parser/markdown";
import type { ParseOptions } from "@/parser/markdown";

/**
 * 渲染选项：在 KaTeX 自己的选项之外，加一个 Inkstone 自己的开关。
 *
 * `mhchem` —— 化学扩展是否生效。
 * 关掉时 `\ce{…}` 降级成字面文本（见 `mhchem.ts`）。
 *
 * 为什么不放进 KaTeX 的 `macros`：KaTeX 没有「禁用某个命令」的开关，
 * 而宏重定义只能改变命令的**输出**，改不掉命令本身——
 * 用户看到的是 `H2O` 而不是 `\ce{H2O}`，标记丢了。
 */
export interface MathRenderOptions extends KatexOptions {
  /** mhchem 是否生效（默认开） */
  mhchem?: boolean;
}

/**
 * 渲染函数签名：TeX → HTML。
 *
 * 第二个参数覆盖默认选项，主要是 `displayMode`
 * （块级公式 `true` / 行内公式 `false`）。
 */
export type MathRenderer = (tex: string, overrides?: MathRenderOptions) => string;

/**
 * 逐行解析：行文本 → mdast。
 *
 * 也放在这个模块里，是因为 remark 管线（unified + remark-parse + gfm + math +
 * stringify，约 137 KB）**只**被公式定位用到，
 * 和 KaTeX 一起塞进同一个按需 chunk，主 chunk 才不会被拖大。
 */
export type InlineParser = (lineText: string, options: ParseOptions) => MarkdownAst;

/**
 * 渲染选项。
 *
 * - `displayMode: true` —— 块级公式（`$$…$$`），上下居中、可独立成行
 * - `throwOnError: false` —— **不抛异常**，把错误渲染成带 hover 提示的红色源码。
 *   这是编辑器的正确选择：用户正在打字，中间状态本来就不是合法 TeX，
 *   抛异常会让整块公式消失。错误配色由 CSS 接管（`.katex-error`），跟着主题走。
 * - `trust` 保持默认 false —— 禁止 `\href` / `\url`，避免公式里注入任意链接
 * - `output: "htmlAndMathml"` —— 默认值，显式写出：HTML 负责显示，MathML 负责无障碍
 */
export const MATH_OPTIONS: Readonly<KatexOptions> = Object.freeze({
  displayMode: true,
  throwOnError: false,
  output: "htmlAndMathml",
});

let renderer: MathRenderer | null = null;
let parser: InlineParser | null = null;
let pending: Promise<MathRenderer> | null = null;

const listeners = new Set<() => void>();

/** 真正加载并缓存渲染器 */
function load(): Promise<MathRenderer> {
  if (renderer) return Promise.resolve(renderer);
  if (pending) return pending;
  pending = import("./math-render")
    .then((mod) => {
      renderer = mod.renderMath;
      parser = mod.parseInline;
      // 就绪通知：让已打开的编辑器重算装饰器，把「源码形态」升级成「渲染形态」
      for (const notify of listeners) notify();
      return renderer;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** 渲染器（KaTeX + remark 管线）是否已就绪 */
export function isMathRendererReady(): boolean {
  return renderer !== null && parser !== null;
}

/**
 * 同步解析一行。
 *
 * @returns 管线尚未就绪时返回 null——调用方应据此跳过行内公式定位，
 *          而不是退回某套「轻量正则」。理由见 `inline-math.ts`：
 *          一旦编辑器另起一套规则，红线 C（解析规则唯一）就破了。
 */
export function parseInlineSync(
  lineText: string,
  options: ParseOptions,
): MarkdownAst | null {
  if (!parser) return null;
  try {
    return parser(lineText, options);
  } catch {
    return null;
  }
}

/**
 * 同步渲染 TeX。
 *
 * @param tex        TeX 源码
 * @param overrides  覆盖默认选项（块级 `displayMode: true`）
 * @returns 渲染器尚未就绪时返回 null——调用方应据此退回源码显示
 */
export function renderMathSync(
  tex: string,
  overrides?: MathRenderOptions,
): string | null {
  if (!renderer) return null;
  try {
    return renderer(tex, { ...MATH_OPTIONS, ...overrides });
  } catch {
    return null;
  }
}

/**
 * 预加载公式渲染器。
 *
 * 建议在应用启动后的空闲时机调用（与 `primeHtmlRenderer` 同一个位置）。
 * 加载失败不会抛到调用方——公式退回源码显示即可。
 */
export function primeMathRenderer(): void {
  void load().catch(() => {
    /* 预加载失败不影响主流程，公式块会一直保持源码形态 */
  });
}

/** 等待渲染器就绪（异步场景用；目前主要是测试） */
export function ensureMathRenderer(): Promise<MathRenderer> {
  return load();
}

/**
 * 订阅「渲染器就绪」事件，返回取消订阅函数。
 *
 * 订阅时如果已经就绪会**立即**同步回调一次——
 * 否则「先加载完、后打开编辑器」的场景会漏掉这次通知。
 */
export function onMathRendererReady(listener: () => void): () => void {
  if (renderer) {
    listener();
    return () => {};
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

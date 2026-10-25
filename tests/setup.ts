/**
 * 测试环境垫片。
 *
 * jsdom 不实现部分浏览器 API，这里补齐应用用到的部分。
 */

import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// 注意：这里**不需要**再为高亮库做实例对齐。
// 旧的 Prism 实现里，语言组件是副作用式注册到全局 `Prism` 上的，
// 而 jsdom 的 window 与 node 的 global 不是同一个对象，
// 于是会出现「注册在一个实例、读取在另一个实例」，
// 表现是 `Prism.highlight` 静默降级成纯文本（实测踩过）。
// 现在换用 highlight.js 的 `lib/core`：单例由模块自己持有，
// 语言靠 `registerLanguage` 显式注册，不碰任何全局对象，
// dev / 生产构建 / vitest 三处行为一致。

// matchMedia：主题运行时用它监听系统明暗偏好
if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

// jsdom 不实现 scrollTo，ProseMirror / CodeMirror 等库会调用
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;

// jsdom 完全不做布局，因此 Range 上一个尺寸 API 都没实现。
// CodeMirror 的 DOMObserver 在 requestAnimationFrame 里会调
// `range.getClientRects()` 来忽略没被改动的区域——
// 一旦某个用例建完 EditorView 还没等 rAF 跑完就结束，
// 这个异常会在用例之外抛出，vitest 记成 unhandled error 并让整个 run 失败。
//
// 补一个「什么都没有」的桩：空列表 + 零尺寸矩形。
// 这是**如实**的——jsdom 里本来就没有任何布局信息，
// CM6 对空结果的处理路径（认为所有区域都变了）恰恰是最保守的那个。
const emptyRect = (): DOMRect => ({
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  left: 0,
  bottom: 0,
  right: 0,
  toJSON: () => ({}),
});
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = function getClientRects() {
    const list = [] as unknown as DOMRectList & Iterable<DOMRect>;
    // CM6 会 `Array.from(...)` 或直接迭代，补上迭代协议
    (list as unknown as { [Symbol.iterator](): IterableIterator<DOMRect> })[
      Symbol.iterator
    ] = function* () {
      /* 空 */
    };
    list.item = () => null;
    return list;
  };
}
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = emptyRect as unknown as Range["getBoundingClientRect"];
}

/**
 * 注入 KaTeX 的样式表。
 *
 * ## 为什么需要这一步
 *
 * `src/parser/rehype-math.ts` 的 `katexStylesheet()` 有两条取法：
 *   1. `?raw` import —— **vitest 里不生效**（vitest 对 CSS 资源的处理会返回空模块，
 *      不像 Vite 那样把文件内容当字符串打进来）
 *   2. 运行时从 `document.styleSheets` 找含 `.katex` 的样式表
 *
 * 第 2 条在 dev 与生产里都有效（KaTeX 的 CSS 是跟着 `math-render` chunk 注入的），
 * 但测试环境里没有任何 CSS 被注入，所以两条都拿不到 → 拿到的样式表是空串。
 *
 * 这不是「测试环境的小毛病」：导出的 HTML 里少了 KaTeX 的样式表，
 * `.katex-mathml { position: absolute }` 这条规则就没了——
 * 那是用来把「给读屏软件用的 MathML 副本」藏起来的规则。
 * 少了它，导出的文件里每条公式都会显示成「KaTeX 渲染结果 + 一串裸 LaTeX」两份。
 *
 * 所以这里把 KaTeX 的 CSS 注入 DOM，让测试环境与真机行为一致，
 * 测试才能真正挡住「导出公式错乱」这个 bug。
 */
try {
  const katexCssPath = createRequire(import.meta.url).resolve("katex/dist/katex.min.css");
  const katexStyle = document.createElement("style");
  katexStyle.id = "inkstone-test-katex-css";
  katexStyle.textContent = readFileSync(katexCssPath, "utf-8");
  document.head.appendChild(katexStyle);
} catch {
  // 拿不到就让 katexStylesheet() 走它自己的兜底——
  // 相关的用例会因此失败，那正是我们想看到的（不能静默通过）
}

// 每个测试前清掉设置，避免用例之间互相污染
beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-mode");
});

/*
 * 每个测试后卸载 React 树。
 *
 * ## 为什么必须自己写
 *
 * @testing-library/react 的**自动 cleanup** 靠全局 `afterEach` 注册：
 *
 *   if (typeof afterEach === "function") afterEach(() => cleanup())
 *
 * 而 `vitest.config.ts` 里 `globals: false` —— 没有全局 `afterEach`，
 * 于是**自动 cleanup 根本没注册**。
 * 结果：测试文件里 render 出来的 React 树会活过整个文件，
 * 连同挂在上面的 CodeMirror 实例一起。
 *
 * ## 活过文件会怎样
 *
 * CM6 内部有个 10ms 的 focus 定时器（`updateForFocusChange`），
 * 视图销毁时它**不会被取消**。文件跑完 → vitest 拆掉 jsdom 环境 →
 * `populateGlobal` 的清理把 globalThis 上的 `requestAnimationFrame` 删掉
 * （jsdom 环境里 `document.defaultView === globalThis`，
 *  所以 CM6 的 `view.win` 就是 globalThis）。
 * 那个定时器这时才触发 → `view.update([])` → `requestMeasure()` →
 * `this.win.requestAnimationFrame` → **TypeError**。
 *
 * 表现是「所有用例都过了，但 vitest 报 1 个 unhandled error，退出码 1」——
 * CI 上就是这个（Node 22 job 挂了，本地复现不了：本地 teardown 比 10ms 慢，
 * 定时器赶在环境销毁前就触发了）。
 *
 * 有了这个 afterEach，React 树在每个用例结束时就被卸载，
 * `editor.destroy()` → `view.destroy()` → 视图标记为已销毁，
 * 那个定时器再触发时 `update()` 会提前返回，什么都不做。
 */
afterEach(() => {
  cleanup();
});

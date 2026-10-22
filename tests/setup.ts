/**
 * 测试环境垫片。
 *
 * jsdom 不实现部分浏览器 API，这里补齐应用用到的部分。
 */

import { beforeEach, vi } from "vitest";

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

// 每个测试前清掉设置，避免用例之间互相污染
beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-mode");
});

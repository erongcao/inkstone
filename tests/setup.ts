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

// 每��测试前清掉设置，避免用例之间互相污染
beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-mode");
});

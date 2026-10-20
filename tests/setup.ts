/**
 * 测试环境垫片。
 *
 * jsdom 不实现部分浏览器 API，这里补齐应用用到的部分。
 */

import { beforeEach, vi } from "vitest";

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

import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    globals: false,
    server: {
      deps: {
        // prismjs 是 CommonJS，且它的语言组件是**副作用式**的
        // （直接往全局 `Prism` 上挂 `Prism.languages.xxx`）。
        // 不 inline 的话，vitest 的模块隔离会让「注册」与「读取」落在
        // 两个不同的 Prism 实例上，表现为高亮静默失效。
        inline: ["prismjs"],
      },
    },
  },
});

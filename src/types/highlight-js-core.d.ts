/**
 * `highlight.js/lib/core` 没有类型声明。
 *
 * 原因在 highlight.js 自己的 package.json：`exports` 里 `"./lib/core"`
 * 只给了 `require` / `import` 两个 JS 路径，没有 `types` 字段，
 * 而 `types/index.d.ts` 只声明了根入口 `highlight.js`。
 *
 * 我们刻意用 `lib/core` 而不是根入口：
 *   - 根入口 = 190 多个语言全量注册，包体大
 *   - `lib/core` = 空壳，靠 `registerLanguage` 显式注册需要的语言，
 *     没有全局副作用（这正是 Prism 踩过的坑）
 */
declare module "highlight.js/lib/core" {
  import type { HLJSApi } from "highlight.js";
  const hljs: HLJSApi;
  export default hljs;
}

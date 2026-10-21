import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// Tauri 需要固定端口，dev server 不能随机换端口
const host = process.env.TAURI_DEV_HOST;

/**
 * 只保留 woff2，丢掉 KaTeX 的 woff / ttf 回退字体。
 *
 * 为什么要专门做这一步（实测数据）：
 *   `katex.min.css` 的每个 `@font-face` 都列了三种格式，
 *   Vite 会把**被引用到的全部字体**打进产物：
 *     woff2 292 KB + woff 336 KB + ttf 540 KB = 1.02 MB
 *   而浏览器永远只下载列表里第一个支持的格式（woff2），
 *   所以另外 **876 KB 打进 .app 包但永远不会被下载**——纯死重。
 *
 *   Tauri 的 WKWebView / WebView2 都完整支持 woff2，
 *   项目也已固定 `build.target: "es2022"`，没有向下兼容的负担。
 *
 * 只动 KaTeX 的 CSS，不做通用改写——
 * 通用规则容易误伤将来引入的、真的需要 ttf 回退的字体。
 */
function woff2OnlyFonts(): Plugin {
  return {
    name: "inkstone:woff2-only-fonts",
    enforce: "pre",
    transform(code, id) {
      if (!/katex[\w.-]*\.css(\?|$)/.test(id)) return null;
      // 去掉 `,url(x.woff) format("woff")` 与 `,url(x.ttf) format("truetype")` 两段
      const out = code.replace(
        /,url\([^)]*\.(?:woff|ttf)\)\s*format\("(?:woff|truetype|eot)"\)/g,
        "",
      );
      return out === code ? null : { code: out, map: null };
    },
  };
}

export default defineConfig({
  plugins: [woff2OnlyFonts(), react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // Rust 侧目录交给 tauri 自己监听，否则会触发整页刷新
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    // Tauri 目标平台固定为现代浏览器
    target: "es2022",
    // Vite 8 默认使用 rolldown(oxc) 压缩器，不要指定 "esbuild"
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});

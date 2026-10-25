import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { primeHtmlRenderer } from "./parser/html-loader";
import { primeMathRenderer } from "./editor/render/math-loader";
import "./styles/base.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("找不到 #root 挂载点");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// 预加载 HTML 渲染器（remark-rehype 约 180 KB，按需加载）。
// dynamic import 不会阻塞首屏渲染，所以启动后立刻发起，
// 让「⌘C 复制」在绝大多数时候都能带上 text/html。
// 见 src/parser/html-loader.ts。
primeHtmlRenderer();

// 预加载 KaTeX（约 603 KB + 字体，按需加载）。
// 公式块在 KaTeX 就绪前会显示成源码，就绪后自动切换成渲染形态
// （见 src/editor/render/math-loader.ts 与 live-preview/state.ts 的 refreshRendering）。
primeMathRenderer();

// 开发期专用：URL 带 ?ai-mock=1 时装上 AI 的 mock runner，
// 让「流式 → 预览 → 接受」这条链路能在没有真实 API Key 时被端到端验收。
// 生产构建里 import.meta.env.DEV 为 false，整段会被摇掉。
if (import.meta.env.DEV) {
  void import("./dev/ai-mock").then((mod) => mod.installAiMockIfRequested());
}

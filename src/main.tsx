import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { primeHtmlRenderer } from "./parser/html-loader";
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

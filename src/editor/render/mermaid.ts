/**
 * Mermaid 图表：围栏代码块且语言是 `mermaid`。
 *
 * ## 定位用 lezer 而不是行扫描
 *
 * `FencedCode` + `CodeInfo` 节点能正确处理围栏长度（```` 四反引号）、
 * 缩进与块内的反引号，比行扫描准——所以直接复用 `findCodeBlocks` 的遍历逻辑。
 *
 * ## 为什么必须注册在 `code-block` **之前**
 *
 * 两者都会匹配同一个 `FencedCode` 节点（一个当代码、一个当图表）。
 * `collectBlockMatches` 按注册顺序遍历，把先认走的区间放进 `claimed`，
 * 后面的渲染器靠它让开——**但前提是后面的渲染器真的看了 `claimed`**。
 * `findCodeBlocks` 第一版忽略这个参数，mermaid 图会被代码高亮再渲染一遍。
 *
 * ## 渲染为什么返回 null
 *
 * `mermaid.render()` 是异步的且慢（50–300 ms），而 `BlockRenderer.render()`
 * 必须同步。没有缓存时返回 null → 块保持源码形态；
 * 渲染完成后由 `onDiagramRendered` 通知编辑器重算装饰器，图表才出现。
 * 防抖逻辑在 `mermaid-loader.ts`（250 ms 静默期），理由见那里的说明。
 */

import type { Tree } from "@lezer/common";
import type { Interval } from "./scan";
import { onDiagramRendered, renderDiagram } from "./mermaid-loader";
import type { BlockMatch, BlockRenderer, BlockRenderResult } from "./types";

/** 支持的语言写法：全小写，允许带参数（`mermaid {theme:dark}`） */
const INFO = /^mermaid\b/i;

/**
 * 找出文档里所有 mermaid 图。
 *
 * 与 `findCodeBlocks` 同样的遍历，但只收 mermaid，且**跳过已被别人认走的区间**。
 */
export function findMermaidBlocks(
  tree: Tree,
  source: string,
  claimed: readonly Interval[] = [],
): BlockMatch[] {
  const matches: BlockMatch[] = [];
  tree.iterate({
    enter(ref) {
      if (ref.type.name !== "FencedCode") return;
      // 已被先注册的渲染器认走 → 让开，否则同一段文本会被替换两次
      if (claimed.some((r) => r.from < ref.to && ref.from < r.to)) return;

      let language: string | undefined;
      let content = "";
      const cursor = ref.node.cursor();
      if (cursor.firstChild()) {
        do {
          const child = cursor.node;
          if (child.type.name === "CodeInfo") {
            language =
              child.to > child.from ? source.slice(child.from, child.to) : undefined;
          } else if (child.type.name === "CodeText") {
            content = source.slice(child.from, child.to);
          }
        } while (cursor.nextSibling());
      }
      if (!language || !INFO.test(language.trim())) return;

      matches.push({ from: ref.from, to: ref.to, kind: "mermaid", language, content });
    },
  });
  return matches;
}

/** Mermaid 块渲染器 */
export const mermaidBlockRenderer: BlockRenderer = {
  id: "mermaid-block",
  /** 关掉「Mermaid 图表」时这个渲染器不参与——图表退回代码块形态 */
  feature: "mermaid",

  find(tree, source, claimed) {
    return findMermaidBlocks(tree, source, claimed);
  },

  render(match) {
    const result = renderDiagram(match.content);
    // 还没渲染好 → 保持源码形态，渲染完会通知重算
    if (!result) return null;

    const dom = document.createElement("div");
    dom.className = result.ok ? "cm-md-mermaid" : "cm-md-mermaid cm-md-mermaid--error";

    if (result.ok) {
      dom.innerHTML = result.output;
      const svg = dom.querySelector("svg");
      if (svg) svg.removeAttribute("height"); // 让 CSS 控制高度，避免内联高度压过排版
    } else {
      // 语法错误：显示 mermaid 的报错文本（已转义，见下面 textContent）
      const pre = document.createElement("pre");
      pre.className = "cm-md-mermaid-error";
      pre.textContent = result.output;
      dom.appendChild(pre);
    }

    return {
      dom,
      // 指纹要覆盖主题：同一段代码在明暗两套主题下渲染结果不同
      key: `mermaid:${result.ok}:${match.content.length}:${result.output.length}`,
    } satisfies BlockRenderResult;
  },
};

/**
 * 订阅「图表渲染完成」，返回取消订阅函数。
 *
 * 由 `livePreview` 接到装饰器重算上——与 `onMathRendererReady` 同一个位置。
 */
export const onMermaidRendered = onDiagramRendered;

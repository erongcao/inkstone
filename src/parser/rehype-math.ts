/**
 * hast 插件：把公式节点换成 KaTeX 渲染结果。
 *
 * ## 为什么不直接用 `rehype-katex`
 *
 * `rehype-katex` 依赖 `katex@^0.16`，而本项目顶层用的是 `katex@0.19`
 * （`math-loader.ts`）。npm 的 semver 不把 `0.16` 与 `0.19` 视为同一版本，
 * 于是 Vite 会把**两份 KaTeX 都打进产物**——一份 603 KB 的重复代码。
 *
 * 这个插件的代价是几十行，换来的是不重复打包。真正要做的事很少：
 * `remark-math` 已经把公式变成了 hast 的 `code.language-math` 节点，
 * 我们只需要读出其中的 TeX 文本、调 KaTeX、把结果换回去。
 *
 * ## 为什么不违反「解析规则唯一」
 *
 * 那条红线约束的是**语义**：mdast 怎么解释一段文本。
 * 本插件一行语法判断都没做，公式的位置与类型全部来自 `remark-math`
 * 在 mdast 阶段的判定——它只负责把 hast 节点替换成可显示的 HTML，
 * 相当于渲染阶段的 formatter，不是第二个解析器。
 *
 * ## 为什么不装 `unist-util-visit` + `@types/hast`
 *
 * hast 就是 `{children: []}` 的普通树，递归改写二十行就够；
 * 两个依赖都是 MIT，但只是为了让「遍历一棵树」这件事少写十五行。
 */

import { renderMathSync } from "@/editor/render/math-loader";
import katexCssText from "katex/dist/katex.min.css?raw";

/**
 * KaTeX 的样式表文本（用于内联到剪贴板 HTML 里）。
 *
 * 两条路，互补：
 *   1. `?raw` import——生产构建里 Vite 会把 CSS 文件内容作为字符串打进来，
 *      这条在真机上永远有效。
 *   2. 运行时从 `document.styleSheets` 兜底——测试环境（vitest 默认 stub 掉 CSS）
 *      会让第 1 条拿到空串，这时如果 CSS 已经以 `<style>` 注入（dev 下正是如此），
 *      仍能取到内容。
 *
 * 两条都拿不到就返回空串：公式照样渲染成正确的 HTML 结构，
 * 只是少了 KaTeX 的排版样式。这比让整个复制功能失败要好。
 */
export function katexStylesheet(): string {
  if (katexCssText) return katexCssText;

  for (const sheet of Array.from(document.styleSheets)) {
    const owner = sheet.ownerNode as HTMLElement | null;
    const text = owner?.textContent;
    if (!text?.includes(".katex")) continue;
    try {
      return Array.from(sheet.cssRules)
        .map((rule) => rule.cssText)
        .join("\n");
    } catch {
      // 跨域样式表访问 cssRules 会抛 SecurityError
      return text;
    }
  }
  return "";
}

/** 公式节点的 class（remark-math 打的） */
const INLINE_CLASS = "math-inline";
const DISPLAY_CLASS = "math-display";

/** 本插件关心的最小 hast 结构（避免为了类型再装一个 @types 包） */
export interface HastNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

export interface RehypeMathOptions {
  /**
   * 文档里**确实含公式**时才输出这段 CSS。
   *
   * 剪贴板场景每次复制都带 25 KB 样式是浪费——绝大多数文档一个公式都没有。
   */
  styles?: string;
  /**
   * mhchem（化学扩展）是否生效。
   *
   * 关掉时 `\ce{…}` 降级成字面文本——
   * 与编辑器里的表现一致（架构约束 C）。
   */
  mhchem?: boolean;
}

/**
 * KaTeX 输出的是 HTML 字符串，要让它原样进最终 HTML，
 * 就必须走 hast 的 `raw` 节点，并且 `hast-util-to-html` 开 `allowDangerousHtml`。
 *
 * 安全前提：这里的 raw 内容全部由 **KaTeX 自己生成**
 * （`MATH_OPTIONS.trust: false` 已禁掉 `\href` / `\url` 这类能注入任意标签或
 * 地址的宏），不是用户原文。
 *
 * ## `allowDangerousHtml` 只开在 `rehype-stringify` 上，**不是** `remark-rehype`
 *
 * 这两个插件各有一个同名选项，作用完全不同：
 *
 *   - `remark-rehype`（mdast → hast）：决定 mdast 的 `html` 节点
 *     （用户写在 Markdown 里的原始 HTML）**要不要变成 hast 的 raw 节点**。
 *     默认 `false` → **丢弃**。
 *   - `rehype-stringify`（hast → HTML）：决定 hast 里已有的 `raw` 节点
 *     要不要原样序列化。KaTeX 的输出走这条路，所以这个必须开。
 *
 * 所以：**用户写在 Markdown 里的原始 HTML，在 `remark-rehype` 阶段就没了**，
 * 到不了 `rehype-stringify`。
 *
 * （本文件早先的注释写成「用户原始 HTML 从此会被保留」——那是把两个选项
 * 搞混了。`tests/html-math.test.ts` 记的是实际行为。）
 */
export function rehypeMath(options: RehypeMathOptions = {}) {
  return (tree: HastNode): HastNode => {
    let sawFormula = false;

    const walk = (node: HastNode): void => {
      const children = node.children;
      if (!Array.isArray(children)) return;

      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const rendered = renderIfFormula(child, options.mhchem !== false);
        if (rendered) {
          children[i] = rendered;
          sawFormula = true;
          continue;
        }
        walk(child);
      }
    };
    walk(tree);

    if (sawFormula && options.styles && Array.isArray(tree.children)) {
      // 放在最前面：后面的内容都在它之后，样式优先级天然够。
      //
      // 子节点必须是 **raw** 而不是 text：hast 序列化 text 时会做 HTML 转义，
      // KaTeX CSS 里的子选择器（`.a > .b`）会变成 `&gt;`——转义后的 CSS
      // 在 `<style>` 里不会被浏览器还原，整张表直接失效。
      tree.children.unshift({
        type: "element",
        tagName: "style",
        properties: {},
        children: [{ type: "raw", value: options.styles }],
      });
    }
    return tree;
  };
}

/**
 * 如果这个节点是公式，就渲染并返回替换节点；否则返回 null。
 *
 * 渲染失败返回 `null`（保留原始 `<code>`）：`MATH_OPTIONS.throwOnError`
 * 已经是 false，KaTeX 自己会把语法错误画成带 hover 提示的红色源码；
 * 走到 catch 说明是更离谱的异常，此时**保留原文比吞掉内容好**。
 */
function renderIfFormula(node: HastNode, mhchem: boolean): HastNode | null {
  if (node.type !== "element" || node.tagName !== "code") return null;

  const raw = node.properties?.className;
  const classes = Array.isArray(raw)
    ? raw.map(String)
    : typeof raw === "string"
      ? raw.split(/\s+/)
      : [];
  const display = classes.includes(DISPLAY_CLASS);
  if (!display && !classes.includes(INLINE_CLASS)) return null;

  const tex = collectText(node);
  if (tex === null) return null;

  // 与编辑器内渲染走**同一个** `renderMath`——
  // 屏幕上和复制出去必须是同一套结果，否则「所见即所得」当场破功。
  const html = renderFormula(tex, display, mhchem);
  if (html === null) return null;

  return {
    type: "element",
    tagName: "span",
    properties: { className: ["katex-host"] },
    children: [{ type: "raw", value: html }],
  };
}

/** 收集节点下的纯文本；遇到非 text/text 之外的复杂结构返回 null */
function collectText(node: HastNode): string | null {
  let out = "";
  const walk = (n: HastNode): boolean => {
    if (n.type === "text") {
      out += n.value ?? "";
      return true;
    }
    if (n.type === "element" || n.type === "root" || n.type === "document") {
      return (n.children ?? []).every(walk);
    }
    return true; // comment / doctype 之类直接跳过
  };
  return walk(node) ? out : null;
}

/**
 * 调 KaTeX。
 *
 * 走 `renderMathSync` 而不是直接 import `math-render.ts`：
 * 后者是**懒加载 chunk 的靶子**，直接 import 会把 KaTeX 静态拉进 html chunk，
 * 让「复制为 HTML」顺带下载 603 KB。
 * `renderMathSync` 在渲染器就绪时同步返回 HTML，没就绪时返回 null——
 * 此时保留原始 `<code>`，公式以源码形式出现在剪贴板里（和现在的行为一致，不算退化）。
 */
function renderFormula(
  tex: string,
  displayMode: boolean,
  mhchem: boolean,
): string | null {
  try {
    return renderMathSync(tex, { displayMode, mhchem });
  } catch {
    return null;
  }
}

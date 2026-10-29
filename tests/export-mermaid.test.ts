/**
 * Mermaid 图进 HTML 导出的护栏测试。
 *
 * ## 测的是**产物**，不是调用
 *
 * 断言全部落在最终 HTML 字符串上——
 * 「有没有调 `renderMermaidBlocks`」在源码里长得一模一样，
 * 只有产物能区分「图渲染出来了」与「图还是一坨源码」。
 *
 * ## 不依赖真实 mermaid
 *
 * mermaid 带 5.0 MB 的传递依赖，在 jsdom 里跑也不稳（实测产出空 SVG，
 * 见 `tests/mermaid.test.ts` 的说明）。所以：
 *
 * - 变换类用例一律**注入**渲染函数；
 * - 渲染器（loader）的用例用 `vi.mock("mermaid")` 顶掉真身。
 *
 * 真 mermaid 的端到端用例放在文件末尾，**默认跳过**。
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { findMermaidBlocks, renderMermaidBlocks } from "@/export/mermaid";
import { htmlFromAst } from "@/parser/html";
import { parseMarkdown } from "@/parser/markdown";
import { highlightCodeBlocks } from "@/export/html";
import {
  onDiagramRendered,
  renderDiagramAsync,
  resetDiagramCache,
} from "@/editor/render/mermaid-loader";

/**
 * 假的 mermaid。
 *
 * 记录每次 render 的源码与每次 initialize 的配置，
 * 用来断言「同一段代码只渲染一次」「主题跟着屏幕的明暗模式走」。
 */
const mermaidSpy = vi.hoisted(() => ({
  rendered: [] as string[],
  init: [] as Record<string, unknown>[],
}));

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn((config: Record<string, unknown>) => {
      mermaidSpy.init.push(config);
    }),
    render: async (id: string, text: string) => {
      mermaidSpy.rendered.push(text);
      // 带 BOOM 的一段用来测「渲染失败」
      if (text.includes("BOOM")) throw new Error("mermaid 炸了 <b>boom</b>");
      return { svg: `<svg id="${id}"><text>${text}</text></svg>` };
    },
    parse: async () => ({}),
  },
}));

/** 用**真实**的 remark 链路造一段导出产物 */
function exportBody(markdown: string): string {
  return htmlFromAst(parseMarkdown(markdown, {}), { allowRawHtml: true });
}

/** 一段含 `<` 与 `&` 的 mermaid 源码 */
const MERMAID_MD = [
  "```mermaid",
  "graph TD",
  "  A[<b>x</b>] --> B",
  '  C["q"] & D --> E',
  "```",
].join("\n");

/** 一个文档里两个 mermaid 块 + 一个 js 块 */
const TWO_MD = [
  "```mermaid",
  "graph TD",
  "  A-->B",
  "```",
  "",
  "```js",
  "const a = 1;",
  "```",
  "",
  "```mermaid",
  "graph LR",
  "  C-->D",
  "```",
].join("\n");

describe("findMermaidBlocks", () => {
  it("找到 mermaid 块，源码已解码（`<` 与 `&` 都要还原成原文）", () => {
    const blocks = findMermaidBlocks(exportBody(MERMAID_MD));

    expect(blocks).toHaveLength(1);
    expect(blocks[0].index).toBe(0);
    // 原文里的尖括号与 & 必须还原，不能还留着实体
    expect(blocks[0].code).toContain("A[<b>x</b>] --> B");
    expect(blocks[0].code).toContain('C["q"] & D --> E');
    expect(blocks[0].code).not.toContain("&#x3C;");
    expect(blocks[0].code).not.toContain("&#x26;");
  });

  it("源码里本来就写着 &lt; 这种字面量时，不能被多解一轮", () => {
    // 用户写的是字面的 `&lt;`：解码一次（`&#x26;` → `&`）就该停，
    // 再解一轮就变成 `<` 了——图会画错。
    const html = exportBody(
      ["```mermaid", "graph TD", "  A[&lt;x&gt;] --> B", "```"].join("\n"),
    );
    const blocks = findMermaidBlocks(html);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].code).toContain("A[&lt;x&gt;] --> B");
    expect(blocks[0].code).not.toContain("<x>");
  });

  it("多个 mermaid 块的序号连续", () => {
    const blocks = findMermaidBlocks(exportBody(TWO_MD));

    expect(blocks).toHaveLength(2);
    expect(blocks[0].index).toBe(0);
    expect(blocks[1].index).toBe(1);
    expect(blocks[0].code).toContain("A-->B");
    expect(blocks[1].code).toContain("C-->D");
  });

  it("非 mermaid 的代码块不算（js 块不能被认走）", () => {
    const html = exportBody(["```js", "const a = 1;", "```"].join("\n"));

    expect(findMermaidBlocks(html)).toHaveLength(0);
  });

  it("同一个字符串连着查两次，结果一致（正则的 lastIndex 不能泄漏）", () => {
    const html = exportBody(TWO_MD);

    const first = findMermaidBlocks(html);
    const second = findMermaidBlocks(html);

    expect(second).toHaveLength(2);
    expect(second.map((b) => b.code)).toEqual(first.map((b) => b.code));
  });
});

describe("renderMermaidBlocks", () => {
  it("成功时把代码块换成含 SVG 的 figure", async () => {
    const html = exportBody(MERMAID_MD);

    const out = await renderMermaidBlocks(html, async () => ({
      ok: true,
      output: '<svg id="m"><style>.a{fill:red}</style></svg>',
    }));

    expect(out).toContain('<figure class="inkstone-mermaid">');
    // mermaid 自带的 <style> 要原样内嵌（官方建议内联 SVG）
    expect(out).toContain("<style>.a{fill:red}</style>");
    expect(out).not.toContain('class="language-mermaid"');
  });

  it("渲染器拿到的源码是**解码后**的原文", async () => {
    const seen: string[] = [];
    await renderMermaidBlocks(exportBody(MERMAID_MD), async (code) => {
      seen.push(code);
      return { ok: true, output: "<svg></svg>" };
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("A[<b>x</b>] --> B");
    expect(seen[0]).not.toContain("&#x3C;");
  });

  it("失败时**原代码块原样保留**（坏图退化成源码，不能静默丢内容）", async () => {
    const html = exportBody(MERMAID_MD);

    const out = await renderMermaidBlocks(html, async () => ({
      ok: false,
      output: "语法错误",
    }));

    // 整份产物一个字都没变
    expect(out).toBe(html);
    // 转义后的源码仍在产物里
    expect(out).toContain('class="language-mermaid"');
    expect(out).toContain("graph TD");
    expect(out).not.toContain('<figure class="inkstone-mermaid">');
  });

  it("渲染器返回 null 时也保留原代码块", async () => {
    const html = exportBody(MERMAID_MD);

    const out = await renderMermaidBlocks(html, async () => null);

    expect(out).toBe(html);
  });

  it("渲染器抛异常时保留原代码块，且不影响同一文档里的其它块", async () => {
    const html = exportBody(TWO_MD);

    const out = await renderMermaidBlocks(html, async (code) => {
      if (code.includes("A-->B")) throw new Error("渲染器炸了");
      return { ok: true, output: "<svg id='ok'></svg>" };
    });

    // 第一块退回源码，第二块照样渲染成图
    expect(out).toContain('class="language-mermaid"');
    expect(out).toContain('<figure class="inkstone-mermaid">');
    expect(out).toContain("<svg id='ok'></svg>");
  });

  it("一个文档里多个 mermaid 块都被处理", async () => {
    const html = exportBody(TWO_MD);

    const out = await renderMermaidBlocks(html, async () => ({
      ok: true,
      output: "<svg></svg>",
    }));

    expect(out.match(/<figure class="inkstone-mermaid">/g)).toHaveLength(2);
    expect(out).not.toContain('class="language-mermaid"');
  });

  it("非 mermaid 的代码块原样不动", async () => {
    const html = exportBody(TWO_MD);
    // 精确切出 js 块：不能切到它后面（后面还有第二个 mermaid 块）
    const jsStart = html.indexOf('<pre><code class="language-js">');
    const jsEnd = html.indexOf("</code></pre>", jsStart) + "</code></pre>".length;
    const jsBlock = html.slice(jsStart, jsEnd);

    const out = await renderMermaidBlocks(html, async () => ({
      ok: true,
      output: "<svg></svg>",
    }));

    // js 块一个字节都没变
    expect(out).toContain(jsBlock);
    // 而且只有两个 mermaid 块变成了 figure——js 块没被顺手塞进去
    expect(out.match(/<figure class="inkstone-mermaid">/g)).toHaveLength(2);
  });

  it("没有 mermaid 块时原样返回", async () => {
    const html = exportBody(["```js", "const a = 1;", "```"].join("\n"));

    const out = await renderMermaidBlocks(html, async () => {
      throw new Error("不该被调用");
    });

    expect(out).toBe(html);
  });
});

describe("与真实产出对得上（接缝契约）", () => {
  it("remark 产出的 mermaid 围栏能被认出来", () => {
    const html = exportBody(MERMAID_MD);

    expect(html).toContain('class="language-mermaid"');
    expect(findMermaidBlocks(html)).toHaveLength(1);
  });

  it("代码高亮**不会**抹掉 language-mermaid —— 所以 mermaid 变换可以排在高亮之后", () => {
    // 这是**运行时事实**，不是源码扫描。
    //
    // 早先的契约是反的：高亮不认识 mermaid，会把它改写成
    // `language-plaintext`，于是「mermaid 变换必须排在高亮之前」。
    // 现在 `highlightCodeBlocks` **放过** mermaid 块（见 `src/export/html.ts`），
    // 标记原样保留——变换排在高亮之后也能认出来。
    //
    // 顺带的好处：图渲染失败时退回的那个源码块，**没有被高亮动过**，
    // 用户看到的就是他写的那段源码。
    const html = exportBody(MERMAID_MD);

    expect(highlightCodeBlocks(html)).toContain('class="language-mermaid"');
    // 整块**逐字不变**——不是只保留 class 名。
    const block = /<pre><code class="language-mermaid">[\s\S]*?<\/code><\/pre>/.exec(
      html,
    );
    expect(block).not.toBeNull();
    expect(highlightCodeBlocks(html)).toContain(block![0]);
  });

  it("与高亮那条路解码出的是**同一份源码**（两份 decodeEntities 不能漂移）", () => {
    // `src/export/html.ts` 的 `decodeEntities` 没有导出，
    // 但 `highlightCodeBlocks` 用的是它——而 highlight.js 的输出是**命名实体**，
    // 用 DOM 解一次就回到原文。
    // 于是「高亮产物在浏览器里显示成什么」= html.ts 那份解码的结果，
    // 与我这份一比，两条链路有没有分叉就一目了然了。
    //
    // 这条守的是**屏幕与导出必须一致**：图要按同一份源码画。
    const html = exportBody(MERMAID_MD);
    const mine = findMermaidBlocks(html)[0].code;

    const highlighted = highlightCodeBlocks(html);
    const doc = new DOMParser().parseFromString(highlighted, "text/html");
    const theirs = doc.querySelector("code")?.textContent ?? "";

    expect(theirs).toBe(mine);
  });
});

describe("renderDiagramAsync（用假的 mermaid 驱动）", () => {
  beforeEach(() => {
    resetDiagramCache();
    mermaidSpy.rendered.length = 0;
    mermaidSpy.init.length = 0;
  });

  it("空白源码返回 null", async () => {
    expect(await renderDiagramAsync("   \n  ")).toBeNull();
  });

  it("渲染成功时给出 ok: true 与 SVG", async () => {
    const result = await renderDiagramAsync("graph TD\n  A-->B");

    expect(result?.ok).toBe(true);
    expect(result?.output).toContain("<svg");
    expect(mermaidSpy.rendered).toHaveLength(1);
  });

  it("命中缓存时不再重新渲染", async () => {
    const code = "graph TD\n  A-->B";
    await renderDiagramAsync(code);
    await renderDiagramAsync(code);

    expect(mermaidSpy.rendered).toHaveLength(1);
  });

  it("同一段代码并发调用只渲染一次、只通知一次（复用同一个 promise）", async () => {
    const code = "graph TD\n  A-->B";
    let notified = 0;
    // `onDiagramRendered` 在订阅时若缓存非空会**立即**回调一次——
    // beforeEach 刚清过缓存，所以这里数到的就是渲染完成后的通知。
    const off = onDiagramRendered(() => {
      notified += 1;
    });

    const [first, second] = await Promise.all([
      renderDiagramAsync(code),
      renderDiagramAsync(code),
    ]);
    off();

    expect(mermaidSpy.rendered).toHaveLength(1);
    expect(first?.output).toBe(second?.output);
    // 一次渲染 → 一次通知。
    // 没有「复用同一个 promise」时会有**两次**通知（两次调用各挂各的收尾），
    // 编辑器也会因此多算一轮装饰器。
    expect(notified).toBe(1);
  });

  it("渲染失败**不抛异常**，返回 ok: false 与错误文本", async () => {
    const result = await renderDiagramAsync("graph TD\n  BOOM");

    expect(result).not.toBeNull();
    expect(result?.ok).toBe(false);
    expect(typeof result?.output).toBe("string");
    expect(result?.output.length).toBeGreaterThan(0);
  });

  it("不受防抖计时器影响：立刻就渲染，不等 250 ms", async () => {
    await renderDiagramAsync("graph TD\n  A-->B");

    expect(mermaidSpy.rendered).toHaveLength(1);
  });

  it("主题跟着屏幕的明暗模式走（与编辑器同一套配置）", async () => {
    // 导出出来的图必须和屏幕上那张**配置完全一致**——
    // 主题是 mermaid 的全局配置，跟错了就是两张长得不一样的图。
    document.documentElement.dataset.mode = "dark";
    await renderDiagramAsync("graph TD\n  A-->B");

    expect(mermaidSpy.init).toContainEqual(
      expect.objectContaining({ theme: "dark", securityLevel: "strict" }),
    );
  });

  it("亮色模式用的是 base 主题", async () => {
    document.documentElement.dataset.mode = "light";
    await renderDiagramAsync("graph TD\n  A-->B");

    expect(mermaidSpy.init).toContainEqual(
      expect.objectContaining({ theme: "base", securityLevel: "strict" }),
    );
  });
});

/**
 * 真实 mermaid 的端到端用例（**默认跳过**）。
 *
 * jsdom 里 mermaid 渲染不出真图（实测产出空 SVG），
 * 所以它只能验证「不抛异常、拿到一个结果」，
 * 真正的图由生产构建的浏览器实测守着。
 *
 * 打开方式：
 * `INKSTONE_MERMAID_E2E=1 pnpm exec vitest run tests/export-mermaid.test.ts`
 */
describe.skipIf(process.env.INKSTONE_MERMAID_E2E !== "1")("真实 mermaid（可选）", () => {
  it("渲染出结果且不抛异常", async () => {
    // `doUnmock` 是**不提升**的那个版本（`vi.unmock` 会被提升到文件顶部，
    // 那样整份文件都会失去 mock）。
    vi.doUnmock("mermaid");
    vi.resetModules();
    const loader = await import("@/editor/render/mermaid-loader");
    const result = await loader.renderDiagramAsync("graph TD\n  A-->B");

    expect(result).not.toBeNull();
  });
});

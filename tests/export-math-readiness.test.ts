/**
 * 异步出口**必须等公式渲染器就绪**。
 *
 * ## 背景：公式有两个独立的按需加载物
 *
 * - HTML 处理器（remark-rehype 那条链）——`parser/html-loader.ts`
 * - 公式渲染器（KaTeX，603 KB 的 chunk）——`editor/render/math-loader.ts`
 *
 * HTML 处理器就绪**不代表**公式渲染器就绪。而 `rehypeMath` 拿不到渲染器时
 * **不报错**——它只是把公式留在原始的 `<code class="language-math">` 里。
 *
 * 结果是：屏幕上排好版的公式，导出后变成一串裸 LaTeX。
 * 同一份文档，HTML 导出与 PDF 导出还能给出**两种不同的结果**——
 * 而用户完全看不出来，只会觉得「导出的文件坏了」。
 *
 * ## 这条守卫守的是什么
 *
 * 守卫的不是「有没有调 `ensureMathRenderer`」，
 * 而是**产物里公式到底渲染了没有**——
 * 因为「调用了但没等完」「压根没调」在源码里长得一模一样，
 * 只有产物能区分。
 *
 * ## 为什么每条用例都 `vi.resetModules()`
 *
 * 公式渲染器是**模块级单例**：`math-loader.ts` 里 `renderer` 一旦加载成功
 * 就不会再变。所以只要这个文件里有任何一处先加载了它，
 * 后面的用例就都跑在「渲染器已就绪」的世界里——
 * 把 `await ensureMathRenderer()` 从实现里删掉，这些用例**照样全绿**。
 *
 * `vi.resetModules()` 清掉模块缓存，
 * 重新 `import` 拿到的是一套全新的图：`math-loader` 的 `renderer` 又是 `null`。
 * 这才是「冷启动后立刻导出」的真实情形。
 */

import { describe, expect, it, vi } from "vitest";
import type { ExportContext } from "@/export/service";

/** 导出选项 */
const base = {
  title: "Probe",
  theme: "github",
  mode: "light" as const,
  outline: [],
  includeOutline: false,
};

/** 一个最小可用的导出上下文 */
function context(content: string): ExportContext {
  return {
    content,
    title: "Probe",
    variables: {
      title: "Probe",
      author: "",
      date: "",
      filename: "probe.md",
      path: null,
      words: 0,
      chars: 0,
      now: new Date(),
    },
    definitions: [],
    format: { id: "html", label: "HTML", extension: ".html", kind: "html", description: "", builtin: true },
    fileName: "probe.html",
    overrides: {},
  };
}

describe("异步出口必须等公式渲染器就绪", () => {
  it("打印用的 HTML 里，公式是渲染好的", async () => {
    vi.resetModules();
    const { buildPrintHtml } = await import("@/export/pdf");

    const html = await buildPrintHtml(context("$E = mc^2$"));

    expect(html).toContain("katex");
    // 源码形态的公式不该再出现
    expect(html).not.toContain("math-inline");
    expect(html).not.toContain("math-display");
  });

  it("打印用的 HTML 里，块级公式也是渲染好的", async () => {
    vi.resetModules();
    const { buildPrintHtml } = await import("@/export/pdf");

    const html = await buildPrintHtml(context("$$\n\\int_0^1 x^2 dx\n$$\n"));

    expect(html).toContain("katex");
    expect(html).not.toContain("math-display");
  });

  it("复制为 HTML 时，公式也是渲染好的", async () => {
    vi.resetModules();
    const { ensureMarkdownToHtml } = await import("@/parser/html-loader");

    const html = await ensureMarkdownToHtml("$E = mc^2$");

    expect(html).toContain("katex");
    expect(html).not.toContain("math-inline");
  });

  it("渲染器没就绪时，导出产物会留下痕迹，而不是静默降级", async () => {
    // 这一条是**兜底**：上面三条保证「等到了」，
    // 这一条保证「万一有人新加一条出口忘了等，产物里至少留个记号」。
    //
    // `exportToHtml` 是同步的，没法自己等——
    // 所以它的职责是「如实说明」，而不是「默默降级」。
    vi.resetModules();
    const { exportToHtml } = await import("@/export/html");

    const html = exportToHtml("$E = mc^2$", base);

    // 公式确实没渲染（源码形态）
    expect(html).toContain("math-inline");
    // 但产物里留下了说明
    expect(html).toContain("公式渲染器未就绪");
  });
});

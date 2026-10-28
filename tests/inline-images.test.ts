/**
 * 导出时把图片内联成 data: URI。
 *
 * ## 要守住的破口
 *
 * PDF 导出的打印 HTML 落在系统临时目录（`/tmp/inkstone-print/`）、
 * 用 `file://` 打开、没有 `<base>`——
 * 相对路径的图片在纸上就是**坏图**。
 *
 * 这类破口的特点是「不报错、不崩溃、只是图没了」，
 * 所以守卫必须盯住**产物里那张图到底变成什么了**。
 *
 * ## 判据落在产物上
 *
 * 断言的是「导出的 HTML 里那张图的 src 是什么」，
 * 不是「代码里有没有调 `inlineImages`」——
 * 后者对「调用了但没等完」与「压根没调」长得一模一样。
 */

import { describe, expect, it, vi } from "vitest";
import { inlineImages, type ImageResolver } from "@/export/inline-images";
import { exportToHtml } from "@/export/html";
import { buildPrintHtml } from "@/export/pdf";
import { buildHtmlExport } from "@/export/service";
import type { ExportContext } from "@/export/service";

/** 一个假的解析器：把地址变成 `data:` URI */
function fakeResolver(map: Record<string, string>): ImageResolver {
  return async (_docPath, src) => {
    const hit = map[src];
    if (hit === undefined) throw new Error(`读不到：${src}`);
    return hit;
  };
}

const PNG = "data:image/png;base64,iVBORw0KGgo=";

describe("内联本身", () => {
  it("相对路径被换成 data: URI", async () => {
    const html = await inlineImages('<img src="assets/fig.png" alt="图">', {
      docPath: "/docs/a.md",
      resolve: fakeResolver({ "assets/fig.png": PNG }),
    });
    expect(html).toContain(`src="${PNG}"`);
    expect(html).not.toContain("assets/fig.png");
  });

  it("解析器拿到的是文档路径与原地址", async () => {
    const resolve = vi.fn(async () => PNG);
    await inlineImages('<img src="assets/fig.png">', {
      docPath: "/docs/a.md",
      resolve,
    });
    expect(resolve).toHaveBeenCalledWith("/docs/a.md", "assets/fig.png");
  });

  it("同一张图只解析一次", async () => {
    const resolve = vi.fn(async () => PNG);
    await inlineImages('<img src="a.png"><img src="a.png"><p><img src="a.png"></p>', {
      docPath: "/docs/a.md",
      resolve,
    });
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("读不到就保留原地址（一张图不该毁掉整次导出）", async () => {
    const html = await inlineImages('<img src="missing.png">', {
      docPath: "/docs/a.md",
      resolve: fakeResolver({}),
    });
    expect(html).toContain('src="missing.png"');
  });

  it("一张失败不影响别的图", async () => {
    const html = await inlineImages('<img src="ok.png"><img src="bad.png">', {
      docPath: "/docs/a.md",
      resolve: fakeResolver({ "ok.png": PNG }),
    });
    expect(html).toContain(`src="${PNG}"`);
    expect(html).toContain('src="bad.png"');
  });

  it("已经是 data: 的不重复解析", async () => {
    const resolve = vi.fn(async () => PNG);
    const html = await inlineImages(`<img src="${PNG}">`, {
      docPath: "/docs/a.md",
      resolve,
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(html).toContain(`src="${PNG}"`);
  });

  it("远程地址原样保留（不联网抓图）", async () => {
    const resolve = vi.fn(async () => PNG);
    const html = await inlineImages('<img src="https://example.com/a.png">', {
      docPath: "/docs/a.md",
      resolve,
    });
    expect(html).toContain('src="https://example.com/a.png"');
  });

  it("src 不是第一个属性时也换对了地方", async () => {
    // 用户手写的原始 HTML：alt 在前
    const html = await inlineImages('<img alt="a.png" src="b.png">', {
      docPath: "/docs/a.md",
      resolve: fakeResolver({ "b.png": PNG }),
    });
    expect(html).toContain(`alt="a.png"`); // alt 没被改
    expect(html).toContain(`src="${PNG}"`);
  });

  it("单引号的 src 也认", async () => {
    const html = await inlineImages("<img src='a.png'>", {
      docPath: "/docs/a.md",
      resolve: fakeResolver({ "a.png": PNG }),
    });
    expect(html).toContain(`src='${PNG}'`);
  });

  it("查询串里的 & 被解码后再解析（实体不还原，路径就是错的）", async () => {
    const resolve = vi.fn(async () => PNG);
    await inlineImages('<img src="a.png?x=1&#x26;y=2">', {
      docPath: "/docs/a.md",
      resolve,
    });
    expect(resolve).toHaveBeenCalledWith("/docs/a.md", "a.png?x=1&y=2");
  });

  it("没有图时原样返回", async () => {
    const html = "<p>没有图</p>";
    expect(await inlineImages(html, { docPath: null })).toBe(html);
  });

  it("自检：这组断言真的在做事（别对着空集假绿）", () => {
    // 内联前后的产物必须**不同**——否则上面的断言分辨不出有没有生效
    const before = '<img src="assets/fig.png">';
    expect(before).not.toContain("data:");
  });
});

describe("端到端：真实的导出产物", () => {
  const DOC = [
    "![图](assets/fig.png)",
    "",
    "![带尺寸](assets/sized.png =200x100)",
    "",
    '<img src="assets/raw.png" alt="原始 HTML">',
  ].join("\n");

  it("导出产物里的图被换成 data: URI，尺寸属性还在", async () => {
    const html = exportToHtml(DOC, {
      title: "内联",
      theme: "inkstone-light",
      mode: "light" as const,
      includeOutline: false,
    });
    const inlined = await inlineImages(html, {
      docPath: "/docs/a.md",
      resolve: fakeResolver({
        "assets/fig.png": PNG,
        "assets/sized.png": PNG,
        "assets/raw.png": PNG,
      }),
    });
    expect(inlined).not.toContain('src="assets/');
    expect(inlined).toContain(`src="${PNG}"`);
    // 尺寸没被内联搞坏
    expect(inlined).toContain('width="200"');
    expect(inlined).toContain('height="100"');
  });

  it("代码块里的 <img> 不会被当成图片（它是转义过的）", async () => {
    const doc = ["```html", '<img src="not-an-image.png">', "```"].join("\n");
    const html = exportToHtml(doc, {
      title: "代码块",
      theme: "inkstone-light",
      mode: "light" as const,
      includeOutline: false,
    });
    const resolve = vi.fn(async () => PNG);
    await inlineImages(html, { docPath: "/docs/a.md", resolve });
    expect(resolve).not.toHaveBeenCalled();
  });
});

/** 一个最小可用的导出上下文（带文档路径，图才有相对路径的基准） */
function context(content: string): ExportContext {
  return {
    content,
    title: "内联",
    variables: {
      title: "内联",
      author: "",
      date: "",
      filename: "probe.md",
      path: "/docs/probe.md",
      words: 0,
      chars: 0,
      now: new Date(),
    },
    definitions: [],
    format: {
      id: "html",
      label: "HTML",
      extension: ".html",
      kind: "html",
      description: "",
      builtin: true,
    },
    fileName: "probe.html",
    overrides: {},
    hasBodyContent: true,
  };
}

describe("两条导出链路：产物里真的有内联后的图", () => {
  const DOC = "![图](assets/fig.png)\n\n正文";

  it("PDF 打印用的 HTML 里，图是 data: URI", async () => {
    const html = await buildPrintHtml(context(DOC), {
      resolveImage: fakeResolver({ "assets/fig.png": PNG }),
    });
    expect(html).toContain(`src="${PNG}"`);
    expect(html).not.toContain('src="assets/fig.png"');
  });

  it("HTML 导出的内容里，图是 data: URI", async () => {
    const html = await buildHtmlExport(context(DOC), {
      resolveImage: fakeResolver({ "assets/fig.png": PNG }),
    });
    expect(html).toContain(`src="${PNG}"`);
    expect(html).not.toContain('src="assets/fig.png"');
  });

  it("解析器拿到的是文档所在目录（相对路径的基准）", async () => {
    const resolve = vi.fn(async () => PNG);
    await buildPrintHtml(context(DOC), { resolveImage: resolve });
    expect(resolve).toHaveBeenCalledWith("/docs/probe.md", "assets/fig.png");
  });

  it("自检：这两条链路确实产出了不同的东西（别对着空集假绿）", async () => {
    const inlined = await buildPrintHtml(context(DOC), {
      resolveImage: fakeResolver({ "assets/fig.png": PNG }),
    });
    const notInlined = await buildPrintHtml(context(DOC), {
      resolveImage: fakeResolver({}),
    });
    expect(inlined).toContain("data:image/png");
    expect(notInlined).toContain('src="assets/fig.png"');
  });
});

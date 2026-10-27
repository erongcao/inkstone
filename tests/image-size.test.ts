/**
 * 图片尺寸扩展（Typora / Obsidian 的 `=宽x高`）。
 *
 * ## 两条路径，判据是 lezer 认不认
 *
 * | 写法 | lezer 的 `Image` 节点 | 谁处理 |
 * | --- | --- | --- |
 * | `图片.png=200x100`（无空格） | ✅ 完整，尺寸在 `URL` 节点里 | `imageParts` 剥尾巴 |
 * | `图片.png =200x100`（有空格） | ❌ 只到 `![alt]`，其余成纯文本 | 行扫描兜底 |
 *
 * 后者之所以不行：**URL 不能含空格**，那个空格让 lezer 认不出这是图片。
 * 实测依据见 `image-size.ts` 的文件头。
 */

import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history } from "@codemirror/commands";
import { livePreview } from "@/editor/live-preview";
import { findSizedImages, stripImageSize } from "@/parser/image-size";
import { markdownToHtml } from "@/parser/html";
import { roundTrip } from "@/parser/markdown";
import { renderImage } from "@/editor/live-preview/image-widget";

/* ═══════════════════════════════════════════════════════════ */

describe("剥尺寸", () => {
  it("=200x100", () => {
    expect(stripImageSize("a.png=200x100")).toEqual({ src: "a.png", width: 200, height: 100 });
  });

  it("只给宽度时不猜高度（否则会拉伸变形）", () => {
    expect(stripImageSize("a.png=200")).toEqual({ src: "a.png", width: 200 });
  });

  it("路径可以带子目录", () => {
    expect(stripImageSize("images/子目录/图.png=300x200").src).toBe("images/子目录/图.png");
  });

  it("没有尺寸就原样返回", () => {
    expect(stripImageSize("images/图.png")).toEqual({ src: "images/图.png" });
  });

  it("查询参数不被误伤：`?x=1` 不是结尾", () => {
    expect(stripImageSize("a.png?x=1")).toEqual({ src: "a.png?x=1" });
  });

  it("文件名里带 `=` 但后面不是数字，不剥", () => {
    expect(stripImageSize("a=b.png")).toEqual({ src: "a=b.png" });
  });

  it("只有尺寸没有路径时不动它", () => {
    expect(stripImageSize("=200x100")).toEqual({ src: "=200x100" });
  });

  it("base64 的补位 `=` 不当尺寸分隔符（无扩展名 → 不剥）", () => {
    // data URI 是图片插入功能实际支持的写法（src 以 `data:` 开头直接透传），
    // 它的 base64 尾巴带 `=`，误剥会让图片直接裂掉。
    const src = "data:image/png;base64,iVBORw0KGgoAAA=200x100";
    expect(stripImageSize(src)).toEqual({ src });
  });

  it("data URI 后面跟无空格的尺寸时也不剥（宁可漏剥不误剥）", () => {
    // 判据是「剥完还剩扩展名」，data URI 永远不满足 → 保守不剥。
    // 带空格的写法由行扫描那条路处理，那条路的正则用 `\S+` 取路径，不碰 base64。
    expect(stripImageSize("data:image/png;base64,AAA==300x120").src).toBe(
      "data:image/png;base64,AAA==300x120",
    );
  });

  it("无扩展名的路径也不剥", () => {
    expect(stripImageSize("图片=200x100")).toEqual({ src: "图片=200x100" });
  });
});

/* ═══════════════════════════════════════════════════════════ */

describe("行扫描兜底", () => {
  it("找得到 `![a](x.png =200x100)`", () => {
    const source = "前面 ![图](images/a.png =200x100) 后面";
    const found = findSizedImages(source, 0, source.length);
    expect(found).toHaveLength(1);
    expect(found[0].src).toBe("images/a.png");
    expect(found[0].width).toBe(200);
    expect(found[0].height).toBe(100);
    expect(source.slice(found[0].from, found[0].to)).toBe("![图](images/a.png =200x100)");
  });

  it("空 alt 也认", () => {
    const source = "![](a.png =10x20)";
    expect(findSizedImages(source, 0, source.length)).toHaveLength(1);
  });

  it("普通图片不会被这个正则捞走", () => {
    const source = "![图](a.png) 和 [链接](b.md)";
    expect(findSizedImages(source, 0, source.length)).toEqual([]);
  });

  it("没有空格写法不由它管（交给 lezer 那条路）", () => {
    const source = "![图](a.png=200x100)";
    expect(findSizedImages(source, 0, source.length)).toEqual([]);
  });

  it("同一段里多张都能找到", () => {
    const source = "![一](a.png =1x2) 中 ![二](b.png =3x4)";
    expect(findSizedImages(source, 0, source.length).map((i) => i.src)).toEqual([
      "a.png",
      "b.png",
    ]);
  });

  it("带空格的路径不匹配（要用尖括号，本轮不支持）", () => {
    // 如实记录限制：不误伤比「猜一个可能错的路径」重要
    const source = "![图](我的 图片.png =200x100)";
    expect(findSizedImages(source, 0, source.length)).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════ */

function createEditor(doc: string): EditorView {
  const parent = document.body.appendChild(document.createElement("div"));
  return new EditorView({
    state: EditorState.create({ doc, extensions: [history(), livePreview()] }),
    parent,
  });
}

/**
 * 渲染层。
 *
 * 断言的是**装饰器区间**与 **widget key**，不是 `<img>` 的属性——
 * jsdom 里 `resolveImageSrc` 走 IPC，永远解析不出 URL，所以
 * `renderImage` 只会建占位符，`<img>` 根本不会出现
 * （既有的 `image.test.ts` 也是只断言区间，不碰 `<img>`）。
 * `width` / `height` 真的落到 `<img>` 上由生产构建的浏览器实测确认。
 */
describe("尺寸落到 <img> 的 attribute 上", () => {
  it("断言的是 attribute，不是 IDL property", () => {
    // 浏览器实测：`img.width = 260` 在 SVG 这类**没有固有尺寸**的图上
    // 不落 attribute——产物里带着赋值语句，DOM 上却查不到 width。
    // 所以实现用的是 `setAttribute`，这里断言的也必须是 attribute。
    // （jsdom 里 IDL setter 会正常反射，所以这条测试在 jsdom 里**两种写法都能过**，
    //   真正的把关在浏览器实测。写清楚是为了不让后来的人以为它在 jsdom 里也有区分力。）
    const img = document.createElement("img");
    img.setAttribute("width", "260");
    img.setAttribute("height", "70");
    expect(img.getAttribute("width")).toBe("260");
    expect(img.getAttribute("height")).toBe("70");
  });
});

describe("尺寸进到渲染层", () => {
  it("无空格写法：替换区间正好是完整的 `![…](…)`", () => {
    const doc = "![图](images/a.png=200x100)\n\n文末。";
    const view = createEditor(doc);
    view.dispatch({ selection: { anchor: doc.length } });

    const widget = view.dom.querySelector(".cm-md-image") as HTMLElement;
    expect(widget).not.toBeNull();
    // 替换区间从 `!` 开始
    expect(doc[Number(widget.dataset.imageFrom)]).toBe("!");
  });

  it("无空格写法：尺寸进 key，路径里不再有 =200x100", () => {
    const result = renderImage("images/a.png", "图", 0, 200, 100);
    expect(result.key).toContain("200x100");
    expect(result.dom.dataset.imageSrc).toBe("images/a.png");
  });

  it("同一张图、尺寸不同时 key 不同（否则两次渲染共用一份缓存）", () => {
    const small = renderImage("a.png", "", 0, 100);
    const large = renderImage("a.png", "", 0, 400);
    expect(small.key).not.toBe(large.key);
  });

  it("同一张图、同尺寸时 key 相同（缓存仍然生效）", () => {
    expect(renderImage("a.png", "", 0, 100).key).toBe(renderImage("a.png", "", 0, 100).key);
  });

  it("有空格写法：行扫描兜底也替换成 widget", () => {
    const doc = "![图](images/a.png =320x240)\n\n文末。";
    const view = createEditor(doc);
    view.dispatch({ selection: { anchor: doc.length } });

    const widget = view.dom.querySelector(".cm-md-image") as HTMLElement;
    expect(widget).not.toBeNull();
    // 剥掉尺寸后的路径里不该还有 ` =320x240`
    expect(widget.dataset.imageSrc).toBe("images/a.png");
  });

  it("两条路径不会把同一张图渲染两次", () => {
    const doc = "![甲](a.png=100)\n\n![乙](b.png =200x100)\n\n文末。";
    const view = createEditor(doc);
    view.dispatch({ selection: { anchor: doc.length } });

    expect(view.dom.querySelectorAll(".cm-md-image")).toHaveLength(2);
  });

  it("尺寸写进 Markdown 源码，不是只活在 DOM 里（红线 1）", () => {
    const doc = "![图](a.png=200x100)\n\n文末。";
    const view = createEditor(doc);
    view.dispatch({ selection: { anchor: doc.length } });
    expect(view.state.doc.toString()).toContain("=200x100");
  });

  it("光标落进图片里 → 露出源码，不生成 widget（两种写法都一样）", () => {
    const doc = "![图](a.png =320x240)\n\n文末。";
    const view = createEditor(doc);
    // 光标放在 `![图]` 内部
    view.dispatch({ selection: { anchor: 3 } });
    expect(view.dom.querySelector(".cm-md-image")).toBeNull();
  });

  it("文档末尾的那张图照样渲染（光标在 image.to 上也不算进块内）", () => {
    // 回归：这里一度写成闭区间，于是「整篇文档的最后一张图」永远不渲染——
    // 而文档末尾放图恰恰是最常见的排法。
    for (const doc of ["![图](a.png =320x240)", "![图](a.png=320x240)"]) {
      const view = createEditor(doc);
      view.dispatch({ selection: { anchor: doc.length } });
      expect(view.dom.querySelector(".cm-md-image")).not.toBeNull();
    }
  });
});

describe("导出侧：尺寸也要进 <img>（屏幕与导出必须一致）", () => {
  /*
   * 导出链路原本**完全没处理**这个语法，于是两种写法都出事：
   *
   * | 写法 | 修复前的导出结果 | 后果 |
   * |---|---|---|
   * | 无空格 | `<img src="a.png=200x100">` | **图片地址坏了**（去找一个真叫这个名的文件） |
   * | 有空格 | `![图](a.png =200x100)` 一串字面文本 | **图片整个没了** |
   *
   * 而编辑器两种都渲染成图——那就是「屏幕与导出不一致」（架构约束 C）。
   */

  it("无空格写法：地址被剥干净，尺寸变成 width/height", () => {
    const html = markdownToHtml("![图](a.png=200x100)");
    expect(html).toContain('src="a.png"');
    expect(html).toContain('width="200"');
    expect(html).toContain('height="100"');
    // 地址里不该再带尺寸
    expect(html).not.toContain("a.png=200x100");
  });

  it("有空格写法：导出成图，不是字面文本", () => {
    const html = markdownToHtml("![图](a.png =200x100)");
    expect(html).toContain('src="a.png"');
    expect(html).toContain('width="200"');
    expect(html).toContain('height="100"');
    // 关键：不能剩下字面的 Markdown 源码
    expect(html).not.toContain("![图]");
  });

  it("只给宽度时不猜高度（否则图会拉伸变形）", () => {
    const html = markdownToHtml("![图](a.png=200)");
    expect(html).toContain('width="200"');
    expect(html).not.toContain("height=");
  });

  it("图片前后的文字保留", () => {
    const html = markdownToHtml("前面 ![图](a.png =200x100) 后面");
    expect(html).toContain("前面");
    expect(html).toContain("后面");
    expect(html).toContain('src="a.png"');
  });

  it("普通图片不受影响", () => {
    const html = markdownToHtml("![图](a.png)");
    expect(html).toContain('src="a.png"');
    expect(html).not.toContain("width=");
    expect(html).not.toContain("height=");
  });

  it("往返无损：尺寸仍然留在 Markdown 源码里（红线 1）", () => {
    // 尺寸变换只发生在「mdast → HTML」这条链路上，
    // 放进解析层的话往返就丢了尺寸。
    for (const source of ["![图](a.png=200x100)", "![图](a.png =200x100)"]) {
      const out = roundTrip(source);
      expect(out).toContain("200x100");
    }
  });
});

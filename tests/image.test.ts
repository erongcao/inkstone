/**
 * 图片的护栏测试。
 *
 * 重点在三件事：
 *   1. **识别**——`![alt](url)` / `![alt][ref]` 的拆解，以及引用式图片的定义查找
 *   2. **展开规则**——和别的结构一致：光标进入就露出源码
 *   3. **数据通道**——base64 编解码、HTML 里 data URL 的提取、文件名判定
 *
 * 落盘逻辑（去重、不覆盖、路径穿越防护、相对路径换算）在 Rust 侧
 * `src-tauri/src/asset.rs` 的单元测试里，两边都要跑。
 */

import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { parseSyntax } from "@/editor/live-preview/syntax";
import { buildLivePreviewDecorations } from "@/editor/live-preview/decorations";
import { ImageWidget, renderImage } from "@/editor/live-preview/image-widget";
import {
  arrayBufferToBase64,
  dataUrlToBase64,
  extractDataImageUrl,
  isImageFileName,
  resolveImageSrc,
  saveImage,
} from "@/ipc/image";
import { dropHasImage, looksLikeImage, pasteHasImage } from "@/editor/image-insert";
import { handlePaste } from "@/editor/paste";
import type { Range } from "@codemirror/view";

interface Deco {
  from: number;
  to: number;
  widget?: unknown;
  cls?: string;
}

/** 把装饰器集合摊平（`RangeSet.iter()` 返回的游标要手动 next） */
function collect(
  source: string,
  cursor: number,
  mode: "live" | "dimmed" = "live",
): Deco[] {
  const set = buildLivePreviewDecorations(source, cursor, mode, parseSyntax(source), {});
  const out: Deco[] = [];
  const it = set.iter();
  while (it.value !== null) {
    const spec = it.value.spec as { widget?: unknown; class?: string };
    out.push({ from: it.from, to: it.to, widget: spec.widget, cls: spec.class });
    it.next();
  }
  return out;
}

function images(
  source: string,
  cursor: number,
  mode: "live" | "dimmed" = "live",
): Deco[] {
  return collect(source, cursor, mode).filter((d) => d.widget instanceof ImageWidget);
}

describe("图片装饰", () => {
  // 注意：目标里不能有**裸空格**（CommonMark 会在这里截断 URL），
  // 带空格的路径要写成 <assets/图 1.png> 或 percent-encode
  const doc = "看图 ![替代文本](assets/图片1.png) 结束。\n";

  it("光标不在图片里 → 换成 <img> widget", () => {
    expect(images(doc, 0)).toHaveLength(1);
  });

  it("替换区间正好是 `![…](…)`", () => {
    const [deco] = images(doc, 0);
    expect(doc.slice(deco.from, deco.to)).toBe("![替代文本](assets/图片1.png)");
  });

  it("光标落进图片里 → 露出源码，不生成 widget", () => {
    const at = doc.indexOf("[替代文本]");
    expect(images(doc, at + 2)).toHaveLength(0);
  });

  it("空替代文本也照常渲染", () => {
    const bare = "![](assets/x.png)\n";
    expect(images(bare, 0)).toHaveLength(1);
  });

  it("带标题的写法也能拆出来", () => {
    const titled = '![alt](a.png "标题")\n';
    expect(images(titled, 0)).toHaveLength(1);
  });

  it("dimmed 策略下不渲染成图片，只弱化地址", () => {
    const decos = collect(doc, 0, "dimmed");
    expect(decos.some((d) => d.widget instanceof ImageWidget)).toBe(false);
    expect(decos.some((d) => d.cls === "cm-md-image-alt")).toBe(true);
  });

  it("引用式图片能通过文档里的定义解析出地址", () => {
    const doc2 = "![alt][pic]\n\n[pic]: assets/real.png\n";
    expect(images(doc2, 0)).toHaveLength(1);
  });

  it("引用式图片的标签大小写不敏感", () => {
    const doc2 = "![alt][PIC]\n\n[pic]: assets/real.png\n";
    expect(images(doc2, 0)).toHaveLength(1);
  });

  it("引用定义不存在 → 保持源码可见，不瞎渲染", () => {
    const doc2 = "![alt][missing]\n";
    expect(images(doc2, 0)).toHaveLength(0);
  });

  it("一行里的多张图片各自渲染", () => {
    const many = "![a](1.png) 中 ![b](2.png) 尾\n";
    expect(images(many, 0)).toHaveLength(2);
  });
});

describe("图片的 hover 提示", () => {
  it("挂上原始地址——图加载后 Markdown 里那个路径就看不见了", () => {
    // CSS 是 `content: attr(data-image-src)`，属性缺失 = 提示静默不出现
    const dom = renderImage("images/截图 1.png", "描述", 42).dom;
    expect(dom.dataset.imageSrc).toBe("images/截图 1.png");
    expect(dom.dataset.imageFrom).toBe("42");
  });

  it("没有 alt 时不挂 image-alt（避免出现空的提示）", () => {
    const dom = renderImage("a.png", "", 0).dom;
    expect(dom.dataset.imageSrc).toBe("a.png");
    expect(dom.dataset.imageAlt).toBeUndefined();
  });
});

describe("图片数据通道", () => {
  it("base64 编解码能还原字节", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 65, 66]);
    const base64 = arrayBufferToBase64(bytes.buffer);
    expect(atob(base64).length).toBe(bytes.length);
    expect(dataUrlToBase64(`data:image/png;base64,${base64}`)).toBe(base64);
  });

  it("大块数据分片后不爆栈（单块 32 KB）", () => {
    const big = new Uint8Array(200_000).fill(7);
    expect(arrayBufferToBase64(big.buffer).length).toBeGreaterThan(200_000);
  });

  it("从 HTML 里抠出 data 图片", () => {
    const html = '<p><img src="data:image/png;base64,iVBORw0KGgo=" width="10"></p>';
    const found = extractDataImageUrl(html);
    expect(found?.ext).toBe("png");
    expect(found?.url.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("jpeg 归一成 jpg 扩展名", () => {
    const html = '<img src="data:image/jpeg;base64,/9j/">';
    expect(extractDataImageUrl(html)?.ext).toBe("jpg");
  });

  it("没有图片的 HTML 返回 null", () => {
    expect(extractDataImageUrl("<p>hello</p>")).toBeNull();
    expect(extractDataImageUrl('<img src="https://example.com/a.png">')).toBeNull();
  });

  it("文件名识别", () => {
    expect(isImageFileName("a.PNG")).toBe(true);
    expect(isImageFileName("dir/图 1.jpeg")).toBe(true);
    expect(isImageFileName("note.md")).toBe(false);
    expect(isImageFileName("noext")).toBe(false);
  });

  it("拖放判定同时看文件名与 MIME", () => {
    const withName = new File(["x"], "a.png", { type: "" });
    const withType = new File(["x"], "blob", { type: "image/webp" });
    const notImage = new File(["x"], "note.md", { type: "text/markdown" });
    expect(looksLikeImage(withName)).toBe(true);
    expect(looksLikeImage(withType)).toBe(true);
    expect(looksLikeImage(notImage)).toBe(false);
  });

  it("http(s) 与 data URL 直接透传，不绕磁盘", async () => {
    await expect(resolveImageSrc(null, "https://example.com/a.png")).resolves.toBe(
      "https://example.com/a.png",
    );
    await expect(resolveImageSrc(null, "data:image/png;base64,AA==")).resolves.toBe(
      "data:image/png;base64,AA==",
    );
  });

  it("浏览器降级模式下如实报错，不假装成功", async () => {
    // 浏览器里没有文件系统：插一句指向不存在文件的 Markdown 会污染文档（红线 1）
    await expect(saveImage(null, "a.png", new ArrayBuffer(4))).rejects.toThrow();
    await expect(resolveImageSrc(null, "assets/a.png")).rejects.toThrow();
  });
});

describe("图片地址的边界写法", () => {
  it("尖括号形式（路径带空格）能拆出地址", () => {
    const doc = "![a](<assets/图 1.png>)\n";
    const decos = images(doc, 0);
    expect(decos).toHaveLength(1);
    expect(doc.slice(decos[0].from, decos[0].to)).toBe("![a](<assets/图 1.png>)");
  });

  it("裸空格的目标不成立（lezer 不给 URL）→ 保持源码可见", () => {
    // CommonMark：目标里有裸空格就截断，此时 `![a](b c.png)` 只是一段文字
    const doc = "![a](assets/图 1.png)\n";
    expect(images(doc, 0)).toHaveLength(0);
  });
});

describe("图片粘贴与拖放的分流", () => {
  /** 造一个只有 clipboardData 的假剪贴板 */
  function fakeClipboard(
    clipboard: Record<string, string>,
    files?: File[],
  ): ClipboardEvent {
    return {
      clipboardData: {
        getData: (type: string) => clipboard[type] ?? "",
        files: files
          ? Object.assign([...files], { item: () => null, length: files.length })
          : [],
      },
    } as unknown as ClipboardEvent;
  }

  it("剪贴板里有图片文件时，图片优先于富文本转换", () => {
    const view = new EditorView({
      state: EditorState.create({ doc: "", extensions: [] }),
      parent: document.body.appendChild(document.createElement("div")),
    });
    try {
      const file = new File(["x"], "shot.png", { type: "image/png" });
      const handled = handlePaste(
        view,
        fakeClipboard({ "text/html": "<p>网页文字</p>", "text/plain": "网页文字" }, [
          file,
        ]),
      );
      // 图片路径走了异步落盘：同步返回 true（阻止默认粘贴），文档暂不变
      expect(handled).toBe(true);
      expect(view.state.doc.toString()).toBe("");
    } finally {
      view.destroy();
    }
  });

  it("没有图片时，粘贴仍走原来的富文本转换", () => {
    const view = new EditorView({
      state: EditorState.create({ doc: "", extensions: [] }),
      parent: document.body.appendChild(document.createElement("div")),
    });
    try {
      const handled = handlePaste(
        view,
        fakeClipboard({ "text/html": "<p>粗体</p>", "text/plain": "粗体" }),
      );
      expect(handled).toBe(true);
      expect(view.state.doc.toString()).toBe("粗体");
    } finally {
      view.destroy();
    }
  });

  it("HTML 里的 data 图片也算图片", () => {
    const data = fakeClipboard({
      "text/html": '<img src="data:image/png;base64,AA==">',
      "text/plain": "",
    });
    const url = extractDataImageUrl(
      (data.clipboardData as unknown as { getData(t: string): string }).getData(
        "text/html",
      ),
    );
    expect(pasteHasImage(null, url?.url ?? null)).toBe(true);
  });

  it("拖放判定只看有没有图片文件", () => {
    expect(dropHasImage(null)).toBe(false);
    const withImage = {
      files: [new File(["x"], "a.png", { type: "" })],
    } as unknown as DataTransfer;
    expect(dropHasImage(withImage)).toBe(true);
    const withText = {
      files: [new File(["x"], "a.md", { type: "" })],
    } as unknown as DataTransfer;
    expect(dropHasImage(withText)).toBe(false);
  });
});

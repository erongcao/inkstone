/**
 * 打印前的**就绪门**：页面报「我准备好了」，Rust 那头才调 `print()`。
 *
 * ## 这条守卫守的是什么
 *
 * 原来 Rust 那头是「等 load 完 → `sleep(300ms)` → 打印」。
 * 那个 300ms 是个**猜测**：睡够了没有，取决于机器快慢、网络图大小、
 * 字体是否命中——每次都不一样。
 *
 * 实测别人做同类工具时的教训很直接：连续 6 次 dump，页数依次是
 * 2/0/1/0/3/1——**靠固定时长猜「内容稳了」，两头都会错**，
 * 最后产出半截文件。
 *
 * 现在的做法：页面里挂一段脚本，等字体加载完、每张图**解码**完
 * （不只是下载完），在 `<html>` 上放 `data-print-ready="1"`；
 * Rust 那头读到了才打印。
 *
 * ## 判据落在运行时事实上
 *
 * 这一份**在 jsdom 里真跑那段脚本**，看它到底什么时候报就绪——
 * 而不是扫源码里有没有写某个分支。
 * （`load` 事件只保证图**下载**完；解码是另一回事，
 * 没解码完就打印，纸上是一个空白框。）
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { printReadyScript } from "@/export/pdf";

/** 把所有待处理的微任务跑完（宏任务边界） */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** 就绪标记 */
const MARK = "data-print-ready";

/** 在 jsdom 里跑就绪脚本 */
function runScript(timeoutMs = 15000): void {
  // 脚本是生产代码里的同一份字符串——
  // 这里跑的是**真函数**，不是它的副本。
  new Function(printReadyScript(timeoutMs))();
}

/** 造一张「解码要等一会儿」的图 */
function makeImage(opts: {
  complete?: boolean;
  decode?: () => Promise<void>;
}): HTMLImageElement {
  const img = document.createElement("img");
  Object.defineProperty(img, "complete", {
    value: opts.complete ?? true,
    configurable: true,
  });
  if (opts.decode) {
    (img as unknown as { decode: () => Promise<void> }).decode = opts.decode;
  }
  document.body.appendChild(img);
  return img;
}

/** 装一个可手动 resolve 的 document.fonts */
function stubFonts(): { resolve: () => void } {
  let resolve!: () => void;
  const ready = new Promise<void>((r) => {
    resolve = r;
  });
  Object.defineProperty(document, "fonts", {
    value: { ready },
    configurable: true,
  });
  return { resolve };
}

beforeEach(() => {
  document.documentElement.removeAttribute(MARK);
  document.body.innerHTML = "";
  Reflect.deleteProperty(document, "fonts");
});

afterEach(() => {
  Reflect.deleteProperty(document, "fonts");
});

describe("就绪门：什么时候才报就绪", () => {
  it("脚本一进去就写「我在跑」的标记", async () => {
    // 两个标记缺一不可：
    //   - `data-print-gate`   —— 脚本在跑（只是还没好）
    //   - `data-print-ready` —— 内容就绪
    //
    // Rust 那头看到 gate 在而 ready 不在，知道「还在等」；
    // 两个都没有 → 脚本压根没跑起来 → 别等了（否则每次导出白等 20 秒）。
    const fonts = stubFonts();
    makeImage({
      decode: () => new Promise<void>(() => {}),
    });

    runScript();
    await flush();

    expect(document.documentElement.getAttribute("data-print-gate")).toBe("1");
    expect(document.documentElement.getAttribute(MARK)).toBeNull();

    fonts.resolve();
  });

  it("字体没加载完、图片没解码完 → 不报就绪", async () => {
    const fonts = stubFonts();
    let decodeDone!: () => void;
    makeImage({
      decode: () =>
        new Promise<void>((resolve) => {
          decodeDone = resolve;
        }),
    });

    runScript();
    await flush();

    expect(document.documentElement.getAttribute(MARK)).toBeNull();

    // 字体好了，图还没解码 → 还是不该报
    fonts.resolve();
    await flush();
    expect(document.documentElement.getAttribute(MARK)).toBeNull();

    // 图也解码完了 → 报就绪
    decodeDone();
    await flush();
    expect(document.documentElement.getAttribute(MARK)).toBe("1");
  });

  it("坏图（解码失败）不该把导出卡住", async () => {
    // 一张加载不出来的图是常事（链接失效、网络不通）。
    // 它会让 PDF 里少一张图，但**不该让整个导出永远等下去**。
    stubFonts().resolve();
    makeImage({
      decode: () => Promise.reject(new Error("decode failed")),
    });

    runScript();
    await flush();

    expect(document.documentElement.getAttribute(MARK)).toBe("1");
  });

  it("图还没加载完时，会等 load 事件再解码", async () => {
    // `complete` 为 false 表示图还在路上——
    // 脚本要等 load 事件，不能直接当它好了。
    const fonts = stubFonts();
    fonts.resolve();
    let decodeCalled = false;
    const img = makeImage({
      complete: false,
      decode: () => {
        decodeCalled = true;
        return Promise.resolve();
      },
    });

    runScript();
    await flush();
    expect(document.documentElement.getAttribute(MARK)).toBeNull();
    expect(decodeCalled).toBe(false);

    // 图加载完了 → 解码 → 报就绪
    img.dispatchEvent(new Event("load"));
    await flush();
    expect(decodeCalled).toBe(true);
    expect(document.documentElement.getAttribute(MARK)).toBe("1");
  });

  it("永远不就绪时有兜底时限", async () => {
    // 兜底时限是「一张永远加载不出来的图不该把整个导出卡死」的保证。
    // 这里用很小的时限，免得测试真的等 15 秒。
    stubFonts();
    makeImage({
      decode: () => new Promise<void>(() => {}),
    });

    runScript(20);
    await new Promise((resolve) => setTimeout(resolve, 60));
    await flush();

    expect(document.documentElement.getAttribute(MARK)).toBe("1");
  });

  it("没有图片也没有字体时立刻报就绪", async () => {
    // 最常见的情况：纯文字文档，不该有任何等待。
    runScript();
    await flush();
    expect(document.documentElement.getAttribute(MARK)).toBe("1");
  });
});

describe("就绪门：挂进打印用的 HTML", () => {
  it("打印 HTML 末尾带着就绪脚本", async () => {
    vi.resetModules();
    const { buildPrintHtml } = await import("@/export/pdf");
    const { findExportFormat } = await import("@/export/registry");

    const context = {
      content: "# 标题\n",
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
      format: findExportFormat("pdf")!,
      fileName: "probe.pdf",
      overrides: {},
      hasBodyContent: true,
      unusedFootnotes: [],
    };

    const html = await buildPrintHtml(context);

    // 脚本必须在 </body> **之前**——
    // 它要遍历 document.images，图片还没进 DOM 就遍历不到
    const scriptAt = html.indexOf("data-print-ready");
    const bodyAt = html.indexOf("</body>");
    expect(scriptAt).toBeGreaterThan(-1);
    expect(bodyAt).toBeGreaterThan(-1);
    expect(scriptAt, "就绪脚本要在 </body> 之前").toBeLessThan(bodyAt);
  });

  it("脚本里的标记与 Rust 那头探测的一致", async () => {
    // 两边各写一个字符串，改了一边就永远读不到——
    // 这个不一致在真机上表现为「永远等不到就绪，超时后照样打印」。
    const script = printReadyScript();
    expect(script).toContain(MARK);
    expect(script).toContain("data-print-gate");
    expect(script).toContain('setAttribute(MARK, "1")');
  });
});

/**
 * PDF 导出：走 WebView 打印路径。
 *
 * ## 为什么不是 pandoc → LaTeX → PDF
 *
 * 那条路需要本机装 LaTeX（几百 MB）或 wkhtmltopdf。实测本机**都没有**：
 *   - `xelatex` / `pdflatex`：无
 *   - `wkhtmltopdf`：无
 *   - `weasyprint` / `typst` / `libreoffice`：无
 *
 * 而且即使能跑通，LaTeX 那条路的排版质量取决于用户装的模板与字体，
 * 和编辑器里看到的不是一回事。
 *
 * ## 实际做法
 *
 * Tauri 2 的 `Webview::print()` 在 macOS 上会调起**系统打印面板**
 * （WKWebView 的 `printOperation:`），面板里有「存储为 PDF」。
 * 于是：
 *
 *   1. 生成一份**打印专用**的 HTML（含 `@page` 纸张设置）
 *   2. 弹「另存为」拿到目标路径
 *   3. 打开一个**临时 WebView 窗口**加载那份 HTML
 *   4. 对它调 `print()` → 用户在系统面板里选「存储为 PDF」并指定位置
 *
 * 第 4 步弹的是系统面板，用户自己选保存位置——所以第 2 步的「另存为」
 * 其实只是个**建议路径**（我们会把它作为默认文件名）。
 *
 * ## 为什么打印专用 HTML 要单独一份
 *
 * 屏幕上用的排版（`--ink-content-width: 46rem` 的居中窄栏）不适合打印：
 * 打印要占满纸张宽度。所以打印版要重设宽度、字号、边距，
 * 并加上 `@page { size: A4 }` 这样的纸张指令。
 *
 * @page 的 size 直接由设置里的 `pdfPaperSize` 决定——
 * 纸张尺寸是**用户选的**，不能猜。
 */

import { exportToHtml, typographyFromAppearance } from "./html";
import type { ExportContext } from "./service";
import type { ExportResult } from "./service";
import { readSettings } from "@/settings/store";
import { isBrowserFallback } from "@/ipc/export";
import { t } from "@/i18n";
import { currentColorMode } from "@/theme/themes";
import { ensureMathRenderer } from "@/editor/render/math-loader";

/**
 * 打印前的**就绪门**：页面自己报「我准备好了」，Rust 那头才调 `print()`。
 *
 * ## 为什么要有这个
 *
 * 原来 Rust 那头是「等页面 load 完 → `sleep(300ms)` → 打印」。
 * 那个 300ms 是个**猜测**：睡够了没有，机器快一点慢一点、网络图大一点小一点，
 * 结果都不一样。实测别人做同类工具时的教训很直接：
 * 连续 6 次 dump，页数依次是 2/0/1/0/3/1——
 * **靠固定时长猜「内容稳了」，两头都会错**，最后产出半截文件。
 *
 * ## 这个脚本等什么
 *
 * 1. `document.fonts.ready` —— 字体加载完。
 *    内置主题只用系统字体栈，这一项通常是立刻就绪的；
 *    但用户的「附加样式」里可能有 `@font-face`，那就要等。
 * 2. 每张图的 `decode()` —— **解码**完（不只是下载完）。
 *    `load` 事件只保证图**下载**完了；解码是另一回事，
 *    没解码完就打印，纸上是一个空白框。
 *
 * ## 两个保险
 *
 * - **页内兜底**：超过 `timeoutMs` 还没好也放行——
 *   一张永远加载不出来的图不该把整个导出卡死。
 *   这个值必须**小于** Rust 那头的 20 秒上限（那边是外层兜底）。
 * - **超时**：Rust 那头也有自己的时限，超时后照样打印（少张图好过没文件）。
 *
 * ## 报信的方式
 *
 * 在 `<html>` 上放两个标记：
 *
 *   - `data-print-gate="1"` —— **脚本自己开张了**（一进去就写）
 *   - `data-print-ready="1"` —— **内容就绪了**（等完字体与图才写）
 *
 * 两个标记缺一不可：Rust 那头看到 `gate` 在而 `ready` 不在，
 * 知道「还在等」；看到 `gate` 都不在，知道**脚本压根没跑起来**
 * （被 CSP 挡了？抛异常了？）——那就别等了，直接打印。
 * 否则每导一次 PDF 都要白等 20 秒，比原来的 300ms 还糟。
 *
 * Rust 那头用 `eval_with_callback` 读这两个标记——
 * Tauri 2 的 `eval` 没有返回值，带回调的 `eval_with_callback` 才有。
 *
 * @param timeoutMs 页内兜底时限（毫秒）。测试用小的值，免得等 15 秒。
 */
export function printReadyScript(timeoutMs = 15000): string {
  return `(function () {
  var GATE = "data-print-gate";
  var MARK = "data-print-ready";
  // 先开张：让 Rust 那头知道「脚本在跑，只是还没好」
  document.documentElement.setAttribute(GATE, "1");
  function mark() {
    document.documentElement.setAttribute(MARK, "1");
  }
  function finish() {
    clearTimeout(timer);
    mark();
  }
  // 兜底：一张永远加载不出来的图不该把整个导出卡死
  var timer = setTimeout(finish, ${timeoutMs});

  function waitImage(img) {
    return new Promise(function (resolve) {
      function decoded() {
        if (!img.decode) { resolve(); return; }
        // 坏图的 decode() 会 reject——那不是我们要等的东西，放行
        img.decode().then(resolve, resolve);
      }
      if (img.complete) { decoded(); return; }
      img.addEventListener("load", decoded, { once: true });
      img.addEventListener("error", resolve, { once: true });
    });
  }

  var waits = [];
  if (document.fonts && document.fonts.ready) waits.push(document.fonts.ready);
  var imgs = Array.prototype.slice.call(document.images || []);
  if (imgs.length) waits.push(Promise.all(imgs.map(waitImage)));

  Promise.all(waits).then(finish, finish);
})();`;
}

/**
 * 生成打印用的 HTML。
 *
 * 在导出的 HTML 基础上追加一段打印样式：占满纸张宽度、去掉大纲、
 * 加上 `@page` 的纸张与页边距。
 *
 * 末尾再挂上**就绪门**脚本——Rust 那头等它报「好了」才打印。
 *
 * ## 为什么是 async
 *
 * 因为它得**先等公式渲染器就绪**。
 *
 * `rehypeMath` 拿不到渲染器时不会报错，只是把公式留在原始的
 * `<code class="language-math">` 里——于是打印出来的 PDF 上，
 * 公式变成了一串裸 LaTeX，而同一份文档导出的 HTML 里是排好版的公式。
 * **同一份文档、两种导出格式、两种结果**，而且没有任何提示。
 *
 * HTML 导出那条链路已经在 `service.ts` 里等过了；
 * 这里必须自己等——打印 HTML 是另一条独立的产出路径，
 * 不能指望调用方记得替它做这件事。
 */
export async function buildPrintHtml(context: ExportContext): Promise<string> {
  const settings = readSettings();

  // 先等渲染器：KaTeX 是按需加载的 603 KB chunk，
  // 冷启动后立刻导出的话，它多半还没到。
  await ensureMathRenderer();

  // 打印 / 分页设置（纸张与边距由设置决定，纸张尺寸不能猜）。
  //
  // front matter 的覆盖项优先于设置面板里的值——
  // `readExportOverrides` 读了却不用，那个覆盖项就是**读到了却不生效**
  // （比没读更让人困惑）。
  const printOptions = {
    paperSize: context.overrides.pdfPaperSize ?? settings.export.pdfPaperSize,
    margin: context.overrides.pdfMargin ?? settings.export.pdfMargin,
    chapterBreak: context.overrides.pdfChapterBreak ?? settings.export.pdfChapterBreak,
    includeOutline:
      context.overrides.pdfIncludeOutline ?? settings.export.pdfIncludeOutline,
  };

  const html = exportToHtml(context.content, {
    title: context.title,
    theme: settings.appearance.theme,
    mode: currentColorMode(),
    // 纸上要不要目录，由设置决定（目录里的链接在 PDF 里仍然能点）
    includeOutline: printOptions.includeOutline,
    // 自定义 CSS 也要进导出——编辑器里有、导出里没有就是「屏幕与导出不一致」
    customCss: settings.appearance.customCss,
    // 排版同样要跟屏幕一致（字号 / 行高 / 写作区宽度 / 字体 / 页面背景）
    typography: typographyFromAppearance(settings.appearance),
    words: context.variables.words,
    chars: context.variables.chars,
    // 打印样式由 `export/html.ts` 注入（与 HTML 导出**同一份**实现，
    // 见 `src/export/print-css.ts` 的文件头）
    print: printOptions,
  });

  // 就绪门脚本插进 </body> 之前（**在所有图片之后**——
  // 脚本要遍历 document.images，图片还没进 DOM 就遍历不到）。
  return html.replace("</body>", `<script>\n${printReadyScript()}\n</script>\n</body>`);
}

/**
 * 执行 PDF 导出。
 *
 * @param path 建议的输出路径（用户最终在系统面板里选位置）
 */
export async function printToPdf(
  context: ExportContext,
  path: string,
): Promise<ExportResult> {
  // 浏览器里没有 WebView 打印面板，如实报错
  // 静默失败会让用户以为 PDF 导出了，打开一看什么都没有
  if (isBrowserFallback()) {
    const message = t("浏览器降级模式无法导出 PDF，请在桌面应用里导出");
    return { ok: false, path: null, message, error: message };
  }

  const html = await buildPrintHtml(context);

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("print_document", { html, suggestedPath: path });
    return {
      ok: true,
      path,
      message: t("已打开打印面板，请选择「存储为 PDF」"),
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      path: null,
      message: t("PDF 导出失败：{error}", { error: message }),
      error: message,
    };
  }
}

/**
 * Inkstone 的 Markdown 开关 → pandoc 输入格式串。
 *
 * ## 这条守卫守的是什么
 *
 * pandoc 那条导出链路（DOCX / ODT / EPUB / RTF / LaTeX… 共 21 种）以前
 * 用一条**写死**的输入格式：
 *
 * ```
 * --from=markdown+tex_math_dollars+yaml_metadata_block
 * ```
 *
 * 完全不理用户在设置面板里关掉的开关。于是「关掉表格」的用户，
 * 屏幕上表格变成了字面文本，导出的 Word 里却**还是一张表**。
 *
 * 更糟的是那条写死的格式里**没有 `mark`**——
 * pandoc 的 `==高亮==` 语法叫 `mark` 扩展且**默认关着**，
 * 而 Inkstone 的高亮是默认开着的。
 * 于是用户在编辑器里看到的黄色高亮，导出到 Word 里变成了一对字面的 `==`。
 *
 * ## 两层守卫
 *
 * 1. **映射函数**（纯函数，永远跑）：每个开关对不对得上 pandoc 的扩展。
 * 2. **真 pandoc**（装了才跑）：拿真的 pandoc 跑一遍，看结果对不对。
 *
 * 第 2 层是关键——映射表是**抄**的，抄错了只有真跑一遍才知道。
 * 没装 pandoc 时跳过并说明，不假装测过。
 */

import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { pandocInputFormat } from "@/export/pandoc-format";
import { DEFAULT_FEATURES, type MarkdownFeatures } from "@/parser/features";

/** 捕获真正交给 pandoc 的输入格式串 */
const captured = vi.hoisted(() => ({ from: undefined as string | undefined }));

/** 改几个开关 */
function features(overrides: Partial<MarkdownFeatures>): MarkdownFeatures {
  return { ...DEFAULT_FEATURES, ...overrides };
}

/** 本机有没有 pandoc */
function pandocAvailable(): boolean {
  try {
    execFileSync("pandoc", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const HAS_PANDOC = pandocAvailable();

/** 用真 pandoc 把一段 Markdown 转成 HTML */
function pandocToHtml(source: string, format: string): string {
  return execFileSync("pandoc", ["-f", format, "-t", "html"], {
    input: source,
    encoding: "utf8",
  });
}

describe("pandoc 输入格式：映射", () => {
  it("默认设置下带上了 +mark（==高亮== 是 Inkstone 默认开着的）", () => {
    const format = pandocInputFormat(DEFAULT_FEATURES);

    expect(format).toContain("+mark");
  });

  it("默认设置下高亮开关是唯一要显式打开的扩展", () => {
    // 默认设置里，除 `mark` 之外的扩展要么是 pandoc 默认开着的，
    // 要么 Inkstone 也不支持（simple_tables 之类）。
    expect(pandocInputFormat(DEFAULT_FEATURES)).toBe(
      "markdown-grid_tables-multiline_tables-simple_tables+mark",
    );
  });

  it("关掉表格 → pandoc 的表格语法全关", () => {
    const format = pandocInputFormat(features({ tables: false }));

    expect(format).toContain("-pipe_tables");
    expect(format).toContain("-grid_tables");
    expect(format).toContain("-multiline_tables");
    expect(format).toContain("-simple_tables");
  });

  it("关掉任务列表 / 脚注 / 上下标 → 对应扩展关掉", () => {
    expect(pandocInputFormat(features({ taskLists: false }))).toContain("-task_lists");
    expect(pandocInputFormat(features({ footnotes: false }))).toContain("-footnotes");
    expect(pandocInputFormat(features({ subscriptSuperscript: false }))).toContain(
      "-subscript",
    );
    expect(pandocInputFormat(features({ subscriptSuperscript: false }))).toContain(
      "-superscript",
    );
  });

  it("关掉 front matter → yaml_metadata_block 关掉", () => {
    expect(pandocInputFormat(features({ frontMatter: false }))).toContain(
      "-yaml_metadata_block",
    );
    expect(pandocInputFormat(features({ frontMatter: true }))).not.toContain(
      "-yaml_metadata_block",
    );
  });

  it("公式开关只全关时才关掉 pandoc 的美元符号数学", () => {
    // pandoc 只有一个 tex_math_dollars 管全部美元符号公式，
    // Inkstone 有三个更细的开关——粒度不够，只能这么对齐（见 pandoc-format.ts 的说明）
    expect(
      pandocInputFormat(features({ inlineMath: false, blockMath: false })),
    ).toContain("-tex_math_dollars");
    expect(
      pandocInputFormat(features({ inlineMath: false, blockMath: true })),
    ).not.toContain("-tex_math_dollars");
  });

  it("关掉高亮 → 不带 +mark", () => {
    expect(pandocInputFormat(features({ highlight: false }))).not.toContain("+mark");
  });
});

describe.skipIf(!HAS_PANDOC)("pandoc 输入格式：真 pandoc 实测", () => {
  it("默认设置下 ==高亮== 渲染成 <mark>，不是字面文本", () => {
    const html = pandocToHtml(
      "普通 ==高亮== 文字。",
      pandocInputFormat(DEFAULT_FEATURES),
    );

    expect(html).toContain("<mark>高亮</mark>");
    expect(html).not.toContain("==高亮==");
  });

  it("关掉表格 → 表格变成字面文本（与编辑器一致）", () => {
    const source = "| a | b |\n| --- | --- |\n| 1 | 2 |\n";

    const on = pandocToHtml(source, pandocInputFormat(DEFAULT_FEATURES));
    expect(on).toContain("<table>");

    const off = pandocToHtml(source, pandocInputFormat(features({ tables: false })));
    expect(off).not.toContain("<table>");
    // 竖线还在，只是不再被当成表格
    expect(off).toContain("a | b |");
  });

  it("关掉任务列表 → 复选框不再被解析", () => {
    const source = "- [x] 任务\n";

    const on = pandocToHtml(source, pandocInputFormat(DEFAULT_FEATURES));
    expect(on).toContain("checkbox");

    const off = pandocToHtml(source, pandocInputFormat(features({ taskLists: false })));
    expect(off).not.toContain("checkbox");
    expect(off).toContain("[x]");
  });

  it("关掉公式 → 美元符号不再是公式", () => {
    const source = "行内 $E=mc^2$ 公式。\n";

    const on = pandocToHtml(source, pandocInputFormat(DEFAULT_FEATURES));
    // pandoc 的 HTML 写手把行内公式写成 `<span class="math inline">`
    expect(on).toContain('class="math inline"');

    const off = pandocToHtml(
      source,
      pandocInputFormat(features({ inlineMath: false, blockMath: false })),
    );
    expect(off).not.toContain('class="math inline"');
    expect(off).toContain("$E=mc^2$");
  });

  it("关掉脚注 → 脚注不再是脚注", () => {
    const source = "引用[^1]。\n\n[^1]: 内容\n";

    const on = pandocToHtml(source, pandocInputFormat(DEFAULT_FEATURES));
    expect(on).toContain("footnote");

    const off = pandocToHtml(source, pandocInputFormat(features({ footnotes: false })));
    expect(off).not.toContain("footnote");
  });

  it("关掉上下标 → ~x~ 不再是下标", () => {
    const source = "下标 ~x~。\n";

    const on = pandocToHtml(source, pandocInputFormat(DEFAULT_FEATURES));
    expect(on).toContain("<sub>");

    const off = pandocToHtml(
      source,
      pandocInputFormat(features({ subscriptSuperscript: false })),
    );
    expect(off).not.toContain("<sub>");
  });
});

describe("pandoc 输入格式：走完整导出链路", () => {
  it("导出到 Word 时，把算出来的格式串交给 pandoc", async () => {
    // 走完整条链路：设置 → exportDocument → convertWithPandoc
    // 只测映射函数是不够的——中间任何一环没把参数传下去，单测都照样绿。
    vi.doMock("@/ipc/export", async () => ({
      isBrowserFallback: () => false,
      detectPandoc: async () => ({
        available: true,
        version: "3.8",
        path: "/usr/bin/pandoc",
      }),
      pickExportPath: async () => "/tmp/out.docx",
      writeTextFile: async () => {},
      convertWithPandoc: async (
        _format: string,
        _source: string,
        _outputPath: string,
        _resourceDir: string,
        from?: string,
      ) => {
        captured.from = from;
        return { warnings: [] };
      },
    }));

    const { exportDocument } = await import("@/export/service");
    const { resetSettings, updateSettings } = await import("@/settings/store");
    const { setDocumentContent, resetTabs } = await import("@/ipc/document");

    resetSettings();
    resetTabs();
    updateSettings({ markdown: { highlight: true, tables: false } });
    setDocumentContent("# 标题\n");

    const result = await exportDocument("docx");

    expect(result.ok).toBe(true);
    expect(captured.from).toContain("+mark");
    expect(captured.from).toContain("-pipe_tables");

    vi.doUnmock("@/ipc/export");
  });
});

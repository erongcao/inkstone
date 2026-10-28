/**
 * 导出服务：文件名计算与标题推导。
 *
 * 这一层是「给定一份文档 + 一份设置，算出该导出什么、叫什么名字」——
 * 不弹对话框也不写盘，所以能纯函数式地测。
 */

import { describe, expect, it, beforeEach } from "vitest";
import { parseMarkdown } from "@/parser/markdown";
import {
  deriveTitle,
  exportDocument,
  prepareExport,
  sanitizeFileName,
} from "@/export/service";
import { findExportFormat, suggestFileName } from "@/export/registry";
import { isBrowserFallback } from "@/ipc/export";
import { updateSettings, resetSettings } from "@/settings/store";
import { setDocumentContent, resetTabs } from "@/ipc/document";

/** HTML 导出格式 */
const htmlFormat = findExportFormat("html")!;
const docxFormat = findExportFormat("docx")!;

beforeEach(() => {
  resetSettings();
  resetTabs();
});

describe("导出项注册表", () => {
  it("每种格式都有 id、标签与扩展名", () => {
    for (const format of [
      htmlFormat,
      docxFormat,
      findExportFormat("pdf")!,
      findExportFormat("epub")!,
    ]) {
      expect(format.id).toBeTruthy();
      expect(format.label).toBeTruthy();
      expect(format.extension).toMatch(/^\.[a-z0-9]+$/i);
    }
  });

  it("pandoc 格式都带 pandocFormat", () => {
    for (const id of ["docx", "odt", "epub", "rtf", "latex", "mediawiki", "rst"]) {
      const format = findExportFormat(id)!;
      expect(format.kind).toBe("pandoc");
      expect(format.pandocFormat).toBeTruthy();
    }
  });

  it("HTML 与 PDF 不走 pandoc", () => {
    expect(findExportFormat("html")!.kind).toBe("html");
    expect(findExportFormat("pdf")!.kind).toBe("pdf");
  });

  it("建议文件名去掉路径部分", () => {
    // 拿路径当文件名会存到奇怪的地方
    expect(suggestFileName("a/b/c", ".html")).toBe("c.html");
  });

  it("建议文件名清掉非法字符", () => {
    expect(suggestFileName("a:b*c?", ".html")).toBe("a_b_c_.html");
  });

  it("空标题退回未命名", () => {
    expect(suggestFileName("", ".html")).toBe("未命名.html");
  });
});

describe("标题推导", () => {
  it("front matter 的 title 优先", () => {
    const tree = parseMarkdown("---\ntitle: 元数据标题\n---\n\n# 正文标题");
    expect(
      deriveTitle(
        tree.children.length ? { title: "元数据标题" } : {},
        "# 正文标题",
        null,
      ),
    ).toBe("元数据标题");
  });

  it("没有 front matter 时用第一个一级标题", () => {
    expect(deriveTitle({}, "# 正文标题\n\n## 次级", null)).toBe("正文标题");
  });

  it("一级标题找不到时用文件名", () => {
    expect(deriveTitle({}, "## 只有二级标题", "/a/b/笔记.md")).toBe("笔记");
  });

  it("都没有时是未命名", () => {
    expect(deriveTitle({}, "正文", null)).toBe("未命名");
  });
});

describe("文件名清理", () => {
  it("去掉路径分隔符", () => {
    // 模板里写路径会让人困惑（存到哪？），而且可能写到意外位置
    expect(sanitizeFileName("a/b/c")).toBe("c");
    expect(sanitizeFileName("a\\b\\c")).toBe("c");
  });

  it("去掉非法字符", () => {
    expect(sanitizeFileName('a<b>c:d"e|f?g*h')).toBe("a_b_c_d_e_f_g_h");
  });

  it("去掉控制字符", () => {
    expect(sanitizeFileName("a\0b\x1fc")).toBe("abc");
  });

  it("去掉前导的点", () => {
    // ".hidden" 是隐藏文件，不该由导出产生
    expect(sanitizeFileName(".hidden")).toBe("hidden");
  });

  it("全清完时退回未命名", () => {
    expect(sanitizeFileName("...")).toBe("未命名");
  });
});

describe("导出上下文", () => {
  it("默认用文档标题当文件名", () => {
    const context = prepareExport(htmlFormat, "# 我的文档\n\n正文", null);
    expect(context.fileName).toBe("我的文档.html");
  });

  it("文件名模板里的变量被替换", () => {
    updateSettings({ export: { fileNameTemplate: "${title}-${today}" } });
    const context = prepareExport(htmlFormat, "# 我的文档", null);
    expect(context.fileName).toMatch(/^我的文档-\d{4}-\d{2}-\d{2}\.html$/);
  });

  it("模板里的未定义变量原样保留", () => {
    updateSettings({ export: { fileNameTemplate: "${typo}" } });
    const context = prepareExport(htmlFormat, "# 文档", null);
    expect(context.fileName).toBe("${typo}.html");
  });

  it("模板不能产生路径", () => {
    updateSettings({ export: { fileNameTemplate: "dir/${title}" } });
    const context = prepareExport(htmlFormat, "# 文档", null);
    expect(context.fileName).toBe("文档.html");
  });

  it("front matter 默认不覆盖导出设置", () => {
    // 安全默认：关着的时候 front matter 不能改任何东西
    updateSettings({ export: { readExportSettingsFromFrontMatter: false } });
    const context = prepareExport(
      htmlFormat,
      "---\nexport:\n  html:\n    includeOutline: false\n---\n\n# 文档",
      null,
    );
    expect(context.overrides).toEqual({});
    expect(context.overrides.htmlIncludeOutline).toBeUndefined();
  });

  it("开启后 front matter 能覆盖导出设置", () => {
    updateSettings({ export: { readExportSettingsFromFrontMatter: true } });
    const context = prepareExport(
      htmlFormat,
      "---\nexport:\n  html:\n    includeOutline: false\n---\n\n# 文档",
      null,
    );
    expect(context.overrides.htmlIncludeOutline).toBe(false);
  });

  it("开启后 front matter 能覆盖文件名模板", () => {
    updateSettings({ export: { readExportSettingsFromFrontMatter: true } });
    const context = prepareExport(
      htmlFormat,
      "---\nfileNameTemplate: 定制名\n---\n\n# 文档",
      null,
    );
    expect(context.fileName).toBe("定制名.html");
  });

  it("front matter 的变量能用", () => {
    updateSettings({ export: { readExportSettingsFromFrontMatter: true } });
    const context = prepareExport(
      htmlFormat,
      "---\nvariables:\n  项目: Inkstone\n---\n\n# 文档",
      null,
    );
    const name = context.definitions.find((v) => v.name === "项目");
    expect(name?.value).toBe("Inkstone");
  });

  it("词数统计不为零", () => {
    const context = prepareExport(htmlFormat, "这是一段有若干字的中文正文。", null);
    expect(context.variables.words).toBeGreaterThan(0);
  });

  it("文件路径进变量上下文", () => {
    const context = prepareExport(htmlFormat, "# 文档", "/Users/me/笔记/文档.md");
    expect(context.variables.path).toBe("/Users/me/笔记/文档.md");
    expect(context.variables.filename).toBe("文档.md");
  });

  it("设置里配的自定义变量会进文件名模板", () => {
    // 设置面板「自定义导出变量」配出来的变量，要能真的落到文件名上。
    // 这条链是「UI 写入 settings → prepareExport 读取 → applyVariables 替换」，
    // 中间任何一环漏掉，用户看到的文件名就是模板原文。
    updateSettings({
      export: {
        variables: [{ name: "版本", source: "custom", value: "v1.0" }],
        fileNameTemplate: "验收-${版本}",
      },
    });
    const context = prepareExport(htmlFormat, "# 文档", null);
    expect(context.fileName).toBe("验收-v1.0.html");
  });

  it("模板里未定义的变量原样保留", () => {
    // 静默清空比留原文更坏：用户会以为拼错的名字是「没有值」，
    // 而不是「拼错了」。原样保留才能让用户看出自己拼错了。
    updateSettings({ export: { fileNameTemplate: "${没定义过}" } });
    const context = prepareExport(htmlFormat, "# 文档", null);
    expect(context.fileName).toContain("${没定义过}");
  });
});

describe("导出不修改文档内容", () => {
  it("prepareExport 前后内容一致", () => {
    const content = "---\ntitle: X\n---\n\n# 标题\n\n正文 ${title}";
    setDocumentContent(content);
    const context = prepareExport(htmlFormat, content, null);
    // 导出绝不能把变量替换写回源文件（红线 1）
    expect(context.content).toBe(content);
    expect(context.content).toContain("${title}");
  });
});

describe("浏览器降级模式", () => {
  it("被识别为降级模式", () => {
    // 测试环境没有 __TAURI_INTERNALS__
    expect(isBrowserFallback()).toBe(true);
  });

  it("HTML 导出会产出内容而不是「已取消」", async () => {
    setDocumentContent("# 浏览器降级文档\n\n正文");
    const result = await exportDocument("html");
    // 早先的 bug：降级模式下 pickExportPath 返回 null，
    // 上层把它当成「用户取消」——用户点了导出却什么都没发生，
    // 而且提示还在撒谎说「已取消导出」
    expect(result.ok).toBe(true);
    expect(result.message).not.toContain("取消");
    expect(result.path).toContain(".html");
  });

  it("PDF 导出在降级模式下如实报错", async () => {
    const result = await exportDocument("pdf");
    // 浏览器里没有打印面板。静默失败比报错更糟
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.message).toContain("PDF");
  });

  it("pandoc 导出在降级模式下如实报错", async () => {
    const result = await exportDocument("docx");
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("未知格式报错而不是静默成功", async () => {
    const result = await exportDocument("不存在的格式");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("未知");
  });
});

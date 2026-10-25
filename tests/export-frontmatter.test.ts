/**
 * YAML front matter 的读取与导出设置覆盖。
 *
 * 重点是**安全边界**：front matter 是用户写的文件内容，属于外部输入。
 * 它能影响什么、不能影响什么，必须钉死。
 */

import { describe, expect, it } from "vitest";
import { parseMarkdown } from "@/parser/markdown";
import {
  EMPTY_FRONT_MATTER,
  extractFrontMatterRaw,
  readExportOverrides,
  readFrontMatter,
  stringField,
} from "@/export/frontmatter";

describe("读取 front matter", () => {
  it("没有 front matter 时返回空", () => {
    const fm = readFrontMatter(parseMarkdown("# 标题\n\n正文"));
    expect(fm.present).toBe(false);
    expect(fm.fields).toEqual({});
    expect(fm.error).toBeNull();
  });

  it("解析出键值对", () => {
    const fm = readFrontMatter(
      parseMarkdown("---\ntitle: 我的标题\nauthor: 张三\n---\n\n# 正文"),
    );
    expect(fm.present).toBe(true);
    expect(fm.fields.title).toBe("我的标题");
    expect(fm.fields.author).toBe("张三");
  });

  it("支持嵌套结构", () => {
    const fm = readFrontMatter(
      parseMarkdown("---\nexport:\n  html:\n    includeOutline: false\n---\n\n# 正文"),
    );
    expect(fm.error).toBeNull();
    const exportNode = fm.fields.export as Record<string, unknown>;
    const html = exportNode.html as Record<string, unknown>;
    expect(html.includeOutline).toBe(false);
  });

  it("YAML 语法错误如实报错而不是静默忽略", () => {
    const fm = readFrontMatter(parseMarkdown("---\ntitle: [未闭合\n---\n\n# 正文"));
    // 静默忽略会让用户以为 front matter 没生效，
    // 却查不出是哪个字段写错了
    expect(fm.present).toBe(true);
    expect(fm.error).toBeTruthy();
  });

  it("front matter 不是映射时报错", () => {
    const fm = readFrontMatter(parseMarkdown("---\n- 一\n- 二\n---\n\n# 正文"));
    expect(fm.error).toBeTruthy();
  });

  it("空 front matter 不报错", () => {
    const fm = readFrontMatter(parseMarkdown("---\n---\n\n# 正文"));
    expect(fm.present).toBe(true);
    expect(fm.error).toBeNull();
    expect(fm.fields).toEqual({});
  });

  it("取出原始文本", () => {
    const tree = parseMarkdown("---\ntitle: X\n---\n\n# 正文");
    expect(extractFrontMatterRaw(tree)).toContain("title: X");
  });

  it("没有 front matter 时原始文本是 null", () => {
    expect(extractFrontMatterRaw(parseMarkdown("# 正文"))).toBeNull();
  });
});

describe("字段读取", () => {
  it("只接受字符串", () => {
    // `author: 2024` 到底是年份还是作者名，写的人自己清楚；
    // 替他猜就可能猜错
    expect(stringField({ author: "张三" }, "author")).toBe("张三");
    expect(stringField({ author: 2024 }, "author")).toBeNull();
    expect(stringField({ author: true }, "author")).toBeNull();
  });

  it("字段不存在时是 null", () => {
    expect(stringField({}, "author")).toBeNull();
  });
});

describe("导出设置覆盖", () => {
  it("读出 html.includeOutline", () => {
    const o = readExportOverrides({ export: { html: { includeOutline: false } } });
    expect(o.htmlIncludeOutline).toBe(false);
  });

  it("读出 pdf.paperSize", () => {
    const o = readExportOverrides({ export: { pdf: { paperSize: "A5" } } });
    expect(o.pdfPaperSize).toBe("A5");
  });

  it("读出 fileNameTemplate", () => {
    const o = readExportOverrides({ fileNameTemplate: "${title}-导出" });
    expect(o.fileNameTemplate).toBe("${title}-导出");
  });

  it("读出自定义变量", () => {
    const o = readExportOverrides({ variables: { 项目: "Inkstone" } });
    expect(o.variables).toEqual({ 项目: "Inkstone" });
  });

  it("非法纸张尺寸被忽略而不是报错", () => {
    // 用户不该因为 front matter 里一个笔误就导不出东西
    const o = readExportOverrides({ export: { pdf: { paperSize: "A3" } } });
    expect(o.pdfPaperSize).toBeUndefined();
  });

  it("类型不对的字段被忽略", () => {
    const o = readExportOverrides({
      export: { html: { includeOutline: "yes" }, pdf: { paperSize: 5 } },
    });
    expect(o.htmlIncludeOutline).toBeUndefined();
    expect(o.pdfPaperSize).toBeUndefined();
  });

  it("未知的顶层键被忽略", () => {
    // front matter 常常还塞着别的工具的配置（Obsidian 的 tags、Hugo 的 draft）
    const o = readExportOverrides({ tags: ["a"], draft: true, alias: "x" });
    expect(o).toEqual({});
  });

  it("不能覆盖「导出后自动打开」这类行为", () => {
    // 安全边界：front matter 只能影响「产出什么」，不能影响「产出之后做什么」
    const o = readExportOverrides({
      export: {
        openFileAfterExport: true,
        openFolderAfterExport: true,
      },
    });
    expect(o).toEqual({});
  });

  it("变量值不是字符串时被忽略", () => {
    const o = readExportOverrides({ variables: { a: "x", b: 42 } });
    expect(o.variables).toEqual({ a: "x" });
  });

  it("没有 export 字段时返回空覆盖", () => {
    expect(readExportOverrides({ title: "X" })).toEqual({});
  });
});

describe("空 front matter 常量", () => {
  it("是未找到的状态", () => {
    expect(EMPTY_FRONT_MATTER.present).toBe(false);
    expect(EMPTY_FRONT_MATTER.fields).toEqual({});
  });
});

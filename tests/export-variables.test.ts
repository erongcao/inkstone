/**
 * 导出变量系统。
 *
 * 这些用例钉住三件事：
 *   1. 变量**只**在导出产物上替换，绝不碰文档正文
 *   2. 未定义的变量原样保留（不静默清空）
 *   3. 日期用**本地时区**，不是 UTC
 */

import { describe, expect, it } from "vitest";
import {
  applyVariables,
  basenameOf,
  collectVariableUsage,
  dirnameOf,
  formatDate,
  formatDateTime,
  resolveVariable,
  type ExportVariable,
  type VariableContext,
} from "@/export/variables";

/** 造一个上下文 */
function ctx(overrides: Partial<VariableContext> = {}): VariableContext {
  return {
    title: "测试标题",
    author: "张三",
    date: "2026-10-25",
    filename: "笔记.md",
    path: "/Users/me/笔记/笔记.md",
    words: 123,
    chars: 456,
    now: new Date(2026, 9, 25, 14, 30, 0),
    ...overrides,
  };
}

describe("变量求值", () => {
  it("内置变量取对应的值", () => {
    expect(resolveVariable({ name: "title", source: "title" }, ctx())).toBe("测试标题");
    expect(resolveVariable({ name: "author", source: "author" }, ctx())).toBe("张三");
    expect(resolveVariable({ name: "words", source: "words" }, ctx())).toBe("123");
    expect(resolveVariable({ name: "chars", source: "chars" }, ctx())).toBe("456");
  });

  it("文件名变量区分带扩展名与不带", () => {
    expect(resolveVariable({ name: "f", source: "filename" }, ctx())).toBe("笔记.md");
    expect(resolveVariable({ name: "f", source: "filenameNoExt" }, ctx())).toBe("笔记");
  });

  it("路径变量给出目录", () => {
    expect(resolveVariable({ name: "p", source: "path" }, ctx())).toBe(
      "/Users/me/笔记/笔记.md",
    );
    expect(resolveVariable({ name: "d", source: "directory" }, ctx())).toBe(
      "/Users/me/笔记",
    );
  });

  it("未命名文档的路径变量是空串而不是 null", () => {
    const c = ctx({ path: null, filename: "" });
    // 空串而不是 "null" 或 "undefined"——
    // 拼进文件名时那两个字会变成文件名的实际内容
    expect(resolveVariable({ name: "p", source: "path" }, c)).toBe("");
    expect(resolveVariable({ name: "d", source: "directory" }, c)).toBe("");
  });

  it("自定义变量返回用户写的文本", () => {
    expect(
      resolveVariable({ name: "x", source: "custom", value: "固定文本" }, ctx()),
    ).toBe("固定文本");
  });

  it("自定义变量没有值时是空串", () => {
    expect(resolveVariable({ name: "x", source: "custom" }, ctx())).toBe("");
  });
});

describe("日期用本地时区而不是 UTC", () => {
  it("本地时间 20 点仍是同一天", () => {
    // 2026-10-25 20:00 本地时间。
    // 用 toISOString() 会变成 10-26（UTC+8 时差）——
    // 那会让「今天」在晚上变成明天，差一整天。
    const evening = new Date(2026, 9, 25, 20, 0, 0);
    expect(formatDate(evening)).toBe("2026-10-25");
  });

  it("本地时间 0 点仍是当天的开始", () => {
    const midnight = new Date(2026, 9, 25, 0, 30, 0);
    expect(formatDate(midnight)).toBe("2026-10-25");
  });

  it("月与日都补零", () => {
    expect(formatDate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("日期时间带小时与分钟", () => {
    expect(formatDateTime(new Date(2026, 9, 25, 9, 5))).toBe("2026-10-25 09:05");
  });
});

describe("变量替换", () => {
  it("替换已定义的变量", () => {
    const vars: ExportVariable[] = [{ name: "title", source: "title" }];
    expect(applyVariables("标题是 ${title}", vars, ctx())).toBe("标题是 测试标题");
  });

  it("未定义的变量原样保留", () => {
    const vars: ExportVariable[] = [{ name: "title", source: "title" }];
    // 静默清空会让用户以为变量生效了（标题变空）却查不出哪里错
    expect(applyVariables("${typo} 和 ${title}", vars, ctx())).toBe(
      "${typo} 和 测试标题",
    );
  });

  it("没有 ${} 的字符串原样返回", () => {
    expect(applyVariables("没有变量", [], ctx())).toBe("没有变量");
  });

  it("替换结果里的 ${ 不会被二次解释", () => {
    const vars: ExportVariable[] = [{ name: "x", source: "custom", value: "${title}" }];
    // 自定义文本里写 ${title} 不会被展开——否则会无限递归
    expect(applyVariables("${x}", vars, ctx())).toBe("${title}");
  });

  it("同名变量后者优先", () => {
    const vars: ExportVariable[] = [
      { name: "x", source: "custom", value: "先" },
      { name: "x", source: "custom", value: "后" },
    ];
    expect(applyVariables("${x}", vars, ctx())).toBe("后");
  });

  it("变量名可以含连字符与空格", () => {
    const vars: ExportVariable[] = [{ name: "my-var", source: "custom", value: "OK" }];
    expect(applyVariables("${my-var}", vars, ctx())).toBe("OK");
  });
});

describe("变量使用情况统计", () => {
  it("分出已定义与未定义", () => {
    const vars: ExportVariable[] = [
      { name: "title", source: "title" },
      { name: "author", source: "author" },
    ];
    const { used, unknown } = collectVariableUsage("${title} ${author} ${typo}", vars);
    expect(used).toEqual(["title", "author"]);
    expect(unknown).toEqual(["typo"]);
  });

  it("重复出现只算一次", () => {
    const vars: ExportVariable[] = [{ name: "title", source: "title" }];
    const { used } = collectVariableUsage("${title}${title}${title}", vars);
    expect(used).toEqual(["title"]);
  });
});

describe("路径拆分", () => {
  it("取最后一段", () => {
    expect(basenameOf("/a/b/c.md")).toBe("c.md");
  });

  it("取所在目录", () => {
    expect(dirnameOf("/a/b/c.md")).toBe("/a/b");
  });

  it("Windows 路径也能拆", () => {
    expect(basenameOf("C:\\Users\\me\\a.md")).toBe("a.md");
    expect(dirnameOf("C:\\Users\\me\\a.md")).toBe("C:\\Users\\me");
  });

  it("没有目录部分时目录是空串", () => {
    expect(dirnameOf("a.md")).toBe("");
  });
});

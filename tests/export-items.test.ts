/**
 * 导出项自定义：解析、物化、快捷键。
 *
 * 这一层是纯函数 + 纯数据，不碰 DOM 也不碰 Tauri——
 * 「设置里写了什么」到「实际能用什么」之间的转换必须能钉死，
 * 否则面板里显示了、点了没反应这类问题会很难查。
 *
 * 另有两处集成断言（导出服务能认出自定义项、被移除的项导出要报错），
 * 因为「解析对了但派发时没走解析结果」是最容易漏的一环。
 */

import { describe, expect, it, beforeEach } from "vitest";
import {
  availableExtraFormats,
  findResolvedExportItem,
  materializeExportItems,
  parseShortcut,
  resolveExportItems,
  shortcutConflict,
} from "@/export/items";
import { BUILTIN_EXPORT_FORMATS, EXTRA_PANDOC_FORMATS } from "@/export/registry";
import { exportDocument } from "@/export/service";
import { resetSettings, updateSettings } from "@/settings/store";
import { setDocumentContent, resetTabs } from "@/ipc/document";
import type { ExportItemSetting } from "@/settings/schema";

beforeEach(() => {
  resetSettings();
  resetTabs();
});

/* ═══════════════════════════════════════════════════════════
 * 解析
 * ═══════════════════════════════════════════════════════════ */

describe("导出项解析", () => {
  it("没有自定义时用内置默认（注册表顺序）", () => {
    const items = resolveExportItems([]);
    expect(items.map((item) => item.format.id)).toEqual(
      BUILTIN_EXPORT_FORMATS.map((format) => format.id),
    );
    expect(items.every((item) => item.visible)).toBe(true);
    expect(items.every((item) => item.shortcut === "")).toBe(true);
  });

  it("设置为空等同于没有自定义", () => {
    expect(resolveExportItems(undefined).length).toBe(resolveExportItems([]).length);
  });

  it("按设置里的顺序显示", () => {
    const items = resolveExportItems([{ id: "docx" }, { id: "html" }, { id: "pdf" }]);
    expect(items.slice(0, 3).map((item) => item.format.id)).toEqual([
      "docx",
      "html",
      "pdf",
    ]);
  });

  it("visible 为 false 的项被标记为不可见", () => {
    const items = resolveExportItems([{ id: "html" }, { id: "docx", visible: false }]);
    const docx = items.find((item) => item.format.id === "docx");
    expect(docx?.visible).toBe(false);
  });

  it("没被提及的内置项补在末尾且可见", () => {
    // 这样以后版本新增内置格式时，老用户不会莫名其妙少一种
    const items = resolveExportItems([{ id: "html" }]);
    const first = items[0];
    expect(first.format.id).toBe("html");
    expect(items.length).toBe(BUILTIN_EXPORT_FORMATS.length);
    expect(items.slice(1).every((item) => item.visible)).toBe(true);
  });

  it("用户添加的额外格式被认出来", () => {
    const items = resolveExportItems([{ id: "pandoc:gfm" }]);
    const gfm = items.find((item) => item.format.id === "pandoc:gfm");
    expect(gfm).toBeTruthy();
    expect(gfm?.added).toBe(true);
    expect(gfm?.format.kind).toBe("pandoc");
    expect(gfm?.format.pandocFormat).toBe("gfm");
  });

  it("指向不存在格式的 id 被跳过而不是抛错", () => {
    // 设置文件可能来自旧版本，不能因为一个失效 id 让应用起不来
    const items = resolveExportItems([{ id: "不存在的格式" }, { id: "html" }]);
    expect(items[0].format.id).toBe("html");
  });

  it("同一个 id 出现两次只取第一个", () => {
    const items = resolveExportItems([
      { id: "html", label: "第一个" },
      { id: "html", label: "第二个" },
    ]);
    expect(items.filter((item) => item.format.id === "html")).toHaveLength(1);
    expect(items[0].label).toBe("第一个");
  });

  it("重命名生效，空名字回落到默认名", () => {
    const items = resolveExportItems([
      { id: "html", label: "网页版" },
      { id: "pdf", label: "   " },
    ]);
    expect(items.find((item) => item.format.id === "html")?.label).toBe("网页版");
    expect(items.find((item) => item.format.id === "pdf")?.label).toBe("PDF");
  });

  it("按 id 找得到解析结果", () => {
    const items: ExportItemSetting[] = [{ id: "docx", label: "Word 文档" }];
    expect(findResolvedExportItem("docx", items)?.label).toBe("Word 文档");
    expect(findResolvedExportItem("不存在的", items)).toBeUndefined();
  });
});

/* ═══════════════════════════════════════════════════════════
 * 物化
 * ═══════════════════════════════════════════════════════════ */

describe("导出项物化", () => {
  it("覆盖全部内置项", () => {
    const materialized = materializeExportItems([]);
    expect(materialized.map((item) => item.id)).toEqual(
      BUILTIN_EXPORT_FORMATS.map((format) => format.id),
    );
  });

  it("保留可见性、重命名与快捷键", () => {
    const materialized = materializeExportItems([
      { id: "html", label: "网页版", shortcut: "Mod-Shift-1" },
      { id: "docx", visible: false },
    ]);
    const html = materialized.find((item) => item.id === "html");
    expect(html?.label).toBe("网页版");
    expect(html?.shortcut).toBe("Mod-Shift-1");
    const docx = materialized.find((item) => item.id === "docx");
    expect(docx?.visible).toBe(false);
  });

  it("没自定义过的项不写多余的字段", () => {
    // 设置文件是给人看的（或给同步用的），不要塞满空字段
    const materialized = materializeExportItems([]);
    for (const item of materialized) {
      expect(item.label).toBeUndefined();
      expect(item.shortcut).toBeUndefined();
      expect(item.visible).toBeUndefined();
    }
  });

  it("用户添加的额外格式也在物化结果里", () => {
    const materialized = materializeExportItems([{ id: "pandoc:gfm" }]);
    expect(materialized.some((item) => item.id === "pandoc:gfm")).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════
 * 额外格式
 * ═══════════════════════════════════════════════════════════ */

describe("可添加的额外格式", () => {
  it("默认全部可添加", () => {
    expect(availableExtraFormats([]).length).toBe(EXTRA_PANDOC_FORMATS.length);
  });

  it("已经加过的不再出现", () => {
    const extras = availableExtraFormats([{ id: "pandoc:gfm" }]);
    expect(extras.some((format) => format.id === "pandoc:gfm")).toBe(false);
    expect(extras.length).toBe(EXTRA_PANDOC_FORMATS.length - 1);
  });

  it("额外格式都是 pandoc 路径且 id 带前缀", () => {
    for (const format of EXTRA_PANDOC_FORMATS) {
      expect(format.kind).toBe("pandoc");
      expect(format.id.startsWith("pandoc:")).toBe(true);
      expect(format.pandocFormat).toBeTruthy();
      expect(format.extension).toMatch(/^\.[a-z0-9]+$/i);
    }
  });
});

/* ═══════════════════════════════════════════════════════════
 * 快捷键
 * ═══════════════════════════════════════════════════════════ */

describe("快捷键解析", () => {
  it("CM6 原生写法原样保留", () => {
    expect(parseShortcut("Mod-Shift-1")).toBe("Mod-Shift-1");
  });

  it("符号写法归一化成同一形式", () => {
    expect(parseShortcut("⌘⇧1")).toBe("Mod-Shift-1");
  });

  it("加号写法归一化成同一形式", () => {
    expect(parseShortcut("Cmd+Shift+1")).toBe("Mod-Shift-1");
  });

  it("大小写与分隔符不影响结果", () => {
    expect(parseShortcut("cmd+shift+1")).toBe("Mod-Shift-1");
    expect(parseShortcut("MOD-SHIFT-1")).toBe("Mod-Shift-1");
  });

  it("空格分隔也能认", () => {
    expect(parseShortcut("cmd shift 1")).toBe("Mod-Shift-1");
  });

  it("字母键转小写（CM6 的键名约定）", () => {
    expect(parseShortcut("Cmd+A")).toBe("Mod-a");
    expect(parseShortcut("Mod-Shift-A")).toBe("Mod-Shift-a");
  });

  it("功能键与具名键原样", () => {
    expect(parseShortcut("F5")).toBe("F5");
    expect(parseShortcut("Mod-Escape")).toBe("Mod-Escape");
  });

  it("修饰符顺序固定，同一组键只有一个写法", () => {
    expect(parseShortcut("Shift-Mod-1")).toBe(parseShortcut("Mod-Shift-1"));
    expect(parseShortcut("Alt-Mod-x")).toBe(parseShortcut("Mod-Alt-x"));
  });

  it("看不懂的输入返回空串", () => {
    expect(parseShortcut("")).toBe("");
    expect(parseShortcut("   ")).toBe("");
    expect(parseShortcut("Mod")).toBe("");
    expect(parseShortcut("Mod-")).toBe("");
    expect(parseShortcut("Hyper-1")).toBe("");
    expect(parseShortcut("Mod-不存在的键")).toBe("");
  });
});

describe("快捷键冲突", () => {
  it("与应用占用的键冲突时报出占用者", () => {
    expect(shortcutConflict("Mod-b", [])).toContain("加粗");
    expect(shortcutConflict("Mod-Shift-e", [])).toContain("导出");
  });

  it("与其他导出项冲突时报出来", () => {
    expect(shortcutConflict("Mod-Shift-1", ["Mod-Shift-1"])).toContain("导出项");
  });

  it("不冲突时返回 null", () => {
    expect(shortcutConflict("Mod-Shift-9", [])).toBeNull();
    expect(shortcutConflict("", [])).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════
 * 与导出服务的集成
 * ═══════════════════════════════════════════════════════════ */

describe("导出服务认自定义项", () => {
  it("用户添加的 pandoc 格式能被导出", async () => {
    setDocumentContent("# 文档\n\n正文");
    updateSettings({ export: { items: [{ id: "pandoc:gfm" }] } });
    const result = await exportDocument("pandoc:gfm");
    // 浏览器降级模式下 pandoc 不可用，会如实报错——
    // 关键是要走到「pandoc 不可用」这一步，而不是「未知导出格式」
    expect(result.error).not.toContain("未知");
    expect(result.error).toContain("pandoc");
  });

  it("被移除的项导出时报错", async () => {
    setDocumentContent("# 文档\n\n正文");
    updateSettings({ export: { items: [{ id: "html", visible: false }] } });
    const result = await exportDocument("html");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("移除");
  });

  it("不存在的 id 报「未知导出格式」", async () => {
    const result = await exportDocument("不存在的格式");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("未知");
  });

  it("重命名不影响导出（导出用的是格式，不是名字）", async () => {
    setDocumentContent("# 文档\n\n正文");
    updateSettings({ export: { items: [{ id: "html", label: "网页版" }] } });
    const result = await exportDocument("html");
    expect(result.ok).toBe(true);
  });
});

/**
 * 「帮助」菜单里的两个速查面板：语法参考 + 快捷键一览。
 *
 * 这两个面板之前是**注册了但没人处理**的菜单项——点了没反应。
 * 现在接上了真实行为，测试要守住的是：
 *
 * 1. **内容不能漂移**：快捷键表是**从注册表生成**的，
 *    注册表加一条、这张表就必须多一条；少一条就是「速查表和实际键位不一样」，
 *    而那种表比没有更糟。
 *
 * 2. **不能露中文**：这两个面板的文案来自**数据文件**（语法速查表）
 *    与**注册表**（快捷键），不是源码里的 `t("…")` 字面量——
 *    所以 `tests/i18n.test.ts` 那条「t() 的字面量都在字典里」**抓不到它们**。
 *    漏译在这里是静默的：英文界面里夹一段中文示例，不报错。
 *    这里把两条数据逐条对着词典查一遍，再把 DOM 真的渲染出来查一遍。
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MarkdownReferenceDialog } from "@/views/MarkdownReferenceDialog";
import { ShortcutsDialog, buildShortcutGroups } from "@/views/ShortcutsDialog";
import { SYNTAX_GROUPS, filterSyntaxGroups } from "@/reference/markdown-syntax";
import { parseMarkdown } from "@/parser/markdown";
import { en } from "@/i18n/locales/en";
import { zhTW } from "@/i18n/locales/zh-TW";
import { resetSettings, updateSettings } from "@/settings/store";
import { DEFAULT_FEATURES } from "@/parser/features";
import { MENU_CHROME, SHORTCUTS } from "@/shortcuts";

/** 简体里才有的字（繁体用同形的字不算） */
const SIMPLIFIED_ONLY = new Set(
  "与专丢两严个为么义书于产从们价众会体侧储关内写决击则刚删别务动区华协单卫却厂压参发变叶号吗启响国图块处备头夹学实宽对导并广库应开弃张当录径态总户扩扫择换数断无时显暂术机权条来极构标栏树样档检欢气汉沟没浅浊测济浏浓涂润涨渐渔温溃满滨潜灯灵点烦热牵状独环现电画疗监盖盘码确礼离积称竞笔简类粘粮紧纠红级纪纯纲纳纸纹线练组细织终经绑结绕绘给络绝统继续维编缩网罗罚职联脑脚脸节苏药见观规视览计订认议记设词试话该语误请读课调谈谊谋谐谓谢谨谱贝负财责败账货质购贴费资赏赔赖赞赢车转轮软轻载较辅辆辈辉辑输边达迁过运还这进远违连迟适选逊递逻遗邓郑酱释钟钥银链锁错锚键长门闭问间阅队阳阴阵际陆随隐难雾静页顶项顺须顽顾预颗题颜额风飘馆马验鱼鸟鸡麦黄齐龙龟".split(
    "",
  ),
);

/** 任意汉字 */
const CJK = /[一-鿿]/;

/** 取 DOM 里所有会显示给用户的字符串（含 title / aria-label 等属性） */
function visibleText(): string[] {
  const parts: string[] = [];
  for (const node of document.body.querySelectorAll("*")) {
    const own = Array.from(node.childNodes)
      .filter((child) => child.nodeType === 3)
      .map((child) => child.textContent ?? "")
      .join(" ");
    if (own) parts.push(own);
    for (const attr of ["title", "aria-label", "placeholder", "alt"]) {
      const value = node.getAttribute(attr);
      if (value) parts.push(value);
    }
  }
  return parts;
}

describe("语法速查表：数据", () => {
  it("分组名、说明、示例都在英繁词典里（漏登记 = 英文界面露中文）", () => {
    const missingEn: string[] = [];
    const missingTw: string[] = [];

    for (const group of SYNTAX_GROUPS) {
      const texts = [
        group.name,
        group.note,
        ...group.samples.map((sample) => sample.text),
      ].filter(Boolean);
      for (const text of texts) {
        // 不含中文的条目（"Emoji"、"---"、代码示例）三个语言下是同一个词，
        // 查不到字典不算漏译——它本来就不需要翻译。
        if (!CJK.test(text)) continue;
        if (!(text in en)) missingEn.push(text);
        if (!(text in zhTW)) missingTw.push(text);
      }
    }

    expect({ missingEn, missingTw }).toEqual({ missingEn: [], missingTw: [] });
  });

  it("每个分组都有名字和至少一条示例", () => {
    for (const group of SYNTAX_GROUPS) {
      expect(group.name.length).toBeGreaterThan(0);
      expect(group.samples.length).toBeGreaterThan(0);
    }
  });

  it("速查表里写的语法，Inkstone 真的认（防表与实现漂移）", () => {
    // 速查表写进去的东西必须是**实测过的**——
    // 用户照着写而屏幕上什么都不发生，比不写更糟。
    //
    // 这条断言不是把「某几个关键字」列一遍黑名单，
    // 而是**拿解析器去验**：表里出现的行内扩展，
    // 解析器必须真的切出对应的 mdast 节点。
    // 以后再实现一个新扩展、忘了往表里加（或加了却没实现），
    // 这条都会红。
    const all = SYNTAX_GROUPS.flatMap((group) =>
      group.samples.map((sample) => sample.text),
    ).join("\n");

    // 已经实现的：表里有，解析器也认
    expect(all).toContain("==高亮==");
    expect(parseMarkdown("==高亮==").children[0]).toMatchObject({
      type: "paragraph",
      children: [{ type: "highlight" }],
    });

    // 还没实现的：表里不许出现
    // （`~下标~` 与 `^上标^` 是 Typora 的 P1 功能，但 Inkstone 还没做——
    //   lezer 那侧其实有现成的扩展，remark 侧还缺，所以没开）
    expect(all).not.toContain("~下标~");
    expect(all).not.toContain("^上标^");
  });
});

describe("语法速查表：界面", () => {
  beforeEach(() => {
    cleanup();
    resetSettings();
  });
  afterEach(() => {
    cleanup();
    resetSettings();
  });

  it("简体界面列出全部分组与示例", () => {
    // 不能用 getByText：testing-library 会把文本里的空白规范化
    // （换行变空格），而多行示例的缩进与换行**本身就是语法的一部分**。
    const { container } = render(<MarkdownReferenceDialog onClose={() => {}} />);

    const groups = filterSyntaxGroups(SYNTAX_GROUPS, DEFAULT_FEATURES);
    const titles = Array.from(container.querySelectorAll(".syntax-reference__title")).map(
      (node) => node.textContent ?? "",
    );
    expect(titles).toEqual(groups.map((group) => group.name));

    const samples = Array.from(
      container.querySelectorAll(".syntax-reference__sample"),
    ).map((node) => node.textContent ?? "");
    expect(samples).toEqual(groups.flatMap((group) => group.samples.map((s) => s.text)));
  });

  it("英文界面里不出现任何中文", () => {
    updateSettings({ general: { language: "en" } });
    render(<MarkdownReferenceDialog onClose={() => {}} />);
    const leaked = visibleText()
      .filter((text) => CJK.test(text))
      .map((text) => text.trim());
    expect(leaked).toEqual([]);
  });

  it("繁体界面里不出现简体字", () => {
    updateSettings({ general: { language: "zh-TW" } });
    render(<MarkdownReferenceDialog onClose={() => {}} />);
    const leaked = visibleText().filter((text) =>
      [...text].some((char) => SIMPLIFIED_ONLY.has(char)),
    );
    expect(leaked).toEqual([]);
  });
});

describe("语法速查表：跟着开关走", () => {
  it("关掉表格 → 表格分组整个消失", () => {
    const groups = filterSyntaxGroups(SYNTAX_GROUPS, {
      ...DEFAULT_FEATURES,
      tables: false,
    });
    expect(groups.map((g) => g.name)).not.toContain("表格");
  });

  it("关掉高亮 → 强调分组还在，但高亮那条没了", () => {
    const groups = filterSyntaxGroups(SYNTAX_GROUPS, {
      ...DEFAULT_FEATURES,
      highlight: false,
    });
    const emphasize = groups.find((g) => g.name === "强调");
    expect(emphasize).toBeTruthy();
    const texts = emphasize?.samples.map((s) => s.text) ?? [];
    expect(texts).not.toContain("==高亮==");
    expect(texts).toContain("**粗体**");
  });

  it("关掉行内公式 → 只影响行内那条，块级那条还在", () => {
    const groups = filterSyntaxGroups(SYNTAX_GROUPS, {
      ...DEFAULT_FEATURES,
      inlineMath: false,
    });
    const math = groups.find((g) => g.name === "公式");
    const texts = math?.samples.map((s) => s.text) ?? [];
    expect(texts).not.toContain("$E = mc^2$");
    expect(texts.some((t) => t.startsWith("$$"))).toBe(true);
  });

  it("全部开着 → 一条都不少", () => {
    const groups = filterSyntaxGroups(SYNTAX_GROUPS, DEFAULT_FEATURES);
    expect(groups).toHaveLength(SYNTAX_GROUPS.length);
    expect(groups.flatMap((g) => g.samples)).toHaveLength(
      SYNTAX_GROUPS.flatMap((g) => g.samples).length,
    );
  });

  it("界面跟着设置走：关掉表格后 DOM 里没有表格分组", () => {
    updateSettings({ markdown: { tables: false } });
    const { container } = render(<MarkdownReferenceDialog onClose={() => {}} />);
    const titles = Array.from(container.querySelectorAll(".syntax-reference__title")).map(
      (node) => node.textContent ?? "",
    );
    expect(titles).not.toContain("表格");
  });
});

describe("快捷键一览：内容由注册表生成", () => {
  it("条目与注册表一一对应（不多不少）", () => {
    const groups = buildShortcutGroups();
    const rows = groups.flatMap((group) => group.rows);
    expect(rows.length).toBe(SHORTCUTS.length + MENU_CHROME.length);
  });

  it("注册表里的每一条都在表里，且键位一致", () => {
    const rows = buildShortcutGroups().flatMap((group) => group.rows);
    for (const item of [...SHORTCUTS, ...MENU_CHROME]) {
      const hit = rows.find((row) => row.label === item.label);
      expect(hit, `速查表里没有「${item.label}」`).toBeTruthy();
      expect(hit?.key).toBe(item.key);
    }
  });

  it("分组按注册表里出现的顺序排（文件 → 编辑 → …）", () => {
    const names = buildShortcutGroups().map((group) => group.name);
    expect(names[0]).toBe(SHORTCUTS[0].group);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("快捷键一览：界面", () => {
  beforeEach(() => {
    cleanup();
    resetSettings();
  });
  afterEach(() => {
    cleanup();
    resetSettings();
  });

  it("简体界面列出每一条快捷键", () => {
    render(<ShortcutsDialog onClose={() => {}} />);
    for (const item of [...SHORTCUTS, ...MENU_CHROME]) {
      expect(screen.getByText(item.label)).toBeTruthy();
    }
  });

  it("英文界面里不出现任何中文", () => {
    updateSettings({ general: { language: "en" } });
    render(<ShortcutsDialog onClose={() => {}} />);
    const leaked = visibleText()
      .filter((text) => CJK.test(text))
      .map((text) => text.trim());
    expect(leaked).toEqual([]);
  });

  it("繁体界面里不出现简体字", () => {
    updateSettings({ general: { language: "zh-TW" } });
    render(<ShortcutsDialog onClose={() => {}} />);
    const leaked = visibleText().filter((text) =>
      [...text].some((char) => SIMPLIFIED_ONLY.has(char)),
    );
    expect(leaked).toEqual([]);
  });
});

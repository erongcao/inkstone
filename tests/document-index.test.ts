/**
 * 文档索引（大纲 + 字数统计）的护栏测试。
 *
 * 两条契约：
 *   1. 大纲的标题集合与 **mdast** 一致（不是 lezer，也不是自己写的正则）
 *   2. 字数统计数的是**纯文本**，Markdown 标记符号不该算进去
 */

import { describe, expect, it, beforeAll } from "vitest";
import type { Node, Parent } from "mdast";
import { ensureMarkdownParser } from "@/parser/markdown-loader";
import { parseMarkdown } from "@/parser/markdown";
import { buildIndex } from "@/editor/document-index";
import { countWords } from "@/editor/stats";

beforeAll(async () => {
  await ensureMarkdownParser();
});

/** mdast 里的标题（对拍基准） */
function remarkHeadings(source: string): { depth: number; text: string }[] {
  const out: { depth: number; text: string }[] = [];
  const plain = (node: Node): string => {
    const parent = node as Parent;
    if (Array.isArray(parent.children)) return parent.children.map(plain).join("");
    return (node as { value?: string }).value ?? "";
  };
  for (const child of parseMarkdown(source).children) {
    if (child.type === "heading") {
      out.push({ depth: child.depth, text: plain(child).trim() });
    }
  }
  return out;
}

describe("大纲：与 mdast 对拍", () => {
  const cases: [string, string][] = [
    ["ATX 标题", "# 一\n\n## 二\n\n### 三\n\n#### 四\n\n##### 五\n\n###### 六"],
    ["Setext 标题", "一级\n===\n\n二级\n---"],
    ["标题里有行内标记", "# **加粗** 与 `代码` 与 [链接](http://x)"],
    ["空标题", "#\n\n## 有内容"],
    ["标题在代码块里不应被算", "```\n# 不是标题\n```\n\n# 真标题"],
    ["标题在 HTML 块里", "<div>\n# 不是标题\n</div>\n\n# 真标题"],
    ["列表项里的伪标题", "- # 不是标题\n\n# 真标题"],
    ["引用块里的伪标题", "> # 不是标题\n\n# 真标题"],
    ["中文标题", "# 第一章 开始\n\n## 一、背景\n\n## 二、方法"],
    ["重复标题", "# 同一个\n\n# 同一个"],
    ["没有标题", "只有段落。\n\n还是段落。"],
  ];

  it.each(cases)("%s", (_name, source) => {
    const index = buildIndex(source);
    expect(index, "索引没算出来").not.toBeNull();
    expect(index!.outline.map(({ depth, text }) => ({ depth, text }))).toEqual(
      remarkHeadings(source),
    );
  });

  it("标题位置能定位回源码（供点击跳转用）", () => {
    const source = "# 第一章\n\n内容。\n\n## 第二节\n\n更多内容。";
    const index = buildIndex(source)!;
    expect(index.outline).toHaveLength(2);
    for (const item of index.outline) {
      // 跳到 from 应该正好落在该标题行
      expect(source.slice(item.from, item.to).split("\n")[0]).toContain(
        item.text.replace(/[*`]/g, ""),
      );
    }
  });

  it("空标题在数据层保持空串（占位是 UI 的事）", () => {
    // 这样「文档没有标题」与「有个标题但内容为空」在数据层就分得开
    const index = buildIndex("#\n\n## 有内容")!;
    expect(index.outline[0].text).toBe("");
    expect(buildIndex("没有标题的文档")!.outline).toEqual([]);
  });

  it("大纲与字数统计共用一次解析，内容同时到位", () => {
    const index = buildIndex("# 标题\n\n正文。")!;
    expect(index.outline.length).toBeGreaterThan(0);
    expect(index.stats.words).toBeGreaterThan(0);
  });
});

describe("字数统计：数的是纯文本不是 Markdown 源码", () => {
  it("标记符号不会被算进字数", () => {
    const source = "**加粗** 和 `代码` 和 [链接](http://example.com)";
    const index = buildIndex(source)!;
    // 纯文本是「加粗 和 代码 和 链接」
    expect(index.stats.chars).toBe("加粗 和 代码 和 链接".length);
  });

  it("标题符号不会被算", () => {
    const index = buildIndex("# 标题文字")!;
    expect(index.stats.chars).toBe("标题文字".length);
  });

  it("**代码块的内容不算进正文字数**", () => {
    // 贴一段配置不该让字数暴涨几百
    const source = "一句话。\n\n```js\nconst a = 1;\nconst b = 2;\n```\n";
    const index = buildIndex(source)!;
    expect(index.stats.chars).toBe("一句话。".length);
  });

  it("**行内代码要算**——它是作者写进句子的词", () => {
    // 与代码块不同：把 `foo()` 排掉会让统计失真
    const index = buildIndex("正文 `很长的代码片段` 结尾")!;
    expect(index.stats.chars).toBe("正文 很长的代码片段 结尾".length);
  });

  it("公式内容算进正文（那是作者写的内容）", () => {
    const index = buildIndex("质能方程 $E = mc^2$ 成立。")!;
    expect(index.stats.chars).toBe("质能方程 E = mc^2 成立。".length);
  });

  it("空文档统计为零", () => {
    expect(buildIndex("")!.stats).toEqual({ chars: 0, words: 0 });
  });
});

describe("countWords 本身", () => {
  it("中文逐字计数", () => {
    expect(countWords("你好世界").words).toBe(4);
  });

  it("拉丁按词计数", () => {
    expect(countWords("hello world").words).toBe(2);
  });

  it("中英混排不会把中文和英文粘成一个词", () => {
    // 这是最容易写错的地方：不做替换的话 "中文English" 会被当成一个词
    expect(countWords("你好hello").words).toBe(3);
  });

  it("词内的连字符与撇号算一个词", () => {
    expect(countWords("well-known don't").words).toBe(2);
  });

  it("标点不算词", () => {
    expect(countWords("你好，世界！").words).toBe(4);
  });

  it("空串", () => {
    expect(countWords("")).toEqual({ chars: 0, words: 0 });
  });

  it("标点也计入字符数", () => {
    expect(countWords("你好，世界！").chars).toBe(6);
  });
});

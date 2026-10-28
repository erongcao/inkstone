/**
 * Markdown 扩展开关的护栏测试。
 *
 * ## 为什么这个文件单独存在
 *
 * 在它出现之前，设置面板里的 13 个 Markdown 开关里**只有 1 个**真的接线
 * （`inlineMathSingleDollar`），其余全是**摆设**——面板画出了复选框，
 * 但没有任何代码读它们。
 *
 * 「设置里的参数不接到请求上，就是摆设」——这条原则最早是为 AI 面板写的。
 * 所以这个文件的作用是：**让「摆设」这件事以后不可能再悄悄发生**。
 *
 * ## 断言分四层
 *
 * | 层 | 断言什么 |
 * |---|---|
 * | 语义层（remark/mdast） | 关掉一个开关，mdast 里就不该再有那个节点 |
 * | 编辑布局层（lezer） | 关掉一个开关，语法树里就不该再有那个节点 |
 * | 两层一致 | 同一段文字，两边必须给出**同一个结论**（架构约束 C） |
 * | 导出 | 屏幕上是字面文本，导出也必须是字面文本 |
 *
 * 最后一层最容易被忽略，但它才是用户真正会察觉的那一层：
 * 屏幕上写着 `$x$`、导出却是一张 KaTeX 图——那不是「功能没做」，
 * 那是**文档内容被悄悄改掉了**。
 */

import { describe, expect, it } from "vitest";
import type { Node, Parent } from "mdast";
import { parseMarkdown, roundTrip, stringifyMarkdown } from "@/parser/markdown";
import { markdownToHtml } from "@/parser/html";
import { parseSyntax } from "@/editor/live-preview/syntax";
import { getMarkdownParser } from "@/editor/markdown-language";
import {
  DEFAULT_FEATURES,
  FEATURE_NAMES,
  featuresFromSettings,
  featuresKey,
  resolveFeatures,
  type MarkdownFeatures,
} from "@/parser/features";
import { DEFAULT_SETTINGS } from "@/settings/schema";

/** 收集 mdast 里的所有某种类型的节点 */
function nodesOfType(tree: Node, type: string): Node[] {
  const out: Node[] = [];
  const walk = (node: Node): void => {
    if (node.type === type) out.push(node);
    const parent = node as Parent;
    if (Array.isArray(parent.children)) {
      for (const child of parent.children) walk(child);
    }
  };
  walk(tree);
  return out;
}

/** mdast 里有某种节点吗 */
function hasNode(
  source: string,
  type: string,
  features?: Partial<MarkdownFeatures>,
): boolean {
  return (
    nodesOfType(parseMarkdown(source, { features }) as unknown as Node, type).length > 0
  );
}

/** lezer 语法树里有某种节点吗 */
function lezerHas(
  source: string,
  type: string,
  features?: Partial<MarkdownFeatures>,
): boolean {
  const parser = getMarkdownParser(resolveFeatures(features));
  let found = false;
  parser.parse(source).iterate({
    enter: (ref) => {
      if (ref.node.type.name === type) found = true;
    },
  });
  return found;
}

/** 整棵树的文本内容（拼起来） */
function textOf(tree: Node): string {
  let out = "";
  const walk = (node: Node): void => {
    const value = (node as { value?: unknown }).value;
    if (typeof value === "string") out += value;
    const parent = node as Parent;
    if (Array.isArray(parent.children)) {
      for (const child of parent.children) walk(child);
    }
  };
  walk(tree);
  return out;
}

describe("开关模型本身", () => {
  it("默认全开", () => {
    expect(Object.values(DEFAULT_FEATURES).every((v) => v === true)).toBe(true);
  });

  it("开关名与设置里的字段一一对应（12 个）", () => {
    // 13 个复选框里有 1 个是「许愿」（autoNumberEquations），
    // 它对应的功能还不存在，所以**不进**这个模型（见 features.ts 的说明）。
    expect(FEATURE_NAMES).toHaveLength(12);
    expect(FEATURE_NAMES).not.toContain("autoNumberEquations");
    // 下标 / 上标以前也在「许愿」名单里（remark 侧没有解析规则），
    // 现在 remark 侧补上了自研的 micromark 扩展，所以是真开关了。
    expect(FEATURE_NAMES).toContain("subscriptSuperscript");
  });

  it("resolveFeatures 只认已知键，垃圾键进不来", () => {
    const resolved = resolveFeatures({
      tables: false,
      // 故意传一个不存在的开关（用 `as` 绕开类型检查，模拟运行时的脏输入）
      totallyNotAFeature: false,
    } as Partial<MarkdownFeatures>);
    expect(resolved.tables).toBe(false);
    expect(Object.keys(resolved).sort()).toEqual([...FEATURE_NAMES].sort());
  });

  it("resolveFeatures 忽略非布尔值", () => {
    const resolved = resolveFeatures({
      // 故意传错类型（模拟运行时的脏输入）
      tables: "yes",
    } as unknown as Partial<MarkdownFeatures>);
    expect(resolved.tables).toBe(true);
  });

  it("resolveFeatures 传空/undefined 时给全开", () => {
    expect(resolveFeatures(undefined)).toEqual(DEFAULT_FEATURES);
    expect(resolveFeatures({})).toEqual(DEFAULT_FEATURES);
  });

  it("featuresKey 对同一组合稳定，对不同组合不同", () => {
    const a = resolveFeatures({ tables: false, taskLists: false });
    const b = resolveFeatures({ tables: false, taskLists: false });
    const c = resolveFeatures({ tables: true, taskLists: false });
    expect(featuresKey(a)).toBe(featuresKey(b));
    expect(featuresKey(a)).not.toBe(featuresKey(c));
  });

  it("featuresFromSettings 把设置里的开关全部搬过来", () => {
    const settings = {
      ...DEFAULT_SETTINGS.markdown,
      tables: false,
      highlight: false,
      mhchem: false,
    };
    const features = featuresFromSettings(settings);
    expect(features.tables).toBe(false);
    expect(features.highlight).toBe(false);
    expect(features.mhchem).toBe(false);
    // 没显式关的保持默认
    expect(features.footnotes).toBe(DEFAULT_SETTINGS.markdown.footnotes);
  });
});

describe("语义层（remark/mdast）：关掉开关就不再产出对应节点", () => {
  it("表格：开 → 有 table 节点；关 → 没有", () => {
    const source = "| a | b |\n| - | - |\n| 1 | 2 |";
    expect(hasNode(source, "table")).toBe(true);
    expect(hasNode(source, "table", { tables: false })).toBe(false);
  });

  it("任务列表：开 → listItem 带 checked；关 → 不带", () => {
    const source = "- [x] 做完\n- [ ] 没做";
    const on = parseMarkdown(source) as unknown as Node;
    const items = nodesOfType(on, "listItem");
    expect(items).toHaveLength(2);
    expect((items[0] as { checked?: boolean }).checked).toBe(true);

    const off = parseMarkdown(source, {
      features: { taskLists: false },
    }) as unknown as Node;
    const offItems = nodesOfType(off, "listItem");
    expect(offItems).toHaveLength(2);
    expect((offItems[0] as { checked?: boolean }).checked ?? null).toBe(null);
  });

  it("脚注：开 → 有 footnoteDefinition；关 → 没有", () => {
    const source = "正文[^1]\n\n[^1]: 注释";
    expect(hasNode(source, "footnoteDefinition")).toBe(true);
    expect(hasNode(source, "footnoteReference")).toBe(true);
    expect(hasNode(source, "footnoteDefinition", { footnotes: false })).toBe(false);
    expect(hasNode(source, "footnoteReference", { footnotes: false })).toBe(false);
  });

  it("高亮：开 → 有 highlight 节点；关 → 没有，且 == 原样留在文本里", () => {
    expect(hasNode("==高亮==", "highlight")).toBe(true);
    expect(hasNode("==高亮==", "highlight", { highlight: false })).toBe(false);
    const tree = parseMarkdown("==高亮==", { features: { highlight: false } });
    expect(textOf(tree as unknown as Node)).toContain("==高亮==");
  });

  it("front matter：开 → 有 yaml 节点；关 → 没有", () => {
    const source = "---\ntitle: 测试\n---\n\n正文";
    expect(hasNode(source, "yaml")).toBe(true);
    expect(hasNode(source, "yaml", { frontMatter: false })).toBe(false);
  });

  it("行内公式：开 → 有 inlineMath；关 → 文本里 $ 原样保留", () => {
    expect(hasNode("价格 $x$ 元", "inlineMath")).toBe(true);
    expect(hasNode("价格 $x$ 元", "inlineMath", { inlineMath: false })).toBe(false);
    const tree = parseMarkdown("价格 $x$ 元", { features: { inlineMath: false } });
    expect(textOf(tree as unknown as Node)).toContain("$x$");
  });

  it("块级公式：开 → 有 math；关 → 变成段落，$$ 原样保留", () => {
    const source = "$$\ny = mc^2\n$$";
    expect(hasNode(source, "math")).toBe(true);
    expect(hasNode(source, "math", { blockMath: false })).toBe(false);
    const tree = parseMarkdown(source, { features: { blockMath: false } });
    expect(textOf(tree as unknown as Node)).toContain("$$");
  });

  it("单 $ 定界符：关掉后 `$x$` 不再是公式，但 `$$x$$` 仍然是", () => {
    // 注意 `$$x$$`（同一行）也是**行内**公式节点——remark-math 里
    // 「块级公式」指的是 `$$` 独占两行的那种。
    expect(hasNode("$x$", "inlineMath", { inlineMathSingleDollar: false })).toBe(false);
    expect(hasNode("$$x$$", "inlineMath", { inlineMathSingleDollar: false })).toBe(true);
  });

  it("公式整体关掉时，两种公式都不是公式", () => {
    const off = { inlineMath: false, blockMath: false };
    expect(hasNode("$x$", "inlineMath", off)).toBe(false);
    expect(hasNode("$$x$$", "math", off)).toBe(false);
  });
});

describe("编辑布局层（lezer）：关掉开关就不再认出对应标记", () => {
  it("表格：关掉后语法树里没有 Table 节点", () => {
    const source = "| a | b |\n| - | - |\n| 1 | 2 |";
    expect(lezerHas(source, "Table")).toBe(true);
    expect(lezerHas(source, "Table", { tables: false })).toBe(false);
  });

  it("任务列表：关掉后语法树里没有 Task 节点", () => {
    const source = "- [x] 做完";
    expect(lezerHas(source, "Task")).toBe(true);
    expect(lezerHas(source, "Task", { taskLists: false })).toBe(false);
  });

  it("高亮：关掉后语法树里没有 Highlight 节点", () => {
    expect(lezerHas("==高亮==", "Highlight")).toBe(true);
    expect(lezerHas("==高亮==", "Highlight", { highlight: false })).toBe(false);
  });

  it("删除线与自动链接没有开关，始终认得", () => {
    expect(lezerHas("~~删除~~", "Strikethrough")).toBe(true);
    // lezer 的自动链接产出的节点名是 `URL`（不是 `Autolink`——
    // `Autolink` 是那个**扩展**的名字）。
    expect(lezerHas("www.example.com", "URL")).toBe(true);
    expect(lezerHas("https://example.com", "URL")).toBe(true);
  });
});

describe("两层必须给出同一个结论（架构约束 C）", () => {
  const cases: { source: string; lezerType: string; mdastType: string }[] = [
    { source: "| a | b |\n| - | - |\n| 1 | 2 |", lezerType: "Table", mdastType: "table" },
    { source: "- [x] 做完", lezerType: "Task", mdastType: "listItem" },
    { source: "==高亮==", lezerType: "Highlight", mdastType: "highlight" },
  ];

  for (const { source, lezerType, mdastType } of cases) {
    it(`${JSON.stringify(source)}：开与关都要一致`, () => {
      for (const features of [
        undefined,
        { tables: false, taskLists: false, highlight: false },
      ]) {
        // mdast 侧：任务列表不是独立节点类型，要看 `checked` 有没有。
        const remarkSays =
          mdastType === "listItem"
            ? nodesOfType(
                parseMarkdown(source, { features }) as unknown as Node,
                "listItem",
              ).some(
                // mdast 里 `checked` 是 `boolean | null`：
                // 任务项是 true/false，普通列表项是 null。
                (n) => typeof (n as { checked?: unknown }).checked === "boolean",
              )
            : hasNode(source, mdastType, features);
        expect(lezerHas(source, lezerType, features)).toBe(remarkSays);
      }
    });
  }
});

describe("导出必须与屏幕一致", () => {
  it("表格关掉 → 导出里没有 <table>", () => {
    const source = "| a | b |\n| - | - |\n| 1 | 2 |";
    expect(markdownToHtml(source)).toContain("<table>");
    expect(markdownToHtml(source, { features: { tables: false } })).not.toContain(
      "<table>",
    );
  });

  it("高亮关掉 → 导出里没有 <mark>", () => {
    expect(markdownToHtml("==高亮==")).toContain("<mark>");
    expect(markdownToHtml("==高亮==", { features: { highlight: false } })).not.toContain(
      "<mark>",
    );
  });

  it("行内公式关掉 → 导出里 $ 还在，不是 KaTeX", () => {
    const html = markdownToHtml("价格 $x$ 元", { features: { inlineMath: false } });
    expect(html).toContain("$x$");
    expect(html).not.toContain("katex");
  });

  it("块级公式关掉 → 导出里 $$ 还在", () => {
    const html = markdownToHtml("$$\ny = mc^2\n$$", { features: { blockMath: false } });
    expect(html).toContain("$$");
    expect(html).not.toContain("katex");
  });
});

describe("往返：关掉的语法不能被改写", () => {
  it("表格关掉后，表格还是字面文本", () => {
    const source = "| a | b |\n| - | - |\n| 1 | 2 |";
    const out = roundTrip(source, { features: { tables: false } });
    expect(out).toContain("| a | b |");
    expect(out).not.toContain("<table>");
  });

  it("高亮关掉后，== 不会被吃掉", () => {
    const out = roundTrip("==高亮==", { features: { highlight: false } });
    expect(out).toContain("==高亮==");
  });

  it("行内公式关掉后，$ 不会被吃掉", () => {
    const out = roundTrip("价格 $x$ 元", { features: { inlineMath: false } });
    // 序列化器会把字面的 `$` 转义成 `\$`——因为块级公式还开着，
    // `remark-math` 仍在，而它会把「看起来像定界符的 `$`」一律转义掉
    // （否则重新解析时会被当成公式）。
    //
    // 转义后的 Markdown **渲染出来还是** `$x$`，语义没丢——
    // 所以这里断言的是「再解析一次，文本里还是 `$x$`」，
    // 而不是逐字节比对（逐字节比对会把「转义」误判成「内容被改」）。
    const tree = parseMarkdown(out, { features: { inlineMath: false } });
    expect(textOf(tree as unknown as Node)).toContain("$x$");
  });

  it("脚注关掉后，`[^1]` 不会被改写", () => {
    const out = roundTrip("正文[^1]", { features: { footnotes: false } });
    expect(out).toContain("[^1]");
  });

  it("开关组合改变时，序列化用的是同一套开关", () => {
    const tree = parseMarkdown("==高亮==", { features: { highlight: false } });
    const out = stringifyMarkdown(tree, { features: { highlight: false } });
    expect(out).toContain("==高亮==");
  });
});

describe("语法树：换开关要换 parser", () => {
  it("不同开关组合拿到不同的 parser 实例", () => {
    const on = getMarkdownParser(resolveFeatures({ tables: true }));
    const off = getMarkdownParser(resolveFeatures({ tables: false }));
    expect(on).not.toBe(off);
  });

  it("同一开关组合复用同一个 parser（缓存生效）", () => {
    const a = getMarkdownParser(resolveFeatures({ tables: false, highlight: true }));
    const b = getMarkdownParser(resolveFeatures({ highlight: true, tables: false }));
    expect(a).toBe(b);
  });

  it("parseSyntax 不传 parser 时用全开的那一套", () => {
    const types: string[] = [];
    parseSyntax("==高亮==").iterate({
      enter: (ref) => {
        types.push(ref.node.type.name);
      },
    });
    expect(types).toContain("Highlight");
  });
});

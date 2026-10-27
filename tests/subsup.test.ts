/**
 * 下标 `~…~` 与上标 `^…^` 的护栏测试。
 *
 * 这个语法横跨三层（remark/mdast 语义、lezer 编辑布局、HTML 导出），
 * 所以测试也分三层写，**外加一条最重要的**：
 *
 *   **lezer 与 remark 必须对同一段文字给出同样的结论。**
 *
 * 那是架构约束 C（解析规则唯一）的可执行形式。
 *
 * ## 为什么 remark 侧要自己写扩展
 *
 * remark 生态里没有能用的现成包（`remark-sub` / `remark-supersub` /
 * `remark-sub-super` 三个都不行，理由写��� `src/parser/subsup.ts` 的文件头），
 * 而 lezer 侧一直有现成的 `Subscript` / `Superscript`——
 * 只开一半会破「解析规则唯一」，所以本项目的做法是：
 *
 *   - remark 侧：**自研** micromark 扩展，规则逐条照抄 lezer 的 `parseSubSuper`
 *   - lezer 侧：直接用 `@lezer/markdown` 自带的扩展
 *
 * 于是「一致」不再靠运气，而是一条**写下来的规格**
 * （四条规则，在 `src/parser/subsup.ts` 的文件头）。
 * 本文件就是那份规格的可执行版本。
 */

import { describe, expect, it } from "vitest";
import type { Node, Parent } from "mdast";
import { parseMarkdown, roundTrip } from "@/parser/markdown";
import { markdownToHtml } from "@/parser/html";
import { parseSyntax } from "@/editor/live-preview/syntax";
import { buildLivePreviewDecorations } from "@/editor/live-preview/decorations";
import { DEFAULT_FEATURES } from "@/parser/features";
import { getMarkdownParser } from "@/editor/markdown-language";

/** 收集 mdast 里的所有某类节点 */
function nodesOfType(tree: Node, type: string): Node[] {
  const out: Node[] = [];
  const walk = (node: Node): void => {
    // 先判类型再递归——容器节点自己就有 children，
    // 先递归的话会直接 return，永远收集不到它。
    if (node.type === type) out.push(node);
    const parent = node as Parent;
    if (Array.isArray(parent.children)) {
      for (const child of parent.children) walk(child);
    }
  };
  walk(tree);
  return out;
}

/** mdast 侧：这段文字里有没有某类节点 */
function remarkHas(source: string, type: string): boolean {
  return nodesOfType(parseMarkdown(source) as unknown as Node, type).length > 0;
}

/** lezer 侧：这段文字里有没有某个节点类型 */
function lezerHas(source: string, nodeType: string, parser?: unknown): boolean {
  let found = false;
  const tree = parser
    ? (parser as { parse: (s: string) => { iterate: (spec: unknown) => void } }).parse(source)
    : parseSyntax(source);
  tree.iterate({
    enter: (ref: { node: { type: { name: string } } }) => {
      if (ref.node.type.name === nodeType) found = true;
    },
  });
  return found;
}

/* ═══════════════════════════════════════════════════════════ */

describe("下标 / 上标：remark/mdast 语义层", () => {
  it("`~下标~` 识别成 subscript 节点", () => {
    const nodes = nodesOfType(parseMarkdown("~下标~") as unknown as Node, "subscript");
    expect(nodes).toHaveLength(1);
  });

  it("`^上标^` 识别成 superscript 节点", () => {
    const nodes = nodesOfType(parseMarkdown("^上标^") as unknown as Node, "superscript");
    expect(nodes).toHaveLength(1);
  });

  it("正文保留在节点里，标记符不留在文本上", () => {
    const nodes = nodesOfType(parseMarkdown("~下标~") as unknown as Node, "subscript");
    const text = (nodes[0] as Parent).children
      .map((c) => (c as { value?: string }).value ?? "")
      .join("");
    expect(text).toBe("下标");
  });

  it("化学式 H~2~O 的下标是 2", () => {
    const nodes = nodesOfType(parseMarkdown("H~2~O") as unknown as Node, "subscript");
    const text = (nodes[0] as Parent).children
      .map((c) => (c as { value?: string }).value ?? "")
      .join("");
    expect(text).toBe("2");
  });

  it("规则 ①：`~~x~~` 是删除线，不是下标", () => {
    expect(remarkHas("~~删除~~", "subscript")).toBe(false);
    expect(remarkHas("~~删除~~", "delete")).toBe(true);
  });

  it("规则 ②：未闭合的不是下标", () => {
    expect(remarkHas("~未闭合", "subscript")).toBe(false);
    expect(remarkHas("^未闭合", "superscript")).toBe(false);
  });

  it("规则 ②：闭合标记必须在同一行内", () => {
    expect(remarkHas("~多\n行~", "subscript")).toBe(false);
  });

  it("规则 ③：`\\` 后的字符被转义，不当作闭合标记", () => {
    expect(remarkHas("~\\~x~", "subscript")).toBe(true);
    const nodes = nodesOfType(parseMarkdown("~\\~x~") as unknown as Node, "subscript");
    const text = (nodes[0] as Parent).children
      .map((c) => (c as { value?: string }).value ?? "")
      .join("");
    expect(text).toBe("~x");
  });

  it("规则 ④：内容里不能有空白", () => {
    expect(remarkHas("~a b~", "subscript")).toBe(false);
    expect(remarkHas("a ~ b ~ c", "subscript")).toBe(false);
  });

  it("行内代码里的不是下标", () => {
    expect(remarkHas("`~代码里~`", "subscript")).toBe(false);
  });

  it("转义的开标记不是下标", () => {
    expect(remarkHas("\\~x~", "subscript")).toBe(false);
  });

  it("内容不做嵌套解析（字符级，与 lezer 一致）", () => {
    const nodes = nodesOfType(parseMarkdown("~a*b*c~") as unknown as Node, "subscript");
    const text = (nodes[0] as Parent).children
      .map((c) => (c as { value?: string }).value ?? "")
      .join("");
    expect(text).toBe("a*b*c");
  });
});

/* ═══════════════════════════════════════════════════════════ */

describe("下标 / 上标：lezer 编辑布局层", () => {
  it("切出 Subscript 与 SubscriptMark 节点", () => {
    const types: string[] = [];
    parseSyntax("~下标~").iterate({
      enter: (ref) => {
        types.push(ref.node.type.name);
      },
    });
    expect(types).toContain("Subscript");
    expect(types.filter((t) => t === "SubscriptMark")).toHaveLength(2);
  });

  it("切出 Superscript 与 SuperscriptMark 节点", () => {
    const types: string[] = [];
    parseSyntax("^上标^").iterate({
      enter: (ref) => {
        types.push(ref.node.type.name);
      },
    });
    expect(types).toContain("Superscript");
    expect(types.filter((t) => t === "SuperscriptMark")).toHaveLength(2);
  });

  it("行内代码里的不是下标", () => {
    expect(lezerHas("`~代码里~`", "Subscript")).toBe(false);
  });

  it("GFM 删除线不受影响", () => {
    expect(lezerHas("~~删除~~", "Strikethrough")).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════ */

/**
 * 两层判据必须一致的用例表。
 *
 * 每一条都是「一句话里 `~` / `^` 到底算不算下标 / 上标」的边界情况——
 * 这些正是两套解析器最容易分叉的地方。
 *
 * 规则来源见 `src/parser/subsup.ts` 的文件头。
 */
const AGREEMENT_CASES: string[] = [
  "~下标~",
  "^上标^",
  "H~2~O",
  "x^2^",
  "~~删除线~~", // 规则 ①
  "~未闭合", // 规则 ②
  "^未闭合",
  "~a b~", // 规则 ④
  "a ~ b ~ c",
  "~\\~x~", // 规则 ③
  "\\~x~",
  "`~代码里~`",
  "~多\n行~", // 规则 ②
  "~~x~",
  "~x~~",
  "~a~ ~b~",
  "~a*b*c~", // 字符级
  "~~~x~~~",
  "~~~~x~~~~",
  "~~~",
  "~",
  "^",
  "~ a~",
  "~a ~",
  "**粗** ~下~ **粗**",
  "~中文~",
  "^中文^",
  "~a~b~",
];

describe("下标 / 上标：两层判据必须一致（架构约束 C）", () => {
  for (const source of AGREEMENT_CASES) {
    it(`${JSON.stringify(source)}：lezer 与 remark 结论相同`, () => {
      expect(lezerHas(source, "Subscript")).toBe(remarkHas(source, "subscript"));
      expect(lezerHas(source, "Superscript")).toBe(remarkHas(source, "superscript"));
    });
  }
});

/* ═══════════════════════════════════════════════════════════ */

describe("下标 / 上标：HTML 导出", () => {
  it("输出 <sub>", () => {
    expect(markdownToHtml("~下标~")).toContain("<sub>下标</sub>");
  });

  it("输出 <sup>", () => {
    expect(markdownToHtml("^上标^")).toContain("<sup>上标</sup>");
  });

  it("普通文本里的 `~` 原样输出，不多包一层", () => {
    const html = markdownToHtml("a ~ b");
    expect(html).not.toContain("<sub>");
    expect(html).toContain("a ~ b");
  });

  it("删除线仍然是 <del>，没被下标抢走", () => {
    const html = markdownToHtml("~~删除~~");
    expect(html).toContain("<del>删除</del>");
    expect(html).not.toContain("<sub>");
  });
});

/* ═══════════════════════════════════════════════════════════ */

describe("下标 / 上标：往返", () => {
  it("`~x~` 往返后还是 `~x~`", () => {
    expect(roundTrip("~下标~").trim()).toBe("~下标~");
  });

  it("`^x^` 往返后还是 `^x^`", () => {
    expect(roundTrip("^上标^").trim()).toBe("^上标^");
  });

  it("化学式往返后波浪号不丢", () => {
    expect(roundTrip("H~2~O").trim()).toBe("H~2~O");
  });

  it("内容里的 `~` 转义后往返仍然等价", () => {
    // 原文 `~\~x~`：内容是转义过的 `~x`。
    // 序列化时 `~` 必须转义（unsafe 规则），否则会提前闭合。
    expect(roundTrip("~\\~x~").trim()).toBe("~\\~x~");
  });

  it("往返两次收敛", () => {
    const once = roundTrip("~下标~");
    expect(roundTrip(once)).toBe(once);
  });
});

/* ═══════════════════════════════════════════════════════════ */

describe("下标 / 上标：Live Preview 装饰器", () => {
  /** 把装饰器集合摊平成可断言的数组 */
  function collect(doc: string, cursor: number) {
    const set = buildLivePreviewDecorations(doc, cursor, "live", parseSyntax(doc));
    const out: { from: number; to: number; kind: "replace" | "mark"; cls?: string }[] = [];
    const it = set.iter();
    while (it.value !== null) {
      const spec = it.value.spec as { widget?: unknown; class?: string };
      out.push({
        from: it.from,
        to: it.to,
        kind: spec.widget ? "replace" : "mark",
        cls: spec.class,
      });
      it.next();
    }
    return out;
  }

  it("光标在结构外时隐藏标记", () => {
    const doc = "~下标~ 后";
    const hidden = collect(doc, doc.length)
      .filter((d) => d.kind === "replace")
      .map((d) => [d.from, d.to]);
    expect(hidden).toEqual([
      [0, 1],
      [3, 4],
    ]);
  });

  it("光标进入结构后标记重新可见", () => {
    const doc = "~下标~";
    const hidden = collect(doc, 2)
      .filter((d) => d.kind === "replace")
      .map((d) => [d.from, d.to]);
    expect(hidden).toEqual([]);
  });

  it("正文挂上 cm-md-subscript 样式", () => {
    const doc = "~下标~";
    const marks = collect(doc, doc.length).filter(
      (d) => d.kind === "mark" && d.cls?.includes("cm-md-subscript"),
    );
    expect(marks.length).toBeGreaterThan(0);
  });

  it("正文挂上 cm-md-superscript 样式", () => {
    const doc = "^上标^";
    const marks = collect(doc, doc.length).filter(
      (d) => d.kind === "mark" && d.cls?.includes("cm-md-superscript"),
    );
    expect(marks.length).toBeGreaterThan(0);
  });

  it("普通文本不产生下标装饰", () => {
    const marks = collect("普通文本", 4).filter((d) => d.cls?.includes("cm-md-subscript"));
    expect(marks).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════ */

describe("下标 / 上标：开关关掉时三层同时变字面文本", () => {
  const off = { features: { subscriptSuperscript: false } };

  it("remark 侧不再产出节点", () => {
    const tree = parseMarkdown("~下标~", off) as unknown as Node;
    expect(nodesOfType(tree, "subscript")).toHaveLength(0);
    expect(nodesOfType(tree, "superscript")).toHaveLength(0);
  });

  it("lezer 侧不再认标记", () => {
    const parser = getMarkdownParser({
      ...DEFAULT_FEATURES,
      subscriptSuperscript: false,
    });
    expect(lezerHas("~下标~", "Subscript", parser)).toBe(false);
    expect(lezerHas("^上标^", "Superscript", parser)).toBe(false);
  });

  it("导出是字面文本，不带 <sub> / <sup>", () => {
    const html = markdownToHtml("~下标~", off);
    expect(html).not.toContain("<sub>");
    expect(html).toContain("~下标~");
  });

  it("关掉时删除线不受影响（那是另一个开关）", () => {
    const html = markdownToHtml("~~删除~~", off);
    expect(html).toContain("<del>删除</del>");
  });
});

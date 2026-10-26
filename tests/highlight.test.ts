/**
 * `==高亮==` 的护栏测试。
 *
 * 这个语法横跨三层（remark/mdast 语义、lezer 编辑布局、HTML 导出），
 * 所以测试也分三层写，**外加一条最重要的**：
 *
 *   **lezer 与 remark 必须对同一段文字给出同样的结论。**
 *
 * 那是架构约束 C（解析规则唯一）的可执行形式。
 * 两边判据不一致时，屏幕上的样子和导出的结果就会分叉——
 * 用户看到「这里高亮了」，导出却没有，或者反过来。
 * 两边的 flanking 规则都派生自 GFM 官方的删除线模板
 * （lezer 那份照抄 `@lezer/markdown` 的 `Strikethrough`，
 * remark 那份来自 `micromark-extension-gfm-strikethrough`），
 * 所以它们**应该**一致——但「应该」不是保证，这里就是那个保证。
 */

import { describe, expect, it } from "vitest";
import type { Node, Parent } from "mdast";
import { parseMarkdown, roundTrip } from "@/parser/markdown";
import { markdownToHtml } from "@/parser/html";
import { parseSyntax } from "@/editor/live-preview/syntax";
import { buildLivePreviewDecorations } from "@/editor/live-preview/decorations";

/** 收集 mdast 里的所有 `highlight` 节点 */
function highlightNodes(tree: Node): Node[] {
  const out: Node[] = [];
  const walk = (node: Node): void => {
    // 先判类型再递归——`highlight` 自己就有 children，
    // 先递归的话会直接 return，永远收集不到它。
    if (node.type === "highlight") out.push(node);
    const parent = node as Parent;
    if (Array.isArray(parent.children)) {
      for (const child of parent.children) walk(child);
    }
  };
  walk(tree);
  return out;
}

/** mdast 侧：这段文字里有没有高亮 */
function remarkHasHighlight(source: string): boolean {
  return highlightNodes(parseMarkdown(source) as unknown as Node).length > 0;
}

/** lezer 侧：这段文字里有没有高亮 */
function lezerHasHighlight(source: string): boolean {
  let found = false;
  parseSyntax(source).iterate({
    enter: (ref) => {
      if (ref.node.type.name === "Highlight") found = true;
    },
  });
  return found;
}

/**
 * 两层判据必须一致的用例表。
 *
 * 每一条都是「一句话里 == 到底算不算高亮」的边界情况——
 * 这些正是两套解析器最容易分叉的地方。
 */
const AGREEMENT_CASES: string[] = [
  "==高亮==",
  "正常 ==中间== 结尾",
  "a == b == c", // 标记后面是空格 → 不该算
  "`==代码里==`", // 行内代码里不是标记
  "==未闭合",
  "**粗** 与 ==高亮==",
  "==*斜体*==",
  "==a== ==b==", // 两个相邻的高亮
  "==a==b==",
  "====", // 四个等号：不是高亮
  "标题\n===", // setext 标题的下划线
  "==多\n行==",
];

describe("==高亮==：remark/mdast 语义层", () => {
  it("识别成 highlight 节点", () => {
    const nodes = highlightNodes(parseMarkdown("==高亮==") as unknown as Node);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe("highlight");
  });

  it("正文保留在节点里，标记符不留在文本上", () => {
    const nodes = highlightNodes(parseMarkdown("==高亮==") as unknown as Node);
    const text = (nodes[0] as Parent).children
      .map((c) => (c as { value?: string }).value ?? "")
      .join("");
    expect(text).toBe("高亮");
  });

  it("行内代码里的 == 不是高亮", () => {
    expect(remarkHasHighlight("`==代码里==`")).toBe(false);
  });

  it("未闭合的不是高亮", () => {
    expect(remarkHasHighlight("==未闭合")).toBe(false);
  });

  it("标记后面是空格的不算高亮", () => {
    expect(remarkHasHighlight("a == b == c")).toBe(false);
  });

  it("setext 标题的下划线不是高亮", () => {
    expect(remarkHasHighlight("标题\n===")).toBe(false);
  });
});

describe("==高亮==：lezer 编辑布局层", () => {
  it("切出 Highlight 与 HighlightMark 节点", () => {
    const types: string[] = [];
    parseSyntax("==高亮==").iterate({
      enter: (ref) => {
        types.push(ref.node.type.name);
      },
    });
    expect(types).toContain("Highlight");
    expect(types.filter((t) => t === "HighlightMark")).toHaveLength(2);
  });

  it("行内代码里的 == 不是高亮", () => {
    expect(lezerHasHighlight("`==代码里==`")).toBe(false);
  });

  it("未闭合的不是高亮", () => {
    expect(lezerHasHighlight("==未闭合")).toBe(false);
  });

  it("GFM 删除线不受影响", () => {
    const types: string[] = [];
    parseSyntax("~~删除~~").iterate({
      enter: (ref) => {
        types.push(ref.node.type.name);
      },
    });
    expect(types).toContain("Strikethrough");
  });
});

describe("==高亮==：两层判据必须一致（架构约束 C）", () => {
  for (const source of AGREEMENT_CASES) {
    it(`${JSON.stringify(source)}：lezer 与 remark 结论相同`, () => {
      expect(lezerHasHighlight(source)).toBe(remarkHasHighlight(source));
    });
  }
});

describe("==高亮==：HTML 导出", () => {
  it("输出 <mark>", () => {
    expect(markdownToHtml("==高亮==")).toContain("<mark>高亮</mark>");
  });

  it("行内的也输出 <mark>", () => {
    expect(markdownToHtml("正常 ==中间== 结尾")).toContain("<mark>中间</mark>");
  });

  it("普通文本里的 == 原样输出，不多包一层", () => {
    const html = markdownToHtml("a == b == c");
    expect(html).not.toContain("<mark>");
    expect(html).toContain("a == b == c");
  });
});

describe("==高亮==：往返", () => {
  it("`==x==` 往返后还是 `==x==`", () => {
    expect(roundTrip("==高亮==").trim()).toBe("==高亮==");
  });

  it("行内的高亮往返后标记不丢", () => {
    expect(roundTrip("正常 ==中间== 结尾").trim()).toBe("正常 ==中间== 结尾");
  });

  it("往返两次收敛", () => {
    const once = roundTrip("==高亮==");
    expect(roundTrip(once)).toBe(once);
  });
});

describe("==高亮==：Live Preview 装饰器", () => {
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

  it("光标在结构外时隐藏 == 标记", () => {
    const doc = "==高亮== 后";
    const hidden = collect(doc, doc.length)
      .filter((d) => d.kind === "replace")
      .map((d) => [d.from, d.to]);
    expect(hidden).toEqual([
      [0, 2],
      [4, 6],
    ]);
  });

  it("光标进入高亮结构后标记重新可见", () => {
    const doc = "==高亮==";
    const hidden = collect(doc, 3)
      .filter((d) => d.kind === "replace")
      .map((d) => [d.from, d.to]);
    expect(hidden).toEqual([]);
  });

  it("正文挂上 cm-md-highlight 样式", () => {
    const doc = "==高亮==";
    const marks = collect(doc, doc.length).filter(
      (d) => d.kind === "mark" && d.cls?.includes("cm-md-highlight"),
    );
    expect(marks.length).toBeGreaterThan(0);
  });

  it("普通文本不产生高亮装饰", () => {
    const marks = collect("普通文本", 4).filter((d) => d.cls?.includes("cm-md-highlight"));
    expect(marks).toEqual([]);
  });
});

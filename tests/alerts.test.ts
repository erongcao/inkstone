/**
 * GitHub 提示块（`> [!NOTE]`）的护栏测试。
 *
 * ## 这个语法横跨三层
 *
 * | 层 | 谁负责 |
 * |---|---|
 * | 语义层 | mdast 里它就是**普通引用块**（标记还在正文里） |
 * | 编辑布局层 | lezer 不认识 alert，`[!NOTE]` 是个 Link 节点（和脚注一样） |
 * | 表现层 | 导出时上游插件把它变成带图标与标题的 div |
 *
 * 第三层是**破坏性**的（上游插件把 `[!NOTE]` 从正文里删掉），
 * 所以它只能待在「mdast → HTML」这条链路上，
 * 不能进解析层——否则往返就丢了标记（详见 `src/parser/alerts.ts`）。
 *
 * ## 最要紧的一条
 *
 * **编辑器与导出必须对同一段文字给出同样的结论。**
 *
 * 编辑器侧是自己扫的（lezer 不认识 alert），
 * 导出侧用的是上游插件——两套实现，必须对拍。
 * 对拍断言在下面「判定规则必须与上游一致」那组。
 */

import { describe, expect, it } from "vitest";
import { remarkAlert } from "remark-github-blockquote-alert";
import type { Node, Parent, Root } from "mdast";
import { parseMarkdown, roundTrip } from "@/parser/markdown";
import { markdownToHtml } from "@/parser/html";
import { matchAlert } from "@/parser/alerts";
import { findAlerts } from "@/editor/render/alert";
import { parseSyntax } from "@/editor/live-preview/syntax";

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

/**
 * 上游 transformer 的真实签名。
 *
 * 上游把 `remarkAlert` 标成 `Plugin`（`this: Processor`），
 * 但运行时返回的其实是一个纯 transformer——`src/parser/alerts.ts` 里
 * 也是这么调的（同一个坑，同一个解法）。
 */
type AlertTransformer = (tree: Root) => void;

/**
 * 上游插件的判定结果：它会不会把这个引用块当成 alert？
 *
 * 复刻上游的做法——**就地**跑一遍插件，然后看引用块上有没有
 * `markdown-alert` 的 className。
 *
 * 注意上游插件是**破坏性**的，所以每次都要重新解析一份树。
 */
function upstreamSaysAlert(source: string): boolean {
  const tree = parseMarkdown(source) as Root;
  const transform = (remarkAlert as unknown as () => AlertTransformer)();
  transform(tree);
  for (const node of nodesOfType(tree as unknown as Node, "blockquote")) {
    const data = (node as { data?: { hProperties?: { className?: string[] } } }).data;
    const classes = data?.hProperties?.className ?? [];
    if (classes.some((c) => c.startsWith("markdown-alert"))) return true;
  }
  return false;
}

/** 判定规则的两边必须一致的那些输入 */
const AGREEMENT_CASES: string[] = [
  "> [!NOTE]\n> 内容",
  "> [!TIP]\n> 内容",
  "> [!IMPORTANT]\n> 内容",
  "> [!WARNING]\n> 内容",
  "> [!CAUTION]\n> 内容",
  "> [!note]\n> 小写类型",
  "> [!NOTE] 紧跟文字\n> 第二行",
  "> 普通引用\n> 没有标记",
  "> [!UNKNOWN]\n> 未知类型",
  "> [!NOTE]",
  "普通段落",
  "> 引用\n>\n> [!NOTE]\n> 第二段",
];

/** 编辑器侧扫出来的提示块 */
function editorAlerts(source: string): { type: string; marker: string }[] {
  return findAlerts(parseSyntax(source), source).map((a) => ({
    type: a.type,
    marker: source.slice(a.markerFrom, a.markerTo),
  }));
}

describe("判定规则：我们的与上游的必须一致", () => {
  for (const source of AGREEMENT_CASES) {
    it(`${JSON.stringify(source)}：结论相同`, () => {
      const upstream = upstreamSaysAlert(source);
      const ours = editorAlerts(source).length > 0;
      expect(ours).toBe(upstream);
    });
  }
});

describe("matchAlert：标记本身", () => {
  it("认得五种类型", () => {
    for (const type of ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"]) {
      expect(matchAlert(`[!${type}]`)?.type).toBe(type);
    }
  });

  it("大小写不敏感，但归一化成大写", () => {
    expect(matchAlert("[!note]")?.type).toBe("NOTE");
  });

  it("标记长度算得对（含方括号与叹号）", () => {
    expect(matchAlert("[!NOTE]")?.length).toBe(7);
  });

  it("不是标记就返回 null", () => {
    expect(matchAlert("普通文字")).toBeNull();
    expect(matchAlert("[!UNKNOWN]")).toBeNull();
  });
});

describe("编辑器侧：找出提示块", () => {
  it("认得 `> [!NOTE]`", () => {
    const found = editorAlerts("> [!NOTE]\n> 内容");
    expect(found).toHaveLength(1);
    expect(found[0].type).toBe("NOTE");
    expect(found[0].marker).toBe("[!NOTE]");
  });

  it("五种类型都认得", () => {
    for (const type of ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"]) {
      expect(editorAlerts(`> [!${type}]\n> 内容`)[0].type).toBe(type);
    }
  });

  it("普通引用不算提示块", () => {
    expect(editorAlerts("> 普通引用")).toEqual([]);
  });
});

describe("导出：提示块变成带样式的 div", () => {
  it("输出 markdown-alert 类名", () => {
    const html = markdownToHtml("> [!NOTE]\n> 内容");
    expect(html).toContain("markdown-alert");
    expect(html).toContain("markdown-alert-note");
  });

  it("标题被换成类型名", () => {
    const html = markdownToHtml("> [!WARNING]\n> 内容");
    expect(html).toContain("markdown-alert-warning");
    expect(html).toContain("WARNING");
  });

  it("开关关掉 → 就是普通引用块", () => {
    const html = markdownToHtml("> [!NOTE]\n> 内容", { features: { githubAlerts: false } });
    expect(html).not.toContain("markdown-alert");
    expect(html).toContain("<blockquote>");
  });
});

describe("语义层：解析层不碰标记", () => {
  it("mdast 里它就是普通引用块（标记还在正文里）", () => {
    const tree = parseMarkdown("> [!NOTE]\n> 内容") as unknown as Node;
    const quotes = nodesOfType(tree, "blockquote");
    expect(quotes).toHaveLength(1);
    // 标记没有被删掉——删掉是**导出期**的事
    expect(JSON.stringify(quotes[0])).toContain("[!NOTE]");
  });

  it("往返不丢标记", () => {
    const out = roundTrip("> [!NOTE]\n> 内容");
    expect(out).toContain("[!NOTE]");
  });
});

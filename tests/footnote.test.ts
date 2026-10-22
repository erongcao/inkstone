/**
 * 脚注的护栏测试。
 *
 * 最重要的一块是**与 remark-gfm 对拍**：
 * 脚注的编号语义（谁先谁后、没定义怎么办、标签怎么归一）全部由 remark 决定
 * （架构约束 C），而实现走的是 lezer + 行扫描的快路径。
 * 两边一旦分叉，用户看到的编号就会和导出的 HTML 对不上——
 * 表格那次就是这么栽的，所以这里逐条比对。
 *
 * 基准取自 mdast（不是 HTML 字符串）：编号规则能从
 * `footnoteReference.identifier` / `footnoteDefinition.identifier` 直接还原，
 * 比解析 `<sup>` 文本更稳，也不会被 HTML 序列化细节干扰。
 */

import { describe, expect, it } from "vitest";
import type { Node, Parent } from "mdast";
import { parseSyntax } from "@/editor/live-preview/syntax";
import { buildLivePreviewDecorations } from "@/editor/live-preview/decorations";
import {
  FootnoteDefWidget,
  FootnoteRefWidget,
} from "@/editor/live-preview/footnote-widget";
import { findFootnotes } from "@/editor/render/footnote";
import { parseMarkdown } from "@/parser/markdown";

type Ref = { label: string; number: number };

/** 一条装饰器（只取断言要用的字段） */
interface Decoration {
  from: number;
  to: number;
  widget?: unknown;
  cls?: string;
}

/** 从 mdast 还原 remark-gfm 的脚注编号结果 —— 基准 */
function remarkFootnotes(source: string): { refs: Ref[]; defs: Ref[] } {
  const tree = parseMarkdown(source) as unknown as Node;
  const defined = new Set<string>();
  const order: string[] = [];

  const walk = (node: Node): void => {
    if (node.type === "footnoteDefinition") {
      defined.add((node as unknown as { identifier: string }).identifier);
    }
    if (node.type === "footnoteReference") {
      order.push((node as unknown as { identifier: string }).identifier);
    }
    const parent = node as Parent;
    if (Array.isArray(parent.children)) for (const child of parent.children) walk(child);
  };
  walk(tree);

  // 编号按**首次引用**顺序；没有定义的引用不参与编号（remark 输出字面量）
  const numbers = new Map<string, number>();
  let next = 1;
  const refs: Ref[] = [];
  for (const id of order) {
    if (!defined.has(id)) continue;
    let number = numbers.get(id);
    if (number === undefined) {
      number = next++;
      numbers.set(id, number);
    }
    refs.push({ label: id, number });
  }

  const defs: Ref[] = [];
  for (const [label, number] of numbers) defs.push({ label, number });
  defs.sort((a, b) => a.number - b.number);
  return { refs, defs };
}

/** 我们的实现结果 —— 被测 */
function inkstoneFootnotes(source: string): { refs: Ref[]; defs: Ref[] } {
  const model = findFootnotes(parseSyntax(source), source);
  return {
    refs: model.refs
      .filter((r) => r.number > 0)
      .map((r) => ({ label: r.label, number: r.number })),
    defs: model.defs
      .filter((d) => d.number > 0)
      .map((d) => ({ label: d.label, number: d.number }))
      .sort((a, b) => a.number - b.number),
  };
}

/**
 * 对拍语料。
 *
 * 覆盖三类：正常用法、边界规则、以及**当初写错过的坑**
 *（定义打断段落、定义体里的引用、行内代码、转义、4 空格缩进）。
 */
const CORPUS: [string, string][] = [
  ["基础", "正文[^1]。\n\n[^1]: 定义一\n"],
  ["引用顺序决定编号", "甲[^b]乙[^a]。\n\n[^a]: A 定义\n[^b]: B 定义\n"],
  ["定义顺序与引用顺序相反", "先提 a 后提 b\n\n[^b]: B\n[^a]: A\n"],
  ["同一脚注被引用两次", "A[^1] 和 B[^1]。\n\n[^1]: 定义\n"],
  ["没有定义的引用", "A[^missing]。\n"],
  ["没有被引用的定义", "正文。\n\n[^x]: 没人引用的定义\n"],
  ["大小写归一", "A[^Foo] B[^foo]\n\n[^foo]: 定义\n"],
  ["重复定义取首个", "A[^1]\n\n[^1]: 第一次\n[^1]: 第二次\n"],
  ["定义打断段落", "正文\n[^1]: 定义\n"],
  ["段落里连续多个定义", "正文\n[^1]: 甲\n[^2]: 乙\n"],
  ["定义体同行尾引用", "A[^1]\n\n[^1]: 定义[^2]\n[^2]: 二\n"],
  ["定义体缩进续行里的引用", "A[^1]\n\n[^1]: 第一行\n    见[^2]\n[^2]: 二\n"],
  ["定义体里的代码跨度不算引用", "A[^1]\n\n[^1]: `[^9]` 与 [^2]\n[^2]: 二\n"],
  ["行内代码不是引用", "行内代码 `[^1]` 不是脚注\n\n[^1]: 定义\n"],
  ["转义不是引用", "字面量 \\[^1] 不是脚注\n\n[^1]: 定义\n"],
  ["标签含空白不成立", "A[^  foo  ] B[^a  b]\n\n[^foo]: 定义\n"],
  ["空标签不成立", "A[^]\n\n[]: 定义\n"],
  ["未闭合不是引用", "A[^1 B[^2]\n\n[^1]: 定义\n"],
  ["四空格缩进是代码块", "A[^1]\n\n    [^1]: 缩进代码\n"],
  ["三空格缩进仍是定义", "A[^1]\n\n   [^1]: 缩进三\n"],
  ["围栏代码块里的不算定义", "```\n[^1]: 代码里的假定义\n```\n\n正文[^1]\n"],
  ["行内代码里的假定义不算", "正文\n\n    [^1]: 缩进代码\n\n正文[^1]\n"],
  ["标题里的引用", "# 标题 [^h]\n\n[^h]: 定义\n"],
  ["列表项里的引用", "- 项[^l]\n\n[^l]: 定义\n"],
  ["引用块里的引用与定义", "> 引用[^q]\n\n[^q]: 定义\n"],
  ["标签含特殊字符", "A[^a|b] B[^a:b] C[^a`b]\n\n[^a|b]: 一\n[^a:b]: 二\n[^a`b]: 三\n"],
  ["定义体跨多段", "A[^1]\n\n[^1]: 段一\n\n    段二\n"],
  ["中文内容", "正文[^汉]。\n\n[^汉]: 中文脚注，第二个[^二]。\n[^二]: 二号\n"],
  ["标签里带连字符下划线", "A[^a-b_c]\n\n[^a-b_c]: 定义\n"],
];

/**
 * 把装饰器集合摊平。
 *
 * widget 的 class 是它在 `toDOM()` 里加的，`spec` 上没有——
 * 所以只能按 widget 的**类型**判断（`instanceof`）。
 */
function collect(source: string, cursor: number): Decoration[] {
  const set = buildLivePreviewDecorations(
    source,
    cursor,
    "live",
    parseSyntax(source),
    {},
  );
  const out: Decoration[] = [];
  // `RangeSet.iter()` 返回的 RangeCursor 不是可迭代对象，要手动 next()
  const it = set.iter();
  while (it.value !== null) {
    const spec = it.value.spec as { widget?: unknown; class?: string };
    out.push({ from: it.from, to: it.to, widget: spec.widget, cls: spec.class });
    it.next();
  }
  return out;
}

describe("脚注编号与 remark-gfm 对拍", () => {
  for (const [name, source] of CORPUS) {
    it(name, () => {
      const expected = remarkFootnotes(source);
      const actual = inkstoneFootnotes(source);
      expect(actual).toEqual(expected);
    });
  }
});

describe("脚注定位", () => {
  const doc = "正文[^1]和[^note]。\n\n[^1]: 脚注一\n[^note]: 脚注二\n";
  const model = findFootnotes(parseSyntax(doc), doc);

  it("引用的区间正好是 `[^label]`", () => {
    expect(model.refs.map((r) => doc.slice(r.from, r.to))).toEqual(["[^1]", "[^note]"]);
  });

  it("定义的标记区间正好是 `[^label]:`", () => {
    expect(model.defs.map((d) => doc.slice(d.markerFrom, d.markerTo))).toEqual([
      "[^1]:",
      "[^note]:",
    ]);
  });

  it("引用的目标指向定义起点", () => {
    expect(model.refs[0].targetFrom).toBe(model.defs[0].from);
    expect(model.refs[1].targetFrom).toBe(model.defs[1].from);
  });

  it("定义记住第一个引用，供点定义跳回去", () => {
    expect(model.defs[0].firstRefFrom).toBe(model.refs[0].from);
    expect(model.defs[1].firstRefFrom).toBe(model.refs[1].from);
  });

  it("缩进不进标记区间（缩进要留在文档里）", () => {
    const indented = "A[^1]\n\n   [^1]: 缩进三\n";
    const m = findFootnotes(parseSyntax(indented), indented);
    expect(indented.slice(m.defs[0].markerFrom, m.defs[0].markerTo)).toBe("[^1]:");
  });

  it("定义块范围含缩进续行、不含尾部空行", () => {
    const doc2 = "A[^1]\n\n[^1]: 第一行\n    第二行\n\n正文结尾\n";
    const m = findFootnotes(parseSyntax(doc2), doc2);
    expect(doc2.slice(m.defs[0].from, m.defs[0].to)).toBe("[^1]: 第一行\n    第二行");
  });
});

describe("脚注装饰", () => {
  const doc = "正文[^1]。\n\n[^1]: 定义一\n";

  it("光标不在时：引用换 widget，定义挂样式", () => {
    const all = collect(doc, 0);
    expect(all.some((d) => d.widget instanceof FootnoteRefWidget)).toBe(true);
    expect(all.some((d) => d.cls === "cm-md-footnote-def")).toBe(true);
  });

  it("光标落进引用里 → 露出 `[^1]` 源码", () => {
    const all = collect(doc, doc.indexOf("[^1]") + 2);
    expect(all.some((d) => d.widget instanceof FootnoteRefWidget)).toBe(false);
  });

  it("光标落进定义里 → 露出 `[^1]:` 源码，但样式还在", () => {
    const all = collect(doc, doc.indexOf("[^1]:") + 2);
    expect(all.some((d) => d.widget instanceof FootnoteDefWidget)).toBe(false);
    expect(all.some((d) => d.cls === "cm-md-footnote-def")).toBe(true);
  });

  it("光标在定义正文里 → 编号标记仍然显示（只有标记本身才隐藏）", () => {
    const all = collect(doc, doc.indexOf("定义一") + 1);
    expect(all.some((d) => d.widget instanceof FootnoteDefWidget)).toBe(true);
  });

  it("widget 带跳转目标", () => {
    const ref = collect(doc, 0).find((d) => d.widget instanceof FootnoteRefWidget);
    const widget = ref?.widget as FootnoteRefWidget;
    expect(widget.target).toBe(doc.indexOf("[^1]:"));
    expect(widget.number).toBe(1);

    const def = collect(doc, 0).find((d) => d.widget instanceof FootnoteDefWidget);
    const defWidget = def?.widget as FootnoteDefWidget;
    expect(defWidget.target).toBe(doc.indexOf("[^1]"));
  });

  it("没有定义的引用不生成脚注 widget", () => {
    const orphan = "A[^missing]。\n";
    expect(collect(orphan, 0).some((d) => d.widget instanceof FootnoteRefWidget)).toBe(
      false,
    );
  });

  it("没有被引用的定义不生成编号标记", () => {
    const orphan = "正文。\n\n[^x]: 没人引用\n";
    expect(collect(orphan, 0).some((d) => d.widget instanceof FootnoteDefWidget)).toBe(
      false,
    );
  });
});

/**
 * lezer 会把 `[^1]和另一个[^note]` 合成**一个** `Link` 节点
 * （实测生产 DOM：`cm-md-link` 覆盖了 `^1]和另一个[^note`，两端方括号被当成
 * 链接括号藏掉，屏幕上出现 `^1]` 这种残缺文本）。
 * 脚注引用必须优先接管这个区间。
 */
describe("脚注与通用行内 Link 处理不打架", () => {
  const doc = "正文里有引用[^1]和另一个[^note]。\n\n[^1]: 甲\n[^note]: 乙\n";

  it("含脚注引用的 Link 节点不再走通用隐藏逻辑", () => {
    // 整篇文档不该出现任何链接样式
    expect(collect(doc, 0).some((d) => d.cls === "cm-md-link")).toBe(false);
  });

  it("两个引用各自拿到自己的编号 widget", () => {
    const widgets = collect(doc, 0).filter((d) => d.widget instanceof FootnoteRefWidget);
    expect(widgets.map((d) => (d.widget as FootnoteRefWidget).number)).toEqual([1, 2]);
    expect(doc.slice(widgets[0].from, widgets[0].to)).toBe("[^1]");
    expect(doc.slice(widgets[1].from, widgets[1].to)).toBe("[^note]");
  });

  it("普通链接不受影响", () => {
    const plain = "看这个[站点](https://example.com) 链接。\n";
    expect(collect(plain, 0).some((d) => d.cls === "cm-md-link")).toBe(true);
  });
});

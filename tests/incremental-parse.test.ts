/**
 * 增量语法树的护栏测试。
 *
 * 背景：M1 把 Live Preview 的 lezer 解析从「每击键全量重解析」改成「增量解析」
 *   （`src/editor/live-preview/syntax-tree.ts`）。增量解析省掉了 64%~72% 的管线成本，
 *   但它引入了一个新的风险：**增量结果与全量结果不一致**。
 *
 *   Markdown 的块级结构（缩进、列表层级、围栏代码块）依赖跨行的有状态上下文，
 *   增量解析理论上可能产出与全量不同的树。这类 bug 肉眼极难发现
 *   （表现是「某个 `**` 忽然不隐藏了」），所以必须在 CI 里锁死。
 *
 * 这里断言的是**逐节点结构完全一致**（节点类型 + 起止位置），
 * 而不是「看起来差不多」。
 */

import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { livePreviewField } from "@/editor/live-preview/state";
import { parseSyntax } from "@/editor/live-preview/syntax";
import { buildLivePreviewDecorations } from "@/editor/live-preview/decorations";
import type { Tree } from "@lezer/common";

/** 把语法树拍平成可比较的序列：节点类型 + 起止位置 */
function snapshot(tree: Tree): string[] {
  const out: string[] = [];
  tree.iterate({
    enter(ref) {
      out.push(`${ref.type.name}@${ref.from}-${ref.to}`);
    },
  });
  return out;
}

/** 确定性伪随机，保证测试可复现 */
function makeRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const BASE_DOC = `# 标题

这是一段带 **粗体** 和 *斜体* 的文字，还有 ` + "`行内代码`" + `。

- 列表项一
  - 嵌套列表项
- 列表项二

> 引用块
> 第二行

| 列 A | 列 B |
| --- | --- |
| 1 | 2 |

\`\`\`js
const x = 1;
\`\`\`

[链接](https://example.com "标题") 和 ![图片](img.png)

~~删除线~~ 和 ==高亮==

脚注[^1]

[^1]: 脚注内容
`;

describe("增量语法树", () => {
  it("文档变更后，增量树与全量树逐节点一致", () => {
    const rand = makeRandom(20261021);
    let state = EditorState.create({
      doc: BASE_DOC,
      extensions: [livePreviewField],
    });

    // 常见的破坏性编辑：插入标记符、插入结构化文本、删除片段
    const inserts = [
      "*",
      "`",
      "_",
      "~",
      "[",
      "]",
      "(",
      ")",
      "#",
      ">",
      "- ",
      " ",
      "\n",
      "**",
      "~~",
      "==",
      "`code`",
      "](url)",
      "\n\n",
      "```\n",
    ];

    for (let i = 0; i < 200; i++) {
      const len = state.doc.length;
      const at = Math.floor(rand() * len);
      const kind = rand();

      if (kind < 0.75) {
        const s = inserts[Math.floor(rand() * inserts.length)];
        state = state.update({ changes: { from: at, insert: s } }).state;
      } else {
        const del = Math.min(len - at, 1 + Math.floor(rand() * 12));
        state = state.update({ changes: { from: at, to: at + del } }).state;
      }

      const incremental = state.field(livePreviewField).tree;
      const full = parseSyntax(state.doc.toString());
      expect(snapshot(incremental)).toEqual(snapshot(full));
    }
  });

  it("纯选区变更不触发重新解析（树对象引用不变）", () => {
    const state = EditorState.create({
      doc: BASE_DOC,
      extensions: [livePreviewField],
    });

    const before = state.field(livePreviewField).tree;
    const after = state.update({ selection: { anchor: 10 } }).state;
    const afterTree = after.field(livePreviewField).tree;

    // 文档没变 → 不该重新解析，树对象应当是同一个
    expect(afterTree).toBe(before);
    expect(after.field(livePreviewField).fragments).toBe(
      state.field(livePreviewField).fragments,
    );
  });

  it("文档变更后树确实更新了（不是旧树的复用）", () => {
    const state = EditorState.create({
      doc: BASE_DOC,
      extensions: [livePreviewField],
    });

    const before = state.field(livePreviewField).tree;
    const after = state
      .update({ changes: { from: 0, to: 2, insert: "##" } })
      .state;
    const afterTree = after.field(livePreviewField).tree;

    expect(afterTree).not.toBe(before);
    expect(snapshot(afterTree)).toEqual(snapshot(parseSyntax(after.doc.toString())));
  });

  it("撤销后树回到修改前的状态", () => {
    let state = EditorState.create({
      doc: BASE_DOC,
      extensions: [livePreviewField],
    });
    const original = snapshot(state.field(livePreviewField).tree);

    state = state.update({ changes: { from: 0, insert: "x" } }).state;
    expect(snapshot(state.field(livePreviewField).tree)).not.toEqual(original);

    // 手工反向变更（不依赖 @codemirror/commands 的 history，保持测试聚焦）
    state = state.update({ changes: { from: 0, to: 1 } }).state;
    expect(snapshot(state.field(livePreviewField).tree)).toEqual(original);
  });

  it("大文档下，维护增量树比每次全量重解析便宜", () => {
    // 用语料拼一份大文档
    const big = Array.from({ length: 40 }, (_, i) =>
      BASE_DOC.replace("# 标题", `# 第 ${i + 1} 节`),
    ).join("\n\n---\n\n");

    /**
     * 编辑位置**从后往前**排。
     *
     * 两条路径要跑**同一串编辑**，位置必须对两边都成立——
     * 从后往前插，先插的不会让后面的位置偏移，
     * 于是「增量路径的第 i 次编辑」与「全量路径的第 i 次编辑」改的是同一处。
     */
    const edits = Array.from({ length: 10 }, (_, i) => {
      const at = Math.floor((big.length * (10 - i)) / 11);
      return { from: at, insert: "X" };
    });

    // ── 增量路径 ──────────────────────────────────────────────
    // 状态里挂着 livePreviewField：每次编辑后它用 TreeFragment 增量重解析。
    // 装饰器也要重算——只测解析是**半个账**，
    // 而真实的一次击键成本里，装饰器重算占大头。
    let incr = EditorState.create({
      doc: big,
      extensions: [livePreviewField],
    });
    const t0 = performance.now();
    for (const change of edits) {
      incr = incr.update({ changes: change }).state;
      buildLivePreviewDecorations(
        incr.doc.toString(),
        incr.selection.main.head,
        "live",
        incr.field(livePreviewField).tree,
      );
    }
    const incremental = performance.now() - t0;

    // ── 全量路径 ──────────────────────────────────────────────
    // 同样的编辑、同样的装饰器重算，唯一的区别是树从哪来：
    // 每次都从零把整篇重新解析一遍。
    let full = EditorState.create({ doc: big });
    const t1 = performance.now();
    for (const change of edits) {
      full = full.update({ changes: change }).state;
      const tree = parseSyntax(full.doc.toString());
      buildLivePreviewDecorations(
        full.doc.toString(),
        full.selection.main.head,
        "live",
        tree,
      );
    }
    const fullCost = performance.now() - t1;

    // 只断言「增量不快于全量」这个方向性结论，
    // 不写死具体倍数——CI 机器性能差异大，写死倍数会变成 flaky 测试。
    expect(incremental).toBeLessThanOrEqual(fullCost);
  });
});

/** 把装饰器集合摊平成可比较的数组（区间 + 类型 + class） */
function snapshotDecorations(state: EditorState, tree?: Tree): string[] {
  const set = buildLivePreviewDecorations(
    state.doc.toString(),
    state.selection.main.head,
    "live",
    tree ?? parseSyntax(state.doc.toString()),
  );
  const out: string[] = [];
  const it = set.iter();
  while (it.value !== null) {
    const spec = it.value.spec as { widget?: unknown; class?: string };
    out.push(
      `${it.from}-${it.to}:${spec.widget ? "replace" : "mark"}:${spec.class ?? ""}`,
    );
    it.next();
  }
  return out;
}

describe("增量路径与全量路径的装饰器一致性", () => {
  it("增量维护的树产出的装饰器与全量解析完全一致", () => {
    const rand = makeRandom(778899);

    // 增量路径：带 livePreviewField
    let incr = EditorState.create({
      doc: BASE_DOC,
      extensions: [livePreviewField],
    });
    // 全量路径：每次都现场全量解析
    let full = EditorState.create({ doc: BASE_DOC });

    const inserts = ["*", "`", "_", "~~", "**", "](x)", " ", "\n", "# ", "- "];

    for (let i = 0; i < 60; i++) {
      const at = Math.floor(rand() * incr.doc.length);
      const s = inserts[Math.floor(rand() * inserts.length)];

      incr = incr.update({ changes: { from: at, insert: s } }).state;
      full = full.update({ changes: { from: at, insert: s } }).state;

      const incrTree = incr.field(livePreviewField).tree;
      const fullTree = parseSyntax(full.doc.toString());

      // 光标位置也要跟着走，否则两边的展开状态不同
      const cursor = at + s.length;
      const incrSel = incr.update({ selection: { anchor: cursor } }).state;
      const fullSel = full.update({ selection: { anchor: cursor } }).state;

      expect(snapshotDecorations(incrSel, incrTree)).toEqual(
        snapshotDecorations(fullSel, fullTree),
      );
    }
  });

  it("真实 EditorView 里打字后，标记仍然正确隐藏与展开", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const view = new EditorView({
      state: EditorState.create({
        doc: "这是 **粗体** 和 *斜体* 文字。",
        extensions: [livePreviewField],
      }),
      parent: host,
    });

    // 初始：光标在文档开头，两个标记都应隐藏
    const initial = snapshotDecorations(view.state, view.state.field(livePreviewField).tree);
    const hiddenCount = initial.filter((d) => d.includes(":replace:")).length;
    expect(hiddenCount).toBe(4); // ** × 2 + * × 2

    // 光标进入粗体内部 → 粗体标记应当显露
    // 位置：这是 **粗体** 和 *斜体* 文字。
    //        0123456789...
    // "粗"字在位置 5，落在 StrongEmphasis（3..8）内且 > 3
    view.dispatch({ selection: { anchor: 5 } });
    const inBold = snapshotDecorations(view.state, view.state.field(livePreviewField).tree);
    const stillHidden = inBold.filter((d) => d.includes(":replace:")).length;
    expect(stillHidden).toBe(2); // 只剩斜体的两个 *

    // 在**结构之外**（文档末尾）敲一个字，触发增量解析
    // → 前面结构的标记状态与区间都应当保持不变
    view.dispatch({ changes: { from: view.state.doc.length, insert: "新" } });
    const afterType = snapshotDecorations(view.state, view.state.field(livePreviewField).tree);
    expect(afterType).toEqual(inBold);

    view.destroy();
    host.remove();
  });

  it("在结构内部打字会改变结构，增量解析要跟上", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const view = new EditorView({
      state: EditorState.create({
        doc: "这是 **粗体** 和 *斜体* 文字。",
        extensions: [livePreviewField],
      }),
      parent: host,
    });

    // 在粗体的第一个 `*` 之后插入字符 → `**` 被打断，结构变成斜体
    view.dispatch({ changes: { from: 4, insert: "新" } });
    const deco = snapshotDecorations(view.state, view.state.field(livePreviewField).tree);

    // 文档变成 "这是 *新*粗体** 和 *斜体* 文字。"
    // → "*新*" 是斜体（1 组 replace），原来的 ** 变成字面文本
    const replaces = deco.filter((d) => d.includes(":replace:"));
    expect(replaces.length).toBe(4); // 两组斜体标记
    expect(deco.some((d) => d.includes("cm-md-strong"))).toBe(false);

    // 与全量解析的结果必须一致
    const fullState = EditorState.create({ doc: view.state.doc.toString() });
    expect(deco).toEqual(
      snapshotDecorations(fullState, parseSyntax(view.state.doc.toString())),
    );

    view.destroy();
    host.remove();
  });
});

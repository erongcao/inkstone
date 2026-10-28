/**
 * Live Preview 装饰器管线的分步性能基准。
 *
 * 目的：回答「M1 待办『lezer 增量解析 + 装饰器按可见区缓存』到底该优化哪一段？」
 *
 * 当前 `buildLivePreviewDecorations()` 每击键做五件事：
 *   1. `state.doc.toString()`   —— 全量取出文档字符串
 *   2. `parseSyntax(text)`      —— lezer 全量解析
 *   3. `tree.iterate()` × 3     —— 三次全树遍历
 *   4. 逐节点构造 Decoration    —— 每个节点创建一个装饰器对象
 *   5. `Decoration.set()`       —— 构建 RangeSet
 *
 * 实测这五段各占多少，才知道增量解析能省下多少、
 * 以及「装饰器按可见区缓存」是不是更大的那一块。
 *
 * 运行：pnpm exec tsx scripts/bench-decorations.ts
 */

import { EditorState } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { parser as baseParser } from "@lezer/markdown";
import { GFM } from "@lezer/markdown";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildLivePreviewDecorations } from "../src/editor/live-preview/decorations";
import { livePreviewField } from "../src/editor/live-preview/state";
import { installDomStub } from "./dom-stub";

// 装饰器管线现在会构造真实 DOM（图片 / 表格工具栏 / 代码高亮块）。
// Node 里没有 `document`，不装 stub 的话脚本会在第一张图片处整个崩掉——
// 那样 AGENTS.md 里那批性能数字就无法复现。理由见 dom-stub.ts。
installDomStub();

const corpusDir = join(process.cwd(), "tests/corpus");
const gfmParser = baseParser.configure(GFM);

function bench(label: string, iterations: number, fn: () => void) {
  for (let i = 0; i < 3; i++) fn();
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const p50 = samples[Math.floor(samples.length * 0.5)];
  const p95 = samples[Math.floor(samples.length * 0.95)];
  console.log(
    "    " +
      label.padEnd(34) +
      " p50=" +
      p50.toFixed(2) +
      "ms  p95=" +
      p95.toFixed(2) +
      "ms",
  );
  return p50;
}

/** 拼一份指定行数的大文档（用真实语料反复拼） */
function buildLargeDoc(lines: number): string {
  const parts: string[] = [];
  for (const f of [
    "01-basic.md",
    "06-chinese-technical-writing.md",
    "07-links-and-images.md",
    "12-typora-extensions.md",
  ]) {
    const p = join(corpusDir, f);
    if (existsSync(p)) parts.push(readFileSync(p, "utf8"));
  }
  const chunk = parts.join("\n\n---\n\n");
  let out = "";
  let i = 0;
  while (out.split("\n").length < lines) {
    out += chunk.replace(/^# /gm, `# 第 ${i + 1} 节 `);
    i++;
  }
  return out;
}

console.log("\n=== Live Preview 装饰器管线分步基准 ===\n");

/** 收集「局部重建」要用的数据，最后一并汇报 */
const summary: {
  lines: number;
  kb: number;
  keystroke: number;
  decoCost: number;
  incremental: number;
}[] = [];

for (const lines of [500, 1500, 4000, 8000]) {
  const doc = buildLargeDoc(lines);
  const state = EditorState.create({ doc, selection: { anchor: 0 } });
  const text = state.doc.toString();

  // 统计规模
  const tree = gfmParser.parse(text);
  let nodeCount = 0;
  tree.iterate({
    enter: () => {
      nodeCount++;
    },
  });

  console.log(
    "\n【" +
      lines +
      " 行 / " +
      (Buffer.byteLength(doc) / 1024).toFixed(0) +
      " KB / " +
      nodeCount +
      " 个语法节点】",
  );

  // 1. 取字符串
  bench("1. doc.toString()", 30, () => {
    state.doc.toString();
  });

  // 2. 全量解析
  bench("2. lezer 全量解析", 30, () => {
    gfmParser.parse(text);
  });

  // 3. 遍历树
  bench("3. tree.iterate() ×3", 30, () => {
    for (let k = 0; k < 3; k++) {
      tree.iterate({ enter: () => {} });
    }
  });

  // 4+5. 完整管线
  bench("4+5. 完整 buildLivePreviewDecorations", 30, () => {
    buildLivePreviewDecorations(text, 0, "live", tree);
  });

  // 单独看装饰器构造
  const decoCount = (() => {
    const set = buildLivePreviewDecorations(text, 0, "live", tree);
    let n = 0;
    const it = set.iter();
    while (it.value !== null) {
      n++;
      it.next();
    }
    return n;
  })();
  console.log("    → 产出装饰器 " + decoCount + " 个");

  bench("     仅 Decoration.set 构建", 30, () => {
    Decoration.set([], true);
  });

  // ---- 真实击键路径对比：全量 vs 增量 ----
  //
  // 「全量」= 旧实现：每次击键 doc.toString() + lezer 全量解析 + 重建全部装饰器
  // 「增量」= 新实现：StateField 里增量解析 + 复用同一份树重建装饰器
  const at = Math.floor(doc.length / 2);
  const plainState = EditorState.create({ doc, selection: { anchor: 0 } });
  const incrState = EditorState.create({
    doc,
    selection: { anchor: 0 },
    extensions: [livePreviewField],
  });

  bench("  [全量] 一次击键：解析 + 装饰器", 30, () => {
    const next = plainState.update({ changes: { from: at, insert: "X" } }).state;
    const nextText = next.doc.toString();
    buildLivePreviewDecorations(nextText, 0, "live", gfmParser.parse(nextText));
  });

  bench("  [增量] 一次击键：解析 + 装饰器", 30, () => {
    const next = incrState.update({ changes: { from: at, insert: "X" } }).state;
    const lp = next.field(livePreviewField);
    buildLivePreviewDecorations(lp.source, lp.cursor, "live", lp.tree);
  });

  // 收集「局部重建」的收益上限要用到的两个数：
  //   keystroke —— 增量路径一次击键的总成本
  //   decoCost   —— 其中「重建全部装饰器」占掉多少
  //              （局部重建理想情况下能省掉这一块的 99%）
  const keystroke = bench("  [增量] 复测（取样用）", 30, () => {
    const next = incrState.update({ changes: { from: at, insert: "X" } }).state;
    const lp = next.field(livePreviewField);
    buildLivePreviewDecorations(lp.source, lp.cursor, "live", lp.tree);
  });
  const decoCost = bench("  [增量] 其中：重建全部装饰器", 30, () => {
    const lp = incrState.field(livePreviewField);
    buildLivePreviewDecorations(lp.source, lp.cursor, "live", lp.tree);
  });
  summary.push({
    lines,
    kb: Buffer.byteLength(doc) / 1024,
    keystroke,
    decoCost,
    incremental: keystroke,
  });
}

console.log("\n=== 「装饰器局部重建」的收益上限 ===");
console.log("  （理想化假设：只重建变动的那一个块，装饰器成本降到 1%）\n");
console.log(
  "  " +
    "规模".padEnd(16) +
    "一次击键".padEnd(12) +
    "其中装饰器".padEnd(14) +
    "局部重建后".padEnd(14) +
    "占 16ms 预算",
);
for (const row of summary) {
  const ideal = row.keystroke - row.decoCost * 0.99;
  console.log(
    "  " +
      `${row.lines} 行 / ${row.kb.toFixed(0)} KB`.padEnd(14) +
      `${row.keystroke.toFixed(2)}ms`.padEnd(13) +
      `${row.decoCost.toFixed(2)}ms`.padEnd(15) +
      `${ideal.toFixed(2)}ms`.padEnd(15) +
      `${((row.keystroke / 16) * 100).toFixed(0)}% → ${((ideal / 16) * 100).toFixed(0)}%`,
  );
}

console.log("\n=== 结论参考 ===");
console.log("  交互预算 16ms（60fps）");
console.log("  若「完整管线」远低于预算 → 大文档也不是瓶颈，优先做正确性");
console.log("  若装饰器数量随行数线性增长 → 「按可见区缓存」收益最大\n");

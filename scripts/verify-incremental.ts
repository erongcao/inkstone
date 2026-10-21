/**
 * 增量解析正确性验证（lezer / @lezer/markdown）
 *
 * 背景：M1 待办「lezer 增量解析（TreeEditor）」。
 *   计划书原文写的是用 `TreeEditor`，但实测发现 **lezer 生态里没有这个类**——
 *   真正的增量入口是 `Parser.parse(input, fragments, ranges)`，
 *   配套 `TreeFragment.addTree` / `TreeFragment.applyChanges`。
 *   CM6 官方（`@codemirror/language` 的 `ParseContext.changes`）走的就是这条路。
 *
 * 关键问题：**@lezer/markdown 的增量解析结果，是否与全量解析一致？**
 *   Markdown 的块级结构（缩进、列表层级、围栏代码块）依赖跨行有状态上下文，
 *   增量解析理论上可能产出与全量不同的树。这个脚本用随机编辑做大规模对拍来回答。
 *
 * 运行：pnpm exec tsx scripts/verify-incremental.ts
 */

import { parser as baseParser } from "@lezer/markdown";
import { GFM } from "@lezer/markdown";
import { TreeFragment, type Tree } from "@lezer/common";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// 基准目录用 process.cwd()（脚本约定从仓库根运行），避免 tsx 下 import.meta.url 的差异
const corpusDir = join(process.cwd(), "tests/corpus");
const gfmParser = baseParser.configure(GFM);

/** 把语法树拍平成可比较的序列：节点类型 + 起止位置 */
function snapshot(tree: Tree): string[] {
  const out: string[] = [];
  tree.iterate({
    enter(ref) {
      out.push(ref.type.name + "@" + ref.from + "-" + ref.to);
    },
  });
  return out;
}

/** 对比两棵树，返回第一个差异的位置描述 */
function diff(a: string[], b: string[]): string | null {
  if (a.length !== b.length) {
    return "节点数不同：增量=" + a.length + " 全量=" + b.length;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return "第 " + i + " 个节点不同：增量=" + a[i] + " 全量=" + b[i];
    }
  }
  return null;
}

/** 一次随机编辑：返回新文本 + lezer 风格的变更范围 */
interface Edit {
  newText: string;
  ranges: { fromA: number; toA: number; fromB: number; toB: number }[];
}

function randomEdit(text: string, rand: () => number): Edit {
  const at = Math.floor(rand() * text.length);
  const kind = rand();

  if (kind < 0.35) {
    // 插入单个标记字符（最容易改变结构的编辑）
    const chars = ["*", "`", "_", "~", "[", "]", "(", ")", "#", ">", "-", " ", "\n"];
    const c = chars[Math.floor(rand() * chars.length)];
    return {
      newText: text.slice(0, at) + c + text.slice(at),
      ranges: [{ fromA: at, toA: at, fromB: at, toB: at + c.length }],
    };
  }

  if (kind < 0.7) {
    // 插入一段有结构的文本
    const inserts = ["**", "~~", "==", "`code`", "](url)", "\n\n", "- ", "1. ", "# ", "> ", "```\n"];
    const s = inserts[Math.floor(rand() * inserts.length)];
    return {
      newText: text.slice(0, at) + s + text.slice(at),
      ranges: [{ fromA: at, toA: at, fromB: at, toB: at + s.length }],
    };
  }

  // 删除一段
  const len = Math.min(text.length - at, 1 + Math.floor(rand() * 10));
  return {
    newText: text.slice(0, at) + text.slice(at + len),
    ranges: [{ fromA: at, toA: at + len, fromB: at, toB: at }],
  };
}

/** 确定性伪随机（保证结果可复现） */
function makeRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const CORPUS_FILES = [
  "01-basic.md",
  "06-chinese-technical-writing.md",
  "07-links-and-images.md",
  "08-quotes-and-nested-lists.md",
  "12-typora-extensions.md",
];

function loadCorpus(): string {
  const parts: string[] = [];
  for (const f of CORPUS_FILES) {
    const p = join(corpusDir, f);
    if (!existsSync(p)) {
      console.warn("  [warn] 语料缺失：" + p);
      continue;
    }
    parts.push(readFileSync(p, "utf8"));
  }
  return parts.join("\n\n---\n\n");
}

console.log("\n=== @lezer/markdown 增量解析一致性验证 ===\n");

const base = loadCorpus();
console.log(
  "语料规模：" + base.length + " 字符 / " + base.split("\n").length + " 行\n",
);

if (base.length === 0) {
  console.error("语料为空，无法验证。请检查 tests/corpus/ 与运行目录。\n");
  process.exit(1);
}

// ---- 第一部分：随机编辑对拍 ----
for (const seed of [1, 42, 2026]) {
  const rand = makeRandom(seed);
  let text = base;
  let tree = gfmParser.parse(text);
  let fragments: readonly TreeFragment[] = TreeFragment.addTree(tree);

  let mismatch = 0;
  let firstDiff: string | null = null;
  const ROUNDS = 300;

  for (let i = 0; i < ROUNDS; i++) {
    const edit = randomEdit(text, rand);

    // 增量路径
    fragments = TreeFragment.applyChanges(fragments, edit.ranges);
    const incrTree = gfmParser.parse(edit.newText, fragments);

    // 全量路径
    const fullTree = gfmParser.parse(edit.newText);

    const d = diff(snapshot(incrTree), snapshot(fullTree));
    if (d) {
      mismatch++;
      if (!firstDiff) {
        firstDiff =
          "  第 " + i + " 轮编辑后不一致：" + d +
          "\n  编辑位置：" + JSON.stringify(edit.ranges);
      }
    }

    text = edit.newText;
    tree = incrTree;
    fragments = TreeFragment.addTree(tree);
  }

  const rate = ((mismatch / ROUNDS) * 100).toFixed(1);
  console.log(
    "  seed=" + String(seed).padEnd(5) + " " + ROUNDS + " 轮随机编辑：不一致 " +
    mismatch + " 次（" + rate + "%）",
  );
  if (firstDiff) console.log(firstDiff);
}

// ---- 第二部分：性能对比 ----
const big = base.repeat(6);
console.log(
  "\n  性能对比文档：" + big.length + " 字符 / " + big.split("\n").length + " 行\n",
);

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
    "    " + label.padEnd(30) + " p50=" + p50.toFixed(2) + "ms  p95=" + p95.toFixed(2) + "ms",
  );
}

const tree = gfmParser.parse(big);
const fragments: readonly TreeFragment[] = TreeFragment.addTree(tree);
const at = Math.floor(big.length / 2);
const mutated = big.slice(0, at) + "X" + big.slice(at);
const changeRanges = [{ fromA: at, toA: at, fromB: at, toB: at + 1 }];

bench("全量解析", 30, () => {
  gfmParser.parse(mutated);
});

bench("增量解析（applyChanges+parse）", 30, () => {
  const f = TreeFragment.applyChanges(fragments, changeRanges);
  gfmParser.parse(mutated, f);
});

console.log("\n=== 结论 ===");
console.log("  若随机编辑对拍 0% 不一致 → 可以安全使用增量解析");
console.log("  若存在不一致 → @lezer/markdown 的块级上下文不支持增量，必须走别的路子\n");

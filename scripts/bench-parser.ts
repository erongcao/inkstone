/**
 * 编辑器内核选型的性能基准（M1 spike）
 *
 * 目的：用实测数据回答三个决定性问题
 *   1. remark 每次击键全量重解析能不能撑住？（决定 Live Preview 装饰器能否只用 remark 一个解析器）
 *   2. lezer/markdown 增量解析快多少？（作为备选或补充）
 *   3. 装饰器构建本身的开销有多大？
 *
 * 运行：pnpm exec vitest run tests/perf.bench.ts --reporter=verbose
 * 或： node --experimental-strip-types scripts/bench-parser.ts
 */

import { performance } from "node:perf_hooks";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { unified } from "unified";
import { parser as lezerParser } from "@lezer/markdown";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const corpusDir = join(dirname(fileURLToPath(import.meta.url)), "../tests/corpus");

/** 拼一份 1000 行的大文档 */
function buildLargeDoc(lines: number): string {
  const base = readFileSync(join(corpusDir, "01-basic.md"), "utf8");
  const chunk = `${base}\n\n---\n\n`;
  let out = "";
  let i = 0;
  while (out.split("\n").length < lines) {
    out += chunk.replace("# 基础语法样例", `# 第 ${i + 1} 节`);
    i++;
  }
  return out;
}

function bench(label: string, iterations: number, fn: () => void) {
  // 预热
  for (let i = 0; i < Math.min(5, iterations); i++) fn();

  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const p50 = samples[Math.floor(samples.length * 0.5)];
  const p95 = samples[Math.floor(samples.length * 0.95)];
  const max = samples[samples.length - 1];
  console.log(
    `  ${label.padEnd(34)} p50=${p50.toFixed(2)}ms  p95=${p95.toFixed(2)}ms  max=${max.toFixed(2)}ms`,
  );
  return { p50, p95, max };
}

console.log("\n=== Markdown 解析性能基准 ===\n");

const remark = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const lezer = lezerParser;

for (const lines of [200, 1000, 3000]) {
  const doc = buildLargeDoc(lines);
  const sizeKb = (Buffer.byteLength(doc) / 1024).toFixed(0);
  console.log(`\n【${lines} 行 / ${sizeKb} KB 文档】`);

  bench("remark 全量解析", 20, () => {
    remark.parse(doc);
  });

  bench("lezer/markdown 全量解析", 20, () => {
    lezer.parse(doc);
  });

  // 模拟真实击键：改一个字符后重解析
  const mutated = doc.slice(0, 100) + "X" + doc.slice(101);
  bench("remark 解析（改 1 字符后）", 20, () => {
    remark.parse(mutated);
  });
  bench("lezer 解析（改 1 字符后）", 20, () => {
    lezer.parse(mutated);
  });
}

console.log("\n=== 结论参考 ===");
console.log("  交互式编辑的延迟预算是 16ms（60fps）");
console.log("  remark 若 p95 > 8ms，则不能每击键全量重解析");
console.log("  lezer 增量重解析通常只需重扫受影响区间\n");

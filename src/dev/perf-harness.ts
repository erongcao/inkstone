/**
 * Live Preview 性能测量台（开发用）。
 *
 * 目的：在**真实浏览器**里测「一次击键 → 浏览器绘制完成」的延迟。
 *   node 侧的基准（`scripts/bench-decorations.ts`）只能测到 JS 计算成本，
 *   测不到 CM6 的 DOM 更新成本——而装饰器数量（数千个）恰恰主要影响后者。
 *
 * 页面入口：`perf.html`（vite dev 下访问 /perf.html）
 *   这个 html 不在 vite build 的默认入口列表里，因此**不会进生产包**。
 */

import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { history } from "@codemirror/commands";
import { livePreview } from "@/editor/live-preview";
import { buildLivePreviewDecorations } from "@/editor/live-preview/decorations";
import { syntaxTreeField } from "@/editor/live-preview/syntax-tree";

/** 生成一份带各种行内标记的 Markdown 文档 */
function makeDoc(paragraphs: number): string {
  const chunk = [
    "# 章节标题",
    "",
    "这是一段包含 **粗体文字**、*斜体文字*、`行内代码` 和 ~~删除线~~ 的正文。",
    "",
    '还有 [一个链接](https://example.com "链接标题") 以及 ==高亮文本==。',
    "",
    "- 列表项一",
    "- 列表项二，含 **加粗**",
    "",
    "> 引用块，里面也有 *斜体*。",
    "",
    "```js",
    "const answer = 42;",
    "```",
    "",
  ].join("\n");

  const parts: string[] = [];
  for (let i = 0; i < paragraphs; i++) {
    parts.push(chunk.replace("# 章节标题", `# 第 ${i + 1} 节`));
  }
  return parts.join("\n---\n\n");
}

interface Sample {
  sync: number;
  toPaint: number;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

/**
 * 连续测 N 次「击键」。
 *
 * - `sync`  = dispatch 同步返回的耗时（JS 工作量：解析 + 装饰器构建 + DOM 更新）
 * - `toPaint`= dispatch 之后到**下一帧绘制开始**的耗时（含浏览器渲染）
 */
function measureTyping(view: EditorView, count: number): Promise<Sample[]> {
  const samples: Sample[] = [];
  const pos = Math.floor(view.state.doc.length / 2);

  return new Promise((resolve) => {
    let i = 0;
    const step = () => {
      if (i >= count) {
        resolve(samples);
        return;
      }
      const t0 = performance.now();
      view.dispatch({ changes: { from: pos, insert: "字" } });
      const t1 = performance.now();
      requestAnimationFrame(() => {
        const t2 = performance.now();
        samples.push({ sync: t1 - t0, toPaint: t2 - t0 });
        // 撤销这次插入，保持文档长度不变
        view.dispatch({ changes: { from: pos, to: pos + 1 } });
        i++;
        step();
      });
    };
    step();
  });
}

async function runScenario(
  label: string,
  paragraphs: number,
  parent: HTMLElement,
): Promise<string[]> {
  const doc = makeDoc(paragraphs);
  const state = EditorState.create({
    doc,
    extensions: [history(), lineNumbers(), highlightActiveLine(), livePreview()],
  });
  const view = new EditorView({ state, parent });

  // 预热：让浏览器完成首次布局与装饰器渲染
  view.dispatch({ selection: { anchor: 0 } });
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  // 统计装饰器数量
  const tree = view.state.field(syntaxTreeField).tree;
  const decoSet = buildLivePreviewDecorations(view.state, "live", tree);
  let decoCount = 0;
  const it = decoSet.iter();
  while (it.value !== null) {
    decoCount++;
    it.next();
  }

  const samples = await measureTyping(view, 40);

  const sync = samples.map((s) => s.sync);
  const toPaint = samples.map((s) => s.toPaint);

  view.destroy();

  return [
    `【${label}】`,
    `  文档：${doc.length} 字符 / ${doc.split("\n").length} 行 / ${decoCount} 个装饰器`,
    `  dispatch 同步耗时   p50=${percentile(sync, 0.5).toFixed(2)}ms  p95=${percentile(sync, 0.95).toFixed(2)}ms  max=${Math.max(...sync).toFixed(2)}ms`,
    `  击键→下一帧绘制    p50=${percentile(toPaint, 0.5).toFixed(2)}ms  p95=${percentile(toPaint, 0.95).toFixed(2)}ms  max=${Math.max(...toPaint).toFixed(2)}ms`,
    "",
  ];
}

async function main() {
  const out = document.getElementById("out");
  const parent = document.getElementById("ed");
  if (!out || !parent) throw new Error("测量台缺少 #out / #ed 容器");
  const lines: string[] = [];

  lines.push("=== Live Preview 击键延迟实测（真实浏览器）===\n");

  for (const [label, paragraphs] of [
    ["小文档", 5],
    ["中文档", 60],
    ["大文档", 400],
  ] as const) {
    lines.push(...(await runScenario(label, paragraphs, parent)));
  }

  lines.push("交互预算参考：16ms = 60fps 的单帧预算");

  if (out) out.textContent = lines.join("\n");
  // 供自动化读取
  document.title = "PERF-DONE";
}

void main();

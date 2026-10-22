/**
 * Markdown 解析器的按需加载入口。
 *
 * 为什么要一个单独的门面，而不是直接 `import { parseMarkdown } from "./markdown"`：
 *   remark 管线（unified + remark-parse + gfm + math + stringify）约 132 KB，
 *   而编辑器**每击键**走的是 lezer、不是 remark——只有低频路径才需要 remark：
 *     - HTML 渲染（复制为 HTML、表格单元格渲染）
 *     - 公式相关（KaTeX 与公式定位共用同一个 chunk）
 *     - **AI 上下文切片**
 *   直接静态引入会把 132 KB 塞进主 chunk，拖慢冷启动。
 *
 * 与 `math-loader.ts` 的关系：两者都动态引入 `markdown.ts`，
 * rolldown 会把它放进共享 chunk，只下载一次。
 *
 * 为什么 AI 上下文切片值得走 remark 而不是 lezer：
 *   lezer 是为了「每击键都重算」而存在的，而 AI 动作是**用户点一次跑一次**。
 *   1000 行文档 remark 全量解析 p95 ≈ 11ms——在点击的语境里完全不可感知，
 *   却能保证「段落」「章节」的边界和语义层完全一致（架构约束 C）。
 *   用 lezer 反而会引入一次「编辑器认一套、导出认另一套」的风险。
 */

import type { MarkdownAst } from "./markdown";
import type { ParseOptions } from "./markdown";

type ParseFn = (source: string, options?: ParseOptions) => MarkdownAst;

let parse: ParseFn | null = null;
let pending: Promise<ParseFn> | null = null;

const listeners = new Set<() => void>();

function load(): Promise<ParseFn> {
  if (parse) return Promise.resolve(parse);
  if (pending) return pending;
  pending = import("./markdown")
    .then((mod) => {
      parse = mod.parseMarkdown;
      for (const notify of listeners) notify();
      return parse;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** 预加载解析器（应用启动后空闲时调用） */
export function primeMarkdownParser(): void {
  void load().catch(() => {
    /* 预加载失败不影响主流程：用到时再加载一次 */
  });
}

/** 等待解析器就绪 */
export function ensureMarkdownParser(): Promise<ParseFn> {
  return load();
}

/** 解析器是否已就绪 */
export function isMarkdownParserReady(): boolean {
  return parse !== null;
}

/**
 * 同步解析。
 *
 * @returns 解析器还没加载完时返回 null——调用方应据此放弃本次操作，
 *          而不是退回自己那套正则（那会破红线 C）。
 */
export function parseMarkdownSync(
  source: string,
  options?: ParseOptions,
): MarkdownAst | null {
  if (!parse) return null;
  try {
    return parse(source, options);
  } catch {
    return null;
  }
}

/** 订阅「解析器就绪」事件，返回取消订阅函数 */
export function onMarkdownParserReady(listener: () => void): () => void {
  if (parse) {
    listener();
    return () => {};
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

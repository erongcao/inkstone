/**
 * 改写与总结的动作定义。
 *
 * 每种动作 = **一句用户指令 + 一个固定的 system 提示**。
 * 保持它们短是有意的：提示词越长越容易让小模型跑偏，
 * 而且用户在设置里可以整体改写 system 提示（见 `settings/schema.ts`）。
 *
 * 契约（`docs/ai-design.md` D16）：
 *   **AI 结果一律不直接覆盖用户文本。** 调用方拿到结果后先预览，
 *   用户点了「替换」才 dispatch 一个普通事务——可撤销、落进 Markdown 文本。
 */

import type { ChatRequest } from "./provider";
import type { ContextSlice } from "./context";

/** 改写动作 */
export type RewriteAction = "polish" | "expand" | "shorten" | "translate" | "formalize";

export const REWRITE_LABELS: Record<RewriteAction, string> = {
  polish: "润色",
  expand: "扩写",
  shorten: "缩写",
  translate: "翻译成中文",
  formalize: "改写为正式语气",
};

/** 每种改写动作给模型的具体指令 */
const REWRITE_INSTRUCTIONS: Record<RewriteAction, string> = {
  polish: "润色这段文字：修正错别字与病句，让表达更清晰，但不要改变原意与信息量。",
  expand: "扩写这段文字：补充合理的细节与例证，保持原有结构，不要凭空编造事实或数据。",
  shorten: "缩写这段文字：删掉冗余与重复表达，保留全部关键信息，篇幅约减半。",
  translate: "把这段文字翻译成中文。保留原有的 Markdown 结构（列表层级、代码块、公式）。",
  formalize: "把这段文字改写为正式的书面语气：去掉口语与情绪化表达，用词准确、结构清晰。",
};

/** 总结动作 */
export type SummarizeAction = "one-line" | "outline" | "tags" | "key-points";

export const SUMMARIZE_LABELS: Record<SummarizeAction, string> = {
  "one-line": "一句话摘要",
  outline: "生成大纲",
  tags: "生成标签",
  "key-points": "提炼要点",
};

const SUMMARIZE_INSTRUCTIONS: Record<SummarizeAction, string> = {
  "one-line": "用一句话概括这份文档的要点。只输出这一句话，不要前缀。",
  outline: "为这份文档生成一份 Markdown 大纲（用 # 标题层级），只输出大纲本身。",
  tags: "为这份文档生成 3–8 个关键词标签，用逗号分隔。只输出标签，不要解释。",
  "key-points": "提炼这份文档的关键要点，用 Markdown 无序列表输出，只输出列表本身。",
};

/** 把上下文包成用户消息 */
function userMessage(ctx: ContextSlice, instruction: string): string {
  // 给了标题就把标题一并告知模型，否则它不知道这段是什么内容
  const header = ctx.title ? `（所属章节：${ctx.title}）\n\n` : "";
  return `${header}${instruction}\n\n---\n${ctx.text}\n---`;
}

/** 构造一次改写请求 */
export function buildRewriteRequest(
  action: RewriteAction,
  ctx: ContextSlice,
  systemPrompt: string,
): ChatRequest {
  return {
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage(ctx, REWRITE_INSTRUCTIONS[action]) }],
  };
}

/** 构造一次总结请求 */
export function buildSummarizeRequest(
  action: SummarizeAction,
  ctx: ContextSlice,
  systemPrompt: string,
): ChatRequest {
  return {
    system: systemPrompt,
    messages: [
      { role: "user", content: userMessage(ctx, SUMMARIZE_INSTRUCTIONS[action]) },
    ],
  };
}

/**
 * 清洗模型返回的 Markdown 文本。
 *
 * 模型经常无视「只输出改写结果」的要求，裹上 ```markdown 代码块、
 * 或者加一句「好的，这是改写后的版本：」。这些前缀后缀写进
 * 用户笔记里是很糟的体验，所以在这里统一剥掉。
 *
 * 注意只剥**包裹形式**，不改内容本身——
 * 模型返回的正文里本来就可能有合法的代码块，不能一刀切。
 */
export function cleanModelOutput(raw: string): string {
  let text = raw.trim();

  // 整体被一个代码块裹住
  const fenced = /^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n?```$/.exec(text);
  if (fenced) text = fenced[1].trim();

  // 常见的客套前缀
  text = text.replace(
    /^(好的[，,]?\s*)?(这是|以下是|下面是)(改写|润色|扩写|缩写|翻译|改写后|润色后)?(的)?(结果|版本|内容)?[：:]\s*/,
    "",
  );
  // 「以下是改写后的 Markdown：」这类变体，上面那条覆盖不到，再兜一层
  text = text.replace(/^(好的[，,]?\s*)?以下是[^：:\n]{0,20}[：:]\s*/, "");

  return text.trim();
}

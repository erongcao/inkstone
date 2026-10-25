/**
 * 开发期的 AI mock（只在浏览器开发模式生效）。
 *
 * ## 为什么需要它
 *
 * 「流式 → 预览 → 接受 → 可撤销」这条链路是红线 1 与 D16 的落点，
 * 但它要跑到最后一步就需要一次**真实的**模型响应——
 * 而验收时手上没有 API Key，也不该为了看一眼界面就把密钥配到本机。
 *
 * 所以这里放一个 mock runner：它按关键词挑一段 canned 输出，
 * 分块喂给面板，看起来和真的一模一样。
 *
 * ## 不会进生产包
 *
 * `main.tsx` 里用 `import.meta.env.DEV` 包着动态 import，
 * 生产构建时它是 `false`，整段会被摇掉。
 * 入口是 URL 参数 `?ai-mock=1`——不带参数就完全不介入。
 */

import { setAiRunner, type AiRunner } from "@/ai/panel-store";
import type { ChatRequest, EndpointConfig } from "@/ai/provider";

/**
 * 按用户消息里的指令挑一段输出。
 *
 * 匹配的是 `actions.ts` 里那些固定的指令句——
 * 那是改写 / 总结两类动作唯一稳定的特征。
 */
const RULES: [RegExp, string][] = [
  [/润色/, "这是润色后的结果：句子更通顺了，信息量保持不变。\n\n第二句也顺了一点。"],
  [/扩写/, "这是扩写后的结果：补充了一个例子与一段解释。\n\n举例来说，……"],
  [/缩写/, "这是缩写后的结果：关键信息都保留了下来。"],
  [/翻译成中文/, "这是翻译成中文后的结果。"],
  [/正式的书面语气/, "这是改写为正式语气后的结果，用词准确、结构清晰。"],
  [/一句话概括/, "这是一句话摘要：本文讨论了 AI 面板的写回契约。"],
  [/Markdown 大纲/, "# 大纲\n\n- 面板的三个状态\n- 写回前的原文核对\n- 可撤销的事务"],
  [/关键词标签/, "标签, 摘要, 大纲, 写回"],
  [/关键要点/, "- 要点一：AI 结果一律先预览\n- 要点二：接受走可撤销事务"],
];

function pickOutput(request: ChatRequest): string {
  const user = request.messages.map((message) => message.content).join("\n");
  for (const [pattern, output] of RULES) {
    if (pattern.test(user)) return output;
  }
  return "这是模型返回的内容。";
}

/** 分块喂给面板，模拟真实流式 */
const MOCK_RUNNER: AiRunner = async (
  _endpoint: EndpointConfig,
  request: ChatRequest,
  handlers: {
    onDelta(text: string): void;
    onDone(): void;
    onError(message: string): void;
  },
) => {
  const text = pickOutput(request);
  let cancelled = false;
  let offset = 0;

  void (async () => {
    while (offset < text.length) {
      if (cancelled) return;
      handlers.onDelta(text.slice(offset, offset + 4));
      offset += 4;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (!cancelled) handlers.onDone();
  })();

  return () => {
    cancelled = true;
  };
};

/**
 * 如果 URL 带了 `?ai-mock=1`，就装上 mock runner。
 *
 * 没带这个参数时**什么都不做**——正常开发也用不到它。
 */
export function installAiMockIfRequested(): void {
  if (!import.meta.env.DEV) return;
  if (!new URLSearchParams(window.location.search).has("ai-mock")) return;
  setAiRunner(MOCK_RUNNER);
}

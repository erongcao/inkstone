/**
 * 高层聊天入口：拼请求 → 限流 → 走 IPC → 逐块回调。
 *
 * 这一层把「协议差异」全部收敛掉，调用方只需要：
 *
 * ```ts
 * const cancel = await chat(endpoint, { messages: [...] }, {
 *   onDelta: (t) => append(t),
 *   onDone: () => finish(),
 *   onError: (m) => fail(m),
 * });
 * ```
 */

import { aiStreamChat } from "./ipc";
import { limiter } from "./limiter";
import {
  resolveEndpoint,
  type ChatProvider,
  type ChatRequest,
  type EndpointConfig,
} from "./provider";
import { anthropic } from "./providers/anthropic";
import { gemini } from "./providers/gemini";
import { openAICompatible } from "./providers/openai-compatible";
import { t } from "@/i18n";

/** 协议 → 实现 */
const PROVIDERS: Record<string, ChatProvider> = {
  openai: openAICompatible,
  anthropic,
  gemini,
};

export function providerFor(protocol: string): ChatProvider {
  const found = PROVIDERS[protocol];
  if (!found) throw new Error(t("未知的协议: {protocol}", { protocol }));
  return found;
}

export interface ChatHandlers {
  /** 收到一段增量文本 */
  onDelta(text: string): void;
  /** 正常结束 */
  onDone(): void;
  /** 出错 */
  onError(message: string): void;
}

/**
 * 发一次流式聊天。
 *
 * @returns 取消函数（同时释放并发许可）
 */
export async function chat(
  endpoint: EndpointConfig,
  request: ChatRequest,
  handlers: ChatHandlers,
): Promise<() => void> {
  const provider = providerFor(endpoint.protocol);
  const cfg = resolveEndpoint(endpoint);
  limiter.setLimit(cfg.id, cfg.maxConcurrent);

  // 先排队再发请求：GLM 订阅档不排队会直接 429
  const release = await limiter.acquire(cfg);
  let cancelled = false;
  let cancelRemote: (() => void) | null = null;

  try {
    cancelRemote = await aiStreamChat(
      {
        url: provider.endpointUrl(cfg),
        body: provider.encodeBody(request, cfg),
        auth: provider.auth(cfg),
        headers: Object.entries(provider.extraHeaders?.(cfg) ?? {}).map(
          ([name, value]) => `${name}: ${value}`,
        ),
      },
      {
        onDelta: (data) => {
          if (cancelled) return;
          const text = provider.decodeDelta(data);
          if (text) handlers.onDelta(text);
        },
        onDone: () => {
          if (cancelled) return;
          release();
          handlers.onDone();
        },
        onError: (message) => {
          if (cancelled) return;
          release();
          handlers.onError(message);
        },
      },
    );
  } catch (error) {
    release();
    handlers.onError(String(error));
    return () => {};
  }

  return () => {
    if (cancelled) return;
    cancelled = true;
    release();
    cancelRemote?.();
  };
}

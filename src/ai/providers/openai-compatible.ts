/**
 * OpenAI 兼容协议。
 *
 * 一个实现覆盖：OpenAI / DeepSeek / 通义 / Kimi(moonshot) / GLM(paas) /
 * vLLM / LM Studio / llama.cpp server / Ollama 的 /v1 兼容模式。
 * 加新厂商只需要在 `endpoints.ts` 里加一条预设，不用改这里。
 */

import type { AuthSpec, ChatProvider, ChatRequest, ResolvedEndpoint } from "../provider";

/** 拼接 URL：去掉 base 末尾的斜杠，避免出现 `//chat/completions` */
export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export const openAICompatible: ChatProvider = {
  id: "openai-compatible",
  label: "OpenAI 兼容",
  protocol: "openai",
  capabilities: {
    temperature: true,
    maxTokensRequired: false,
    systemRole: "message",
    reasoningToggle: false,
    stopSequences: true,
  },

  endpointUrl(cfg) {
    return joinUrl(cfg.baseUrl, "chat/completions");
  },

  encodeBody(req, cfg) {
    const body: Record<string, unknown> = {
      model: cfg.model,
      stream: true,
      messages: toOpenAIMessages(req),
    };
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
    // 能力位把关：模型不支持的参数**根本不发**，
    // 而不是发了让上游返回 400（实测 GPT-5 / Claude 4.7+ 移除了 temperature；
    // Kimi k2p7-code / k3、GLM-5.3 总是推理且温度锁 1）
    if (cfg.resolvedCapabilities.temperature && req.temperature !== undefined) {
      body.temperature = req.temperature;
    }
    if (cfg.resolvedCapabilities.reasoningToggle && req.reasoning !== undefined) {
      body.reasoning_effective = req.reasoning;
    }
    if (cfg.resolvedCapabilities.stopSequences && req.stop?.length) {
      body.stop = req.stop;
    }
    return JSON.stringify(body);
  },

  decodeDelta(payload) {
    try {
      const json = JSON.parse(payload) as {
        choices?: { delta?: { content?: string } }[];
      };
      return json.choices?.[0]?.delta?.content ?? "";
    } catch {
      // 心跳 / 非 JSON 的 keep-alive 行：忽略而不是抛错
      return "";
    }
  },

  auth(cfg: ResolvedEndpoint): AuthSpec {
    // 本机推理服务（Ollama / LM Studio / vLLM）**不需要密钥**。
    // 硬要用户填一个占位密钥是很别扭的：上游根本不认它，
    // 用户只会以为自己配错了。
    if (cfg.billing === "local-free") {
      return { kind: "none", account: cfg.id };
    }
    return { kind: "bearer", account: cfg.id };
  },
};

/** system 在 OpenAI 协议里是 messages 里的一条 */
function toOpenAIMessages(req: ChatRequest) {
  const messages: { role: string; content: string }[] = [];
  if (req.system) messages.push({ role: "system", content: req.system });
  for (const m of req.messages) {
    messages.push({ role: m.role, content: m.content });
  }
  return messages;
}

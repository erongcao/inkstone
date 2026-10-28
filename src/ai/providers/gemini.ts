/**
 * Gemini 原生协议（`:generateContent` / `:streamGenerateContent?alt=sse`）。
 *
 * 与另两家的差异：
 *   1. **URL 里带模型名**，不是一个统一的 `/messages` 之类的路径
 *   2. role 叫 `user` / **`model`**（不是 `assistant`）
 *   3. system 提示走 `systemInstruction`，内容要包成 `{ parts: [...] }`
 *   4. 采样参数在 `generationConfig` 里，而且 `maxTokens` 叫 `maxOutputTokens`
 */

import { joinUrl } from "./openai-compatible";
import type { ChatProvider } from "../provider";

export const gemini: ChatProvider = {
  id: "gemini",
  label: "Google Gemini",
  protocol: "gemini",
  capabilities: {
    temperature: true,
    maxTokensRequired: false,
    systemRole: "separate",
    reasoningToggle: false,
    stopSequences: true,
  },

  endpointUrl(cfg) {
    // 模型名在路径里；alt=sse 才是流式（SSE 格式，不是 JSON 数组）
    return joinUrl(
      cfg.baseUrl,
      `v1beta/models/${encodeURIComponent(cfg.model)}:streamGenerateContent?alt=sse`,
    );
  },

  modelsUrl(cfg) {
    // `GET /v1beta/models`——与上面同一个版本前缀，只是把末尾的
    // `{模型名}:streamGenerateContent` 换成目录本身。
    return joinUrl(cfg.baseUrl, "v1beta/models");
  },

  encodeBody(req, cfg) {
    const body: Record<string, unknown> = {
      contents: req.messages.map((m) => ({
        // Gemini 把 assistant 叫 model
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
    };
    if (req.system !== undefined) {
      body.systemInstruction = { parts: [{ text: req.system }] };
    }
    const generationConfig: Record<string, unknown> = {};
    if (cfg.resolvedCapabilities.temperature && req.temperature !== undefined) {
      generationConfig.temperature = req.temperature;
    }
    if (req.maxTokens !== undefined) generationConfig.maxOutputTokens = req.maxTokens;
    if (cfg.resolvedCapabilities.stopSequences && req.stop?.length) {
      generationConfig.stopSequences = req.stop;
    }
    if (Object.keys(generationConfig).length > 0) {
      body.generationConfig = generationConfig;
    }
    return JSON.stringify(body);
  },

  decodeDelta(payload) {
    try {
      const json = JSON.parse(payload) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      // 一次增量可能带多个 part，拼起来
      return (json.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? "")
        .join("");
    } catch {
      return "";
    }
  },

  auth(cfg) {
    // 官方文档两种都支持；走 header 更安全（密钥不会出现在 URL / 日志里）
    return { kind: "header", account: cfg.id, header: "x-goog-api-key" };
  },
};

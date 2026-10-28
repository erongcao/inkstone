/**
 * Anthropic 原生协议（`/v1/messages`）。
 *
 * 与 OpenAI 兼容的三个实质差异，每次都会踩：
 *   1. `system` 是**独立字段**，不是 messages 里的一条
 *   2. `max_tokens` **必填**，省略直接 400
 *   3. 密钥走 `x-api-key` 而不是 `Authorization: Bearer`
 * 另外必须带 `anthropic-version` 头（它不是密钥，所以走 `extraHeaders`）。
 */

import { joinUrl } from "./openai-compatible";
import type { ChatProvider } from "../provider";

/** Anthropic 要求的协议版本头 */
export const ANTHROPIC_VERSION = "2023-06-01";

/** max_tokens 的缺省值：Anthropic 必填，不能省 */
export const DEFAULT_MAX_TOKENS = 4096;

export const anthropic: ChatProvider = {
  id: "anthropic",
  label: "Anthropic",
  protocol: "anthropic",
  capabilities: {
    temperature: true,
    maxTokensRequired: true,
    systemRole: "separate",
    reasoningToggle: true,
    stopSequences: true,
  },

  endpointUrl(cfg) {
    return joinUrl(cfg.baseUrl, "v1/messages");
  },

  modelsUrl(cfg) {
    // 官方文档：`GET /v1/models`，查询参数 `limit` 范围 1–1000，**默认只有 20**。
    // 不给上限的话，Anthropic 一家就有二十多个模型，一半会被默认页大小截掉——
    // 用户会以为某个模型不存在，而它其实只是排在第二页。
    return `${joinUrl(cfg.baseUrl, "v1/models")}?limit=200`;
  },

  encodeBody(req, cfg) {
    const body: Record<string, unknown> = {
      model: cfg.model,
      // 必填：省略会被上游 400 拒绝
      max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      stream: true,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    };
    // system 是独立字段，不进 messages
    if (req.system !== undefined) body.system = req.system;
    if (cfg.resolvedCapabilities.temperature && req.temperature !== undefined) {
      body.temperature = req.temperature;
    }
    if (cfg.resolvedCapabilities.reasoningToggle && req.reasoning !== undefined) {
      body.thinking = { type: req.reasoning ? "enabled" : "disabled" };
    }
    if (cfg.resolvedCapabilities.stopSequences && req.stop?.length) {
      body.stop_sequences = req.stop;
    }
    return JSON.stringify(body);
  },

  decodeDelta(payload) {
    try {
      const json = JSON.parse(payload) as {
        type?: string;
        delta?: { text?: string };
      };
      // 只有 content_block_delta 带文本增量；
      // message_start / content_block_start / message_delta（usage）都不是
      if (json.type === "content_block_delta") return json.delta?.text ?? "";
      return "";
    } catch {
      return "";
    }
  },

  auth(cfg) {
    return { kind: "header", account: cfg.id, header: "x-api-key" };
  },

  extraHeaders() {
    return { "anthropic-version": ANTHROPIC_VERSION };
  },
};

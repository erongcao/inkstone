/**
 * 端点预设表。
 *
 * 这里每一条都是**实测文档**里查到的，不是记忆。改动前请先核对厂商文档，
 * 并把改动理由写进注释——端点填错的表现是 401/404，很难从界面上看出原因。
 *
 * 两条最容易踩的（见 AGENTS.md）：
 *
 * 1. **订阅端点与按量端点是两套独立账户体系**
 *    实测：GLM Coding Plan 的密钥只在 `/api/coding/paas/v4` 上工作，
 *    Developer API 的密钥只在 `/api/paas/v4` 上工作，反之亦然。
 *    所以订阅预设必须单列，不能和按量预设合并。
 *
 * 2. **并发上限按订阅档位硬限制**
 *    GLM Coding Plan Lite/Pro 只允许 **1** 个并发请求，超了直接 429；
 *    Max 档才到 30。Kimi Code Plan 文档标注 30。
 *    这个值必须由客户端真的限流，写在配置里只是显示。
 */

import type { EndpointConfig } from "./provider";

/** 内置端点预设 */
export const BUILTIN_ENDPOINTS: EndpointConfig[] = [
  // ── 订阅制（coding plan）────────────────────────────────────────────
  {
    id: "glm-coding",
    label: "智谱 GLM Coding Plan（订阅）",
    protocol: "openai",
    baseUrl: "https://api.z.ai/api/coding/paas/v4",
    model: "glm-4.6",
    billing: "subscription",
    // Lite / Pro 档只允许 1 并发，超过直接 429；Max 档可调到 30
    maxConcurrent: 1,
    note: "订阅密钥只能用于本端点。GLM-5.x 系列总是推理且温度锁 1，不能关闭。",
    capabilities: {
      // glm-5.x 移除了 temperature；这里保守起见默认不发送，
      // 用户在设置里明确知道自己在做什么时可以再打开
      temperature: false,
      reasoningToggle: false,
    },
  },
  {
    id: "kimi-coding",
    label: "Kimi Code Plan（订阅）",
    protocol: "openai",
    baseUrl: "https://api.kimi.com/coding/v1",
    model: "kimi-k2",
    billing: "subscription",
    maxConcurrent: 30,
    note: "订阅密钥只能用于本端点。k2p7-code / k3 系列总是推理且温度锁 1。",
    capabilities: {
      temperature: false,
      reasoningToggle: false,
    },
  },

  // ── 按量计费（官方 API）────────────────────────────────────────────
  {
    id: "glm-api",
    label: "智谱 GLM（按量）",
    protocol: "openai",
    baseUrl: "https://api.z.ai/api/paas/v4",
    model: "glm-4.6",
    billing: "pay-per-token",
    maxConcurrent: 0, // 0 = 不限（文档：按 key 的充值档位缩放）
    note: "按 token 计费。与 GLM Coding Plan 是两套独立账户，密钥不能混用。",
  },
  {
    id: "moonshot",
    label: "Moonshot Kimi（按量）",
    protocol: "openai",
    baseUrl: "https://api.moonshot.ai/v1",
    model: "moonshot-v1-8k",
    billing: "pay-per-token",
    maxConcurrent: 0,
  },
  {
    id: "deepseek",
    label: "DeepSeek（按量）",
    protocol: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    billing: "pay-per-token",
    maxConcurrent: 0,
  },
  {
    id: "dashscope",
    label: "阿里通义千问（按量）",
    protocol: "openai",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    billing: "pay-per-token",
    maxConcurrent: 0,
  },
  {
    id: "openai",
    label: "OpenAI（按量）",
    protocol: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    billing: "pay-per-token",
    maxConcurrent: 0,
    note: "GPT-5 系列移除了 temperature 参数，设置面板会自动禁用它。",
    capabilities: {
      temperature: false,
      reasoningToggle: false,
    },
  },
  {
    id: "anthropic",
    label: "Anthropic Claude（按量）",
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com",
    model: "claude-sonnet-4-5",
    billing: "pay-per-token",
    maxConcurrent: 0,
    note: "需要 Anthropic 官方 API key。Claude Pro/Max 订阅不覆盖第三方应用，本应用不做该接入。",
  },
  {
    id: "gemini",
    label: "Google Gemini（按量）",
    protocol: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com",
    model: "gemini-2.0-flash",
    billing: "pay-per-token",
    maxConcurrent: 0,
  },

  {
    id: "minimax-intl",
    label: "MiniMax 国际（按量 / Token Plan）",
    protocol: "openai",
    baseUrl: "https://api.minimax.io/v1",
    model: "MiniMax-M3",
    billing: "pay-per-token",
    maxConcurrent: 0,
    note:
      "海外账户用 api.minimax.io，中国大陆账户必须改成 api.minimaxi.com（多一个 i）。" +
      "按量 API Key 与 Token Plan 订阅 Key 用**同一个端点**，只是计费到不同账户资源，" +
      "两者不能互换。Anthropic 兼容协议（anthropic 子路径）可解锁 interleaved thinking。",
  },
  {
    id: "minimax-cn",
    label: "MiniMax 中国大陆（按量 / Token Plan）",
    protocol: "openai",
    baseUrl: "https://api.minimaxi.com/v1",
    model: "MiniMax-M3",
    billing: "pay-per-token",
    maxConcurrent: 0,
    note: "中国大陆账户的端点，注意是 minimaxi.com（比国际版多一个 i）。",
  },

  // ── 本地推理（免费）─────────────────────────────────────────────────
  {
    id: "ollama",
    label: "Ollama（本地）",
    protocol: "openai",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "qwen2.5:7b",
    billing: "local-free",
    maxConcurrent: 1, // 本机显存有限，默认串行
    note: "本地推理，不消耗任何额度。需要先 ollama serve。",
  },
  {
    id: "lmstudio",
    label: "LM Studio（本地）",
    protocol: "openai",
    baseUrl: "http://127.0.0.1:1234/v1",
    model: "local-model",
    billing: "local-free",
    maxConcurrent: 1,
    note: "本地推理。需要 LM Studio 的本地服务器已启动。",
  },
  {
    id: "vllm",
    label: "vLLM（本地）",
    protocol: "openai",
    baseUrl: "http://127.0.0.1:8000/v1",
    model: "local-model",
    billing: "local-free",
    maxConcurrent: 2,
    note: "本地推理。vLLM 启动时会打印实际的模型名，请按需修改。",
  },
];

/** 按 id 找预设 */
export function builtinEndpoint(id: string): EndpointConfig | undefined {
  return BUILTIN_ENDPOINTS.find((e) => e.id === id);
}

/** 计费性质的中文标签 */
export const BILLING_LABELS: Record<EndpointConfig["billing"], string> = {
  subscription: "订阅制",
  "pay-per-token": "按量计费",
  "local-free": "本地免费",
};

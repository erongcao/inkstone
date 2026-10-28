/**
 * AI Provider 的统一接口。
 *
 * 分工（见 `docs/ai-design.md`）：
 *   - **Rust 侧**只做传输与密钥：拼 URL 之外的 HTTP 收发、SSE 帧切分、钥匙串
 *   - **协议编解码全在这一侧**（TypeScript），能被 vitest 直接单测
 *
 * 为什么要把「能力位」显式声明：
 *   实测各家模型对采样参数的接受度差别很大——
 *   Kimi `k2p7-code` / `k3`、GLM-5.3 **总是推理且温度锁 1**，
 *   Claude 4.7+ / GPT-5 **直接移除了 temperature 参数**（传了会报错）。
 *   所以设置面板必须按能力位禁用控件，**不能让用户填出非法参数**。
 */

/** 入站协议 */
export type Protocol = "openai" | "anthropic" | "gemini";

/** 计费性质——UI 必须显示，避免用户误判成本 */
export type Billing = "subscription" | "pay-per-token" | "local-free";

/** 一次对话请求（协议无关的中间表示） */
export interface ChatRequest {
  /** 系统提示；部分协议把它放在独立字段而不是 messages 里 */
  system?: string;
  /** 对话轮次 */
  messages: ChatMessage[];
  maxTokens?: number;
  /** 仅当 provider.capabilities.temperature 为真时才发 */
  temperature?: number;
  /** 仅当 provider.capabilities.reasoningToggle 为真时才发 */
  reasoning?: boolean;
  /** 终止符序列（OpenAI 兼容支持；Anthropic 用 stop_sequences） */
  stop?: string[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** 能力位：决定设置面板哪些控件可用 */
export interface ProviderCapabilities {
  /** 模型是否接受 temperature。GPT-5 / Claude 4.7+ 已移除 */
  temperature: boolean;
  /** 是否需要 max_tokens（Anthropic 必填且不接受省略） */
  maxTokensRequired: boolean;
  /** system 是独立字段（Anthropic）而不是 messages 里的一条 */
  systemRole: "separate" | "message";
  /** 是否支持开关思考（Kimi/GLM 目前只是 on/off 二值，不分级） */
  reasoningToggle: boolean;
  /** 是否支持 stop 序列 */
  stopSequences: boolean;
}

/** Provider 统一接口 */
export interface ChatProvider {
  id: string;
  label: string;
  protocol: Protocol;
  /** 默认能力位；端点配置可以覆盖 */
  capabilities: ProviderCapabilities;
  /** 拼出完整的流式端点 URL */
  endpointUrl(cfg: ResolvedEndpoint): string;
  /**
   * 拼出「列出可用模型」的 URL。
   *
   * 路径规则与 `endpointUrl` 同源：**同一个 base、同一个版本前缀**，
   * 只是把末尾那个操作换掉：
   *   - OpenAI 兼容：`{base}/chat/completions` → `{base}/models`
   *   - Anthropic：  `{base}/v1/messages`     → `{base}/v1/models`
   *   - Gemini：     `{base}/v1beta/models/{m}:…` → `{base}/v1beta/models`
   *
   * 为什么放在 provider 上而不是另写一张「协议 → 列表路径」的表：
   * 协议与 URL 布局本来就是一回事，两处各写一遍迟早会分叉
   * （分叉出来的表现是「聊天能通、列模型 404」，极难排查）。
   */
  modelsUrl(cfg: ResolvedEndpoint): string;
  /** 编解码成该协议的请求体（返回 JSON 字符串） */
  encodeBody(req: ChatRequest, cfg: ResolvedEndpoint): string;
  /**
   * 除鉴权之外的额外请求头。
   * Anthropic 的 `anthropic-version` 就走这里——它不是密钥，
   * 不能混进 `auth`（那是 Rust 侧注入密钥的通道）。
   */
  extraHeaders?(cfg: ResolvedEndpoint): Record<string, string>;
  /**
   * 从一条 SSE `data:` 负载里抽出「本次新增的文本增量」。
   * 返回空串表示这条负载不含文本（例如 usage 统计、心跳）。
   */
  decodeDelta(payload: string): string;
  /** 鉴权方式：密钥放哪 */
  auth(cfg: ResolvedEndpoint): AuthSpec;
}

/** 前端 → Rust 的鉴权描述（Rust 负责按这个注入密钥） */
export interface AuthSpec {
  kind: "none" | "bearer" | "header" | "query";
  /** 钥匙串里的 account 名（= 端点 id） */
  account: string;
  header?: string;
  prefix?: string;
  param?: string;
}

/** 端点配置（用户填的） */
export interface EndpointConfig {
  /** 端点 id，同时是钥匙串的 account 名 */
  id: string;
  /** 展示名 */
  label: string;
  /** 协议 */
  protocol: Protocol;
  /** base URL，不含路径 */
  baseUrl: string;
  /** 模型 id */
  model: string;
  /** 计费性质（UI 显示用） */
  billing: Billing;
  /** 并发上限。GLM Coding Plan Lite/Pro 只有 1，超了直接 429 */
  maxConcurrent: number;
  /** 能力位覆盖（端点级优先于协议默认） */
  capabilities?: Partial<ProviderCapabilities>;
  /** 提示文案，比如「订阅密钥只能用于本端点」 */
  note?: string;
}

/** 已合并能力位的端点配置 */
export interface ResolvedEndpoint extends EndpointConfig {
  resolvedCapabilities: ProviderCapabilities;
}

/** 合并端点级的能力位覆盖 */
export function resolveEndpoint(cfg: EndpointConfig): ResolvedEndpoint {
  const base = providerCapabilitiesFor(cfg.protocol);
  return {
    ...cfg,
    resolvedCapabilities: { ...base, ...(cfg.capabilities ?? {}) },
  };
}

/** 各协议的默认能力位 */
export function providerCapabilitiesFor(protocol: Protocol): ProviderCapabilities {
  switch (protocol) {
    case "anthropic":
      return {
        // 注意：Anthropic 目前仍接受 temperature，但 Claude 4.7+ 的新模型
        // 正在移除它。端点级可以覆盖成 false。
        temperature: true,
        maxTokensRequired: true,
        systemRole: "separate",
        reasoningToggle: true,
        stopSequences: true,
      };
    case "gemini":
      return {
        temperature: true,
        maxTokensRequired: false,
        // Gemini 走 `systemInstruction` 独立字段，不在 contents 里
        systemRole: "separate",
        reasoningToggle: false,
        stopSequences: true,
      };
    case "openai":
    default:
      return {
        temperature: true,
        maxTokensRequired: false,
        systemRole: "message",
        reasoningToggle: false,
        stopSequences: true,
      };
  }
}

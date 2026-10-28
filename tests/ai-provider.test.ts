/**
 * AI 协议层的护栏测试。
 *
 * AI 的输出不确定，**不能进 round-trip 语料**。这一层能测的是
 * 「我们编出来的请求体对不对」「我们从上游 SSE 里解出的增量对不对」，
 * 两边都是确定性的纯函数，所以可以直接断言字节级结果。
 *
 * 覆盖的三个坑都来自实测文档，不是推测：
 *   1. Anthropic 的 `system` 是独立字段、`max_tokens` 必填
 *   2. Gemini 的 role 叫 `model` 不叫 `assistant`，URL 里带模型名
 *   3. 能力位为 false 的参数**根本不发**（GPT-5 / GLM-5.x 移除了 temperature）
 */

import { describe, expect, it } from "vitest";
import {
  resolveEndpoint,
  providerCapabilitiesFor,
  type EndpointConfig,
} from "@/ai/provider";
import { openAICompatible, joinUrl } from "@/ai/providers/openai-compatible";
import {
  anthropic,
  ANTHROPIC_VERSION,
  DEFAULT_MAX_TOKENS,
} from "@/ai/providers/anthropic";
import { gemini } from "@/ai/providers/gemini";
import { providerFor } from "@/ai/chat";
import { BUILTIN_ENDPOINTS, BILLING_LABELS } from "@/ai/endpoints";

function cfg(over: Partial<EndpointConfig> = {}) {
  const base: EndpointConfig = {
    id: "test",
    label: "测试",
    protocol: "openai",
    baseUrl: "https://example.invalid/v1",
    model: "test-model",
    billing: "pay-per-token",
    maxConcurrent: 0,
    ...over,
  };
  return resolveEndpoint(base);
}

describe("URL 拼装", () => {
  it("去掉 base 末尾的斜杠，避免出现双斜杠", () => {
    expect(joinUrl("https://x.test/v1/", "/chat/completions")).toBe(
      "https://x.test/v1/chat/completions",
    );
  });

  it("OpenAI 兼容走 /chat/completions", () => {
    expect(openAICompatible.endpointUrl(cfg())).toBe(
      "https://example.invalid/v1/chat/completions",
    );
  });

  it("Anthropic 走 /v1/messages", () => {
    expect(
      anthropic.endpointUrl(
        cfg({ protocol: "anthropic", baseUrl: "https://api.anthropic.com" }),
      ),
    ).toBe("https://api.anthropic.com/v1/messages");
  });

  it("Gemini 把模型名放进路径并带 alt=sse", () => {
    const url = gemini.endpointUrl(
      cfg({ protocol: "gemini", baseUrl: "https://g.test", model: "gemini-2.0-flash" }),
    );
    expect(url).toBe(
      "https://g.test/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse",
    );
  });

  it("Gemini 的模型名要做 URL 编码", () => {
    const url = gemini.endpointUrl(
      cfg({ protocol: "gemini", baseUrl: "https://g.test", model: "models/x y" }),
    );
    expect(url).toContain("models%2Fx%20y");
  });
});

describe("OpenAI 兼容编解码", () => {
  it("system 是 messages 里的一条", () => {
    const body = JSON.parse(
      openAICompatible.encodeBody(
        { system: "你是助手", messages: [{ role: "user", content: "你好" }] },
        cfg(),
      ),
    );
    expect(body.messages[0]).toEqual({ role: "system", content: "你是助手" });
    expect(body.messages[1]).toEqual({ role: "user", content: "你好" });
    expect(body.stream).toBe(true);
    expect(body.model).toBe("test-model");
  });

  it("能力位关闭时不发 temperature（GPT-5 / GLM-5.x 会移除该参数）", () => {
    const body = JSON.parse(
      openAICompatible.encodeBody(
        { messages: [], temperature: 0.7 },
        cfg({ capabilities: { temperature: false } }),
      ),
    );
    expect(body).not.toHaveProperty("temperature");
  });

  it("能力位开启时才发 temperature", () => {
    const body = JSON.parse(
      openAICompatible.encodeBody({ messages: [], temperature: 0.7 }, cfg()),
    );
    expect(body.temperature).toBe(0.7);
  });

  it("解析 choices[0].delta.content", () => {
    expect(
      openAICompatible.decodeDelta('{"choices":[{"delta":{"content":"你好"}}]}'),
    ).toBe("你好");
  });

  it("心跳 / 非 JSON 负载返回空串而不是抛错", () => {
    expect(openAICompatible.decodeDelta(": ping")).toBe("");
    expect(openAICompatible.decodeDelta("")).toBe("");
  });

  it("usage-only 的负载没有文本增量", () => {
    expect(
      openAICompatible.decodeDelta('{"choices":[{"delta":{},"finish_reason":"stop"}]}'),
    ).toBe("");
  });
});

describe("Anthropic 编解码", () => {
  it("system 是独立字段，不进 messages", () => {
    const body = JSON.parse(
      anthropic.encodeBody(
        { system: "你是助手", messages: [{ role: "user", content: "你好" }] },
        cfg({ protocol: "anthropic" }),
      ),
    );
    expect(body.system).toBe("你是助手");
    expect(body.messages).toEqual([{ role: "user", content: "你好" }]);
  });

  it("max_tokens 必填：不传时补默认值", () => {
    const body = JSON.parse(
      anthropic.encodeBody({ messages: [] }, cfg({ protocol: "anthropic" })),
    );
    expect(body.max_tokens).toBe(DEFAULT_MAX_TOKENS);
  });

  it("带 anthropic-version 头，且它不进 auth（不是密钥）", () => {
    const c = cfg({ protocol: "anthropic" });
    expect(anthropic.extraHeaders?.(c)).toEqual({
      "anthropic-version": ANTHROPIC_VERSION,
    });
    const auth = anthropic.auth(c);
    expect(auth.kind).toBe("header");
    expect(auth.header).toBe("x-api-key");
    expect(auth).not.toHaveProperty("prefix");
  });

  it("只从 content_block_delta 取文本", () => {
    expect(
      anthropic.decodeDelta('{"type":"content_block_delta","delta":{"text":"片段"}}'),
    ).toBe("片段");
    expect(anthropic.decodeDelta('{"type":"message_start","message":{}}')).toBe("");
    expect(
      anthropic.decodeDelta('{"type":"message_delta","usage":{"output_tokens":5}}'),
    ).toBe("");
  });

  it("thinking 开关映射成 type: enabled/disabled", () => {
    const body = JSON.parse(
      anthropic.encodeBody(
        { messages: [], reasoning: true },
        cfg({ protocol: "anthropic" }),
      ),
    );
    expect(body.thinking).toEqual({ type: "enabled" });
  });
});

describe("Gemini 编解码", () => {
  it("assistant 映射成 model", () => {
    const body = JSON.parse(
      gemini.encodeBody(
        {
          messages: [
            { role: "user", content: "问" },
            { role: "assistant", content: "答" },
          ],
        },
        cfg({ protocol: "gemini" }),
      ),
    );
    expect(body.contents[0].role).toBe("user");
    expect(body.contents[1].role).toBe("model");
  });

  it("system 包成 systemInstruction.parts", () => {
    const body = JSON.parse(
      gemini.encodeBody(
        { system: "你是助手", messages: [] },
        cfg({ protocol: "gemini" }),
      ),
    );
    expect(body.systemInstruction).toEqual({ parts: [{ text: "你是助手" }] });
  });

  it("采样参数进 generationConfig 且 maxTokens 改名 maxOutputTokens", () => {
    const body = JSON.parse(
      gemini.encodeBody(
        { messages: [], temperature: 0.3, maxTokens: 100 },
        cfg({ protocol: "gemini" }),
      ),
    );
    expect(body.generationConfig.temperature).toBe(0.3);
    expect(body.generationConfig.maxOutputTokens).toBe(100);
  });

  it("没有采样参数时不应出现空的 generationConfig", () => {
    const body = JSON.parse(
      gemini.encodeBody({ messages: [] }, cfg({ protocol: "gemini" })),
    );
    expect(body).not.toHaveProperty("generationConfig");
  });

  it("一次增量可能带多个 part，要拼起来", () => {
    expect(
      gemini.decodeDelta(
        '{"candidates":[{"content":{"parts":[{"text":"甲"},{"text":"乙"}]}}]}',
      ),
    ).toBe("甲乙");
  });

  it("密钥走 x-goog-api-key 而不是出现在 URL 里", () => {
    const auth = gemini.auth(cfg({ protocol: "gemini" }));
    expect(auth.kind).toBe("header");
    expect(auth.header).toBe("x-goog-api-key");
  });
});

describe("端点预设", () => {
  it("订阅端点与按量端点是分开的 id（密钥不能混用）", () => {
    const ids = BUILTIN_ENDPOINTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length); // id 不重复
    expect(ids).toContain("glm-coding");
    expect(ids).toContain("glm-api");
  });

  it("GLM 订阅端点用的是 coding 路径，不是 paas", () => {
    const glm = BUILTIN_ENDPOINTS.find((e) => e.id === "glm-coding");
    expect(glm?.baseUrl).toContain("/api/coding/paas/v4");
    const api = BUILTIN_ENDPOINTS.find((e) => e.id === "glm-api");
    expect(api?.baseUrl).toContain("/api/paas/v4");
    expect(api?.baseUrl).not.toContain("/coding/");
  });

  it("GLM 订阅端点默认并发为 1（Lite/Pro 超了直接 429）", () => {
    expect(BUILTIN_ENDPOINTS.find((e) => e.id === "glm-coding")?.maxConcurrent).toBe(1);
  });

  it("订阅预设必须写明「订阅密钥不能用于按量端点」", () => {
    for (const e of BUILTIN_ENDPOINTS.filter((x) => x.billing === "subscription")) {
      expect(e.note, `${e.id} 缺少提示文案`).toBeTruthy();
      expect(e.note).toContain("订阅密钥");
    }
  });

  it("本地端点标记为 local-free", () => {
    for (const id of ["ollama", "lmstudio", "vllm"]) {
      expect(BUILTIN_ENDPOINTS.find((e) => e.id === id)?.billing).toBe("local-free");
    }
  });

  it("计费标签三种都有中文名", () => {
    expect(Object.keys(BILLING_LABELS).sort()).toEqual([
      "local-free",
      "pay-per-token",
      "subscription",
    ]);
  });

  it("移除 temperature 的模型，预设里能力位是关的", () => {
    for (const id of ["openai", "glm-coding", "kimi-coding"]) {
      const e = BUILTIN_ENDPOINTS.find((x) => x.id === id);
      expect(e?.capabilities?.temperature, `${id} 应关闭 temperature`).toBe(false);
    }
  });
});

describe("能力位解析", () => {
  it("端点级覆盖优先于协议默认", () => {
    const c = cfg({ protocol: "anthropic", capabilities: { temperature: false } });
    expect(c.resolvedCapabilities.temperature).toBe(false);
    // 未覆盖的项仍取协议默认
    expect(c.resolvedCapabilities.maxTokensRequired).toBe(true);
  });

  it("三个协议的默认能力位符合各自的已知约束", () => {
    expect(providerCapabilitiesFor("anthropic").systemRole).toBe("separate");
    expect(providerCapabilitiesFor("anthropic").maxTokensRequired).toBe(true);
    expect(providerCapabilitiesFor("openai").systemRole).toBe("message");
    expect(providerCapabilitiesFor("gemini").systemRole).toBe("separate");
  });

  it("providerFor 按协议取实现，未知协议报错", () => {
    expect(providerFor("openai")).toBe(openAICompatible);
    expect(providerFor("anthropic")).toBe(anthropic);
    expect(() => providerFor("nope")).toThrow(/未知的协议/);
  });
});

/**
 * 「列出模型并让用户选择」这条链路的守卫。
 *
 * ## 为什么要有这组守卫
 *
 * 这类功能最容易坏成**「不报错、只是没发生」**：
 * 按钮在、点了不报错、但下拉框永远不出现，
 * 或者下拉框出来了、选了却没写进设置。
 * 所以这里守的不是「代码里读了这个参数」，而是
 * **产物上真的出现了列表、真的写进了设置**。
 *
 * ## 三层都要
 *
 * 1. **URL 层**：三个协议各自的列表路径（查错就是 404）
 * 2. **解析层**：三种响应形状（OpenAI / Anthropic / Gemini）
 * 3. **界面层**：点按钮 → 出下拉框 → 选中 → 写进**这个端点**的设置里
 *
 * 另外还要钉住一条容易被顺手弄坏的性质：
 * **模型 id 是跟着服务商走的**，
 * 给 Anthropic 选完模型再切到 Ollama，那个 id 不能被带过去。
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { SettingsPanel } from "@/views/SettingsPanel";
import { parseModelList } from "@/ai/models";
import { resolveEndpointConfig } from "@/ai/endpoints";
import { resolveEndpoint, type EndpointConfig } from "@/ai/provider";
import { openAICompatible } from "@/ai/providers/openai-compatible";
import { anthropic } from "@/ai/providers/anthropic";
import { gemini } from "@/ai/providers/gemini";
import { readSettings, resetSettings, updateSettings } from "@/settings/store";

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

/** 造一个 fetch 桩：返回固定响应体，并把请求 URL 记下来 */
function stubFetch(body: string, init: { ok?: boolean; status?: number } = {}) {
  const mock = vi.fn(async (_url: string) => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: async () => body,
  }));
  vi.stubGlobal("fetch", mock);
  return mock;
}

beforeEach(() => {
  localStorage.clear();
  resetSettings();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("URL 层：列表路径按协议拼", () => {
  it("OpenAI 兼容走 {base}/models", () => {
    expect(
      openAICompatible.modelsUrl(
        cfg({ protocol: "openai", baseUrl: "https://api.openai.com/v1" }),
      ),
    ).toBe("https://api.openai.com/v1/models");
  });

  it("本地推理服务走同一路径（Ollama / LM Studio / vLLM 都提供 GET /v1/models）", () => {
    expect(
      openAICompatible.modelsUrl(
        cfg({ baseUrl: "http://127.0.0.1:11434/v1", billing: "local-free" }),
      ),
    ).toBe("http://127.0.0.1:11434/v1/models");
  });

  it("Anthropic 走 {base}/v1/models，并显式带上 limit", () => {
    // 官方文档：limit 默认只有 20。不给上限，Anthropic 一半的模型会被截掉，
    // 用户会以为某个模型不存在。
    expect(
      anthropic.modelsUrl(
        cfg({ protocol: "anthropic", baseUrl: "https://api.anthropic.com" }),
      ),
    ).toBe("https://api.anthropic.com/v1/models?limit=200");
  });

  it("Gemini 走 {base}/v1beta/models", () => {
    expect(
      gemini.modelsUrl(
        cfg({
          protocol: "gemini",
          baseUrl: "https://generativelanguage.googleapis.com",
        }),
      ),
    ).toBe("https://generativelanguage.googleapis.com/v1beta/models");
  });

  it("列表 URL 与聊天 URL 同源：同一个 base、同一个版本前缀", () => {
    // 分叉出来的表现是「聊天能通、列模型 404」，极难排查——
    // 所以这条断言把两者的 base 与版本前缀钉在一起。
    //
    // 注意 OpenAI 兼容的版本前缀（/v1）是**写在 base 里**的，
    // 而 Anthropic / Gemini 的版本前缀是协议自己拼上去的——
    // 三者的 base 形态不一样，所以这里各给各的。
    const cases = [
      {
        provider: openAICompatible,
        baseUrl: "https://x.test/v1",
        chat: "https://x.test/v1/chat/completions",
        list: "https://x.test/v1/models",
      },
      {
        provider: anthropic,
        baseUrl: "https://x.test",
        chat: "https://x.test/v1/messages",
        list: "https://x.test/v1/models?limit=200",
      },
      {
        provider: gemini,
        baseUrl: "https://x.test",
        chat: "https://x.test/v1beta/models/m:streamGenerateContent?alt=sse",
        list: "https://x.test/v1beta/models",
      },
    ];
    for (const { provider, baseUrl, chat, list } of cases) {
      const c = cfg({ baseUrl, model: "m" });
      expect(provider.endpointUrl(c)).toBe(chat);
      expect(provider.modelsUrl(c)).toBe(list);
    }
  });
});

describe("解析层：三种响应形状", () => {
  it("OpenAI 形状取 data[].id", () => {
    const result = parseModelList(
      JSON.stringify({ object: "list", data: [{ id: "gpt-4o-mini" }, { id: "gpt-4o" }] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.models.map((m) => m.id)).toEqual(["gpt-4o-mini", "gpt-4o"]);
  });

  it("Anthropic 形状取 data[].id，展示名用 display_name", () => {
    const result = parseModelList(
      JSON.stringify({
        data: [
          { type: "model", id: "claude-sonnet-4-5", display_name: "Claude Sonnet 4.5" },
        ],
        has_more: false,
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.models[0]).toEqual({
      id: "claude-sonnet-4-5",
      label: "Claude Sonnet 4.5",
    });
  });

  it("OpenAI 没有展示名时用 id 顶上（不能显示空白）", () => {
    const result = parseModelList(JSON.stringify({ data: [{ id: "gpt-4o-mini" }] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.models[0].label).toBe("gpt-4o-mini");
  });

  it("Gemini 形状剥掉 models/ 前缀（调用时用的是后面那截）", () => {
    const result = parseModelList(
      JSON.stringify({
        models: [{ name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash" }],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.models[0]).toEqual({
      id: "gemini-2.5-flash",
      label: "Gemini 2.5 Flash",
    });
  });

  it("Gemini 里不支持 generateContent 的模型被滤掉（选了也用不了）", () => {
    const result = parseModelList(
      JSON.stringify({
        models: [
          {
            name: "models/gemini-2.5-flash",
            supportedGenerationMethods: ["generateContent", "countTokens"],
          },
          {
            name: "models/text-embedding-004",
            supportedGenerationMethods: ["embedContent"],
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.models.map((m) => m.id)).toEqual(["gemini-2.5-flash"]);
  });

  it("没有 supportedGenerationMethods 字段时不猜（宁可多列一个也不藏起能用的）", () => {
    const result = parseModelList(
      JSON.stringify({ models: [{ name: "models/gemini-2.5-flash" }] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.models.map((m) => m.id)).toEqual(["gemini-2.5-flash"]);
  });

  it("重复的 id 只留一个，但保持服务端给的顺序", () => {
    // 顺序本身带信息：Anthropic 官方文档写明「新发布的排在前面」
    const result = parseModelList(
      JSON.stringify({ data: [{ id: "b" }, { id: "a" }, { id: "b" }] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.models.map((m) => m.id)).toEqual(["b", "a"]);
  });

  it("没有 id 的条目被丢掉（不能把空串塞进模型框）", () => {
    const result = parseModelList(
      JSON.stringify({ data: [{ id: "" }, { name: "x" }, { id: "ok" }] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.models.map((m) => m.id)).toEqual(["ok"]);
  });

  it("空列表是合法结果，不是错误", () => {
    const result = parseModelList(JSON.stringify({ data: [] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.models).toEqual([]);
  });

  it("返回的不是 JSON 时说清是「不是 JSON」", () => {
    // 多数服务根本没有列表接口，会回一个 HTML 404 页
    const result = parseModelList("<html>404 Not Found</html>");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not-json");
  });

  it("是 JSON 但不是模型列表时说清是「形状不对」", () => {
    const result = parseModelList(JSON.stringify({ error: { message: "not found" } }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unknown-shape");
  });
});

describe("界面层：点得动、选得出、存得下", () => {
  it("点「获取模型列表」后出现下拉框，选中后写进这个端点的设置里", async () => {
    const fetchMock = stubFetch(
      JSON.stringify({ data: [{ id: "qwen2.5:7b" }, { id: "llama3.1:8b" }] }),
    );
    updateSettings({ ai: { defaultEndpointId: "ollama" } });
    render(<SettingsPanel onClose={() => {}} initialSection="ai" />);

    fireEvent.click(screen.getByRole("button", { name: "获取模型列表" }));

    const select = (await screen.findByLabelText("从列表中选择")) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual([
      "",
      "qwen2.5:7b",
      "llama3.1:8b",
    ]);

    // 请求打到了正确的 URL（协议 → 列表路径 → 真的发出去）
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:11434/v1/models");

    fireEvent.change(select, { target: { value: "llama3.1:8b" } });
    expect(readSettings().ai.modelOverrides?.ollama).toBe("llama3.1:8b");
  });

  it("自检：下拉框里的选项确实来自上游返回的列表（不是硬编码的）", async () => {
    const fetchMock = stubFetch(JSON.stringify({ data: [{ id: "only-this-one" }] }));
    updateSettings({ ai: { defaultEndpointId: "ollama" } });
    render(<SettingsPanel onClose={() => {}} initialSection="ai" />);

    fireEvent.click(screen.getByRole("button", { name: "获取模型列表" }));

    const select = (await screen.findByLabelText("从列表中选择")) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["", "only-this-one"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("换端点后不会把上一个端点的模型摆出来", async () => {
    stubFetch(JSON.stringify({ data: [{ id: "qwen2.5:7b" }] }));
    updateSettings({ ai: { defaultEndpointId: "ollama" } });
    render(<SettingsPanel onClose={() => {}} initialSection="ai" />);

    fireEvent.click(screen.getByRole("button", { name: "获取模型列表" }));
    await screen.findByLabelText("从列表中选择");

    fireEvent.change(screen.getByLabelText("默认端点"), {
      target: { value: "lmstudio" },
    });
    expect(screen.queryByLabelText("从列表中选择")).toBeNull();
  });

  it("端点不支持列表时给出明确提示，且不出现下拉框", async () => {
    stubFetch("<html>404 Not Found</html>");
    updateSettings({ ai: { defaultEndpointId: "ollama" } });
    render(<SettingsPanel onClose={() => {}} initialSection="ai" />);

    fireEvent.click(screen.getByRole("button", { name: "获取模型列表" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.queryByLabelText("从列表中选择")).toBeNull();
  });

  it("模型 ID 框永远能手动输入（有的服务不提供列表接口）", () => {
    updateSettings({ ai: { defaultEndpointId: "ollama" } });
    render(<SettingsPanel onClose={() => {}} initialSection="ai" />);

    const input = screen.getByLabelText("模型 ID") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "my-custom-model" } });

    expect(readSettings().ai.modelOverrides?.ollama).toBe("my-custom-model");
  });
});

describe("模型按端点分别记：换端点不能串台", () => {
  it("给 Anthropic 选的模型不会带到 Ollama 上", () => {
    updateSettings({
      ai: {
        defaultEndpointId: "anthropic",
        modelOverrides: { anthropic: "claude-sonnet-4-5" },
      },
    });
    expect(resolveEndpointConfig(readSettings().ai)?.model).toBe("claude-sonnet-4-5");

    updateSettings({ ai: { defaultEndpointId: "ollama" } });
    // Ollama 回到自己的预设模型，而不是 Anthropic 那个
    expect(resolveEndpointConfig(readSettings().ai)?.model).toBe("qwen2.5:7b");
  });

  it("老的全局 defaultModel 仍然生效（老用户升级后行为不变）", () => {
    updateSettings({ ai: { defaultEndpointId: "ollama", defaultModel: "gpt-4o-mini" } });
    expect(resolveEndpointConfig(readSettings().ai)?.model).toBe("gpt-4o-mini");
  });

  it("端点自己选的模型优先于全局默认", () => {
    updateSettings({
      ai: {
        defaultEndpointId: "ollama",
        defaultModel: "gpt-4o-mini",
        modelOverrides: { ollama: "llama3.1:8b" },
      },
    });
    expect(resolveEndpointConfig(readSettings().ai)?.model).toBe("llama3.1:8b");
  });

  it("没有单独选过的端点继续吃全局默认", () => {
    updateSettings({
      ai: {
        defaultEndpointId: "ollama",
        defaultModel: "gpt-4o-mini",
        modelOverrides: { anthropic: "claude-sonnet-4-5" },
      },
    });
    expect(resolveEndpointConfig(readSettings().ai)?.model).toBe("gpt-4o-mini");
  });
});

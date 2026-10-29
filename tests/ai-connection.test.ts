/**
 * 「测试连接」的判定层守卫。
 *
 * ## 为什么这组用例是整个功能的**核心**
 *
 * 「测试连接」的价值全在**说清楚哪里不对**：
 *
 * - HTTP 401 → 密钥错了
 * - HTTP 404（只有列表接口）→ 这个服务没有列表接口，模型 ID 手输即可
 * - HTTP 404（聊天接口也 404）→ base URL 写错了
 * - 连不上 → 服务没启动
 *
 * 这四种若混成一句「连接失败」，用户还是得自己一个个试——
 * 那这个按钮就白做了。
 *
 * 所以这里的断言不是「返回了 ok」，而是
 * **「哪种故障被判成了哪一种」**。
 */

import { describe, expect, it } from "vitest";

import { testConnection, type ConnectionOutcome } from "@/ai/connection";
import type { ProbePayload, ProbeResult } from "@/ai/ipc";
import { openAICompatible } from "@/ai/providers/openai-compatible";
import { resolveEndpoint, type EndpointConfig } from "@/ai/provider";

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

/** 造一个按 URL 回答的探测桩 */
function probeStub(answers: Record<string, ProbeResult>) {
  const calls: ProbePayload[] = [];
  const probe = async (payload: ProbePayload): Promise<ProbeResult> => {
    calls.push(payload);
    const hit = Object.entries(answers).find(([key]) => payload.url.includes(key));
    return (
      hit?.[1] ?? {
        kind: "http",
        status: 404,
        body: "",
        detail: "",
      }
    );
  };
  return { probe, calls };
}

function http(status: number, body = ""): ProbeResult {
  return { kind: "http", status, body, detail: "" };
}

describe("测试连接：判定", () => {
  it("列表接口通 → 连上了，顺手把模型列出来", async () => {
    const { probe } = probeStub({
      "/models": http(200, JSON.stringify({ data: [{ id: "m1" }, { id: "m2" }] })),
    });
    const result = await testConnection(openAICompatible, cfg(), { probe });
    expect(result.outcome).toBe("ok");
    expect(result.models.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(result.message).toContain("2");
  });

  it("列表接口通但返回的不是列表 → 连上了，但没有列表接口", async () => {
    const { probe } = probeStub({
      "/models": http(200, JSON.stringify({ hello: "world" })),
    });
    const result = await testConnection(openAICompatible, cfg(), { probe });
    expect(result.outcome).toBe("ok-no-list");
    expect(result.models).toEqual([]);
  });

  it("401 → 密钥被拒绝（不该再问聊天接口）", async () => {
    const { probe, calls } = probeStub({ "/models": http(401) });
    const result = await testConnection(openAICompatible, cfg(), { probe });
    expect(result.outcome).toBe("unauthorized");
    // 只探了一次：密钥的问题问聊天接口也没用
    expect(calls).toHaveLength(1);
    expect(result.message).toContain("401");
  });

  it("403 与 401 一样归到「密钥被拒绝」", async () => {
    const { probe } = probeStub({ "/models": http(403) });
    const result = await testConnection(openAICompatible, cfg(), { probe });
    expect(result.outcome).toBe("unauthorized");
  });

  it("列表接口 404 但聊天接口通 → 服务是好的，只是没有列表接口", async () => {
    // 这是最容易判错的一组：404 既可能是「没这个接口」，也可能是「路径不对」。
    // 必须靠第二个探测才能分开。
    const { probe, calls } = probeStub({
      "/models": http(404),
      "/chat/completions": http(200, "data: {}\n\n"),
    });
    const result = await testConnection(openAICompatible, cfg(), { probe });
    expect(result.outcome).toBe("ok-no-list");
    expect(calls).toHaveLength(2);
    expect(calls[1].method).toBe("POST");
  });

  it("列表接口与聊天接口都 404 → 路径不对", async () => {
    const { probe, calls } = probeStub({
      "/models": http(404),
      "/chat/completions": http(404),
    });
    const result = await testConnection(openAICompatible, cfg(), { probe });
    expect(result.outcome).toBe("not-found");
    expect(calls).toHaveLength(2);
    expect(result.message).toContain("404");
  });

  it("列表接口 404、聊天接口 401 → 密钥问题（不是路径问题）", async () => {
    const { probe } = probeStub({
      "/models": http(404),
      "/chat/completions": http(401),
    });
    const result = await testConnection(openAICompatible, cfg(), { probe });
    expect(result.outcome).toBe("unauthorized");
  });

  it("连不上 → 网络问题（并把底层原因带上）", async () => {
    const { probe } = probeStub({
      "/models": { kind: "network", status: 0, body: "", detail: "ECONNREFUSED" },
    });
    const result = await testConnection(openAICompatible, cfg(), { probe });
    expect(result.outcome).toBe("network");
    expect(result.message).toContain("ECONNREFUSED");
  });

  it("没配密钥 → 说「还没配密钥」，不是「连接失败」", async () => {
    const { probe, calls } = probeStub({
      "/models": { kind: "no-secret", status: 0, body: "", detail: "未配置该端点的密钥" },
    });
    const result = await testConnection(openAICompatible, cfg(), { probe });
    expect(result.outcome).toBe("no-secret");
    // 请求压根没发出去——不该再问聊天接口
    expect(calls).toHaveLength(1);
  });

  it("429 → 限流", async () => {
    const { probe } = probeStub({ "/models": http(429) });
    const result = await testConnection(openAICompatible, cfg(), { probe });
    expect(result.outcome).toBe("rate-limited");
  });

  it("5xx → 服务端出错（并带上上游的返回体）", async () => {
    const { probe } = probeStub({
      "/models": http(503, "upstream exploded"),
    });
    const result = await testConnection(openAICompatible, cfg(), { probe });
    expect(result.outcome).toBe("server-error");
    expect(result.message).toContain("upstream exploded");
  });

  it("探测的 URL 是按协议拼的（列表路径与聊天路径各一次）", async () => {
    const { probe, calls } = probeStub({
      "/models": http(404),
      "/chat/completions": http(200),
    });
    await testConnection(
      openAICompatible,
      cfg({ baseUrl: "https://api.example.com/v1" }),
      { probe },
    );
    expect(calls[0].url).toBe("https://api.example.com/v1/models");
    expect(calls[1].url).toBe("https://api.example.com/v1/chat/completions");
  });
});

describe("测试连接：判定结果互不重叠", () => {
  it("每种故障都落在自己的分类里", async () => {
    const cases: Array<[ProbeResult, ProbeResult | null, ConnectionOutcome]> = [
      [http(401), null, "unauthorized"],
      [http(429), null, "rate-limited"],
      [http(500), null, "server-error"],
      [{ kind: "network", status: 0, body: "", detail: "x" }, null, "network"],
      [{ kind: "no-secret", status: 0, body: "", detail: "x" }, null, "no-secret"],
      [http(404), http(200), "ok-no-list"],
      [http(404), http(404), "not-found"],
    ];
    for (const [models, chat, expected] of cases) {
      const { probe } = probeStub({
        "/models": models,
        "/chat/completions": chat ?? http(200),
      });
      const result = await testConnection(openAICompatible, cfg(), { probe });
      expect(result.outcome).toBe(expected);
      // 每种结果都要有话可说——「不知道哪儿错了」等于没说
      expect(result.message.length).toBeGreaterThan(0);
    }
  });
});

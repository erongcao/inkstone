/**
 * 前端侧的 IPC 封装。
 *
 * 注意这里**只暴露不需要明文密钥的接口**：
 * `read_secret` 是 Rust 内部的 `pub(crate)`，没有进 `invoke_handler`，
 * 前端拿不到任何形式��密钥明文。写请求时也只传 `account`（= 端点 id），
 * Rust 侧在组装请求时才注入。
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { SseDecoder } from "./sse";
import type { AuthSpec } from "./provider";
import { t } from "@/i18n";

/** 是否在 Tauri 运行时里 */
function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** 密钥后端 */
export type SecretBackend = "keyring" | "file-fallback";

/** 密钥状态（永远不含明文） */
export interface SecretStatus {
  configured: boolean;
  backend: SecretBackend;
  degraded: boolean;
}

export function aiSecretStatus(account: string): Promise<SecretStatus> {
  return invoke<SecretStatus>("ai_secret_status", { account });
}

export function aiSetSecret(account: string, secret: string): Promise<void> {
  return invoke<void>("ai_set_secret", { account, secret });
}

export function aiDeleteSecret(account: string): Promise<void> {
  return invoke<void>("ai_delete_secret", { account });
}

/** 前端 → Rust：一次「列出模型」的请求 */
export interface ListModelsPayload {
  /** 完整 URL（路径由前端按协议拼好，Rust 侧不懂协议） */
  url: string;
  /** 鉴权描述：Rust 侧按它去钥匙串取密钥并注入 */
  auth: AuthSpec;
  /** 额外的请求头（不含任何密钥） */
  headers: string[];
}

/**
 * 取回模型列表的**原始响应体**。
 *
 * 返回原始文本而不是解析好的数组：协议编解码在前端（`src/ai/models.ts`），
 * Rust 侧只做传输与密钥注入——与流式聊天是同一套分工。
 */
export async function aiListModels(payload: ListModelsPayload): Promise<string> {
  // 浏览器开发模式没有 Tauri 运行时，invoke 用不了——改走前端 fetch。
  // 与 streamInBrowser 一样，这条路**只支持本地端点**。
  if (!isTauriRuntime()) {
    return listModelsInBrowser(payload);
  }
  return invoke<string>("ai_list_models", { req: payload });
}

/**
 * 浏览器降级：前端 fetch 列模型。
 *
 * 与 `streamInBrowser` 同一套限制——**只有本地端点能走**：
 * 云端端点在浏览器里会被 CORS 挡住，密钥也拿不到（它在系统钥匙串里）。
 */
async function listModelsInBrowser(payload: ListModelsPayload): Promise<string> {
  if (payload.auth.kind !== "none") {
    throw new Error(
      t(
        "浏览器开发模式拿不到系统钥匙串里的密钥，只能列本机推理服务（Ollama / LM Studio / vLLM）的模型。",
      ),
    );
  }

  const headers: Record<string, string> = {};
  for (const raw of payload.headers) {
    const at = raw.indexOf(":");
    if (at > 0) headers[raw.slice(0, at).trim()] = raw.slice(at + 1).trim();
  }

  const response = await fetch(payload.url, { method: "GET", headers });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`HTTP ${response.status}：${detail.slice(0, 300)}`);
  }
  return response.text();
}

/**
 * 前端 → Rust：一次「探测」请求。
 *
 * 与 `ListModelsPayload` 的区别：方法可以是 GET 或 POST，
 * 而且要的是**状态码**——「测试连接」要靠它把
 * 「密钥填错」「这个服务没有列表接口」「路径不对」三件事分开。
 */
export interface ProbePayload {
  /** 完整 URL（路径由前端按协议拼好，Rust 侧不懂协议） */
  url: string;
  /** `GET` 或 `POST` */
  method: "GET" | "POST";
  /** POST 的请求体 */
  body?: string;
  /** 鉴权描述：Rust 侧按它去钥匙串取密钥并注入 */
  auth: AuthSpec;
  /** 额外的请求头（不含任何密钥） */
  headers: string[];
}

/**
 * 探测结果。
 *
 * `kind` 决定它意味着什么：
 *
 * - `http`    —— 真的发出去了并拿到状态码（看 `status`）
 * - `network` —— 传输层失败（连不上 / 超时 / DNS 解析不了）
 * - `no-secret` —— 这个端点没配密钥，请求**压根没发出去**
 * - `bad-auth`  —— 鉴权方式配置有问题
 */
export interface ProbeResult {
  kind: "http" | "network" | "no-secret" | "bad-auth";
  /** HTTP 状态码；`kind !== "http"` 时为 0 */
  status: number;
  /** 响应体（截断） */
  body: string;
  /** 给用户看的说明 */
  detail: string;
}

/**
 * 探测某个端点。
 *
 * 传输在 Rust 侧（密钥不经过前端），判定在前端——
 * 与流式聊天、列模型是同一套分工。
 */
export async function aiProbeEndpoint(payload: ProbePayload): Promise<ProbeResult> {
  if (!isTauriRuntime()) {
    return probeInBrowser(payload);
  }
  return invoke<ProbeResult>("ai_probe_endpoint", { req: payload });
}

/**
 * 浏览器降级：前端 fetch 探测。
 *
 * 与 `listModelsInBrowser` 同一套限制——**只有本地端点能走**：
 * 云端端点在浏览器里会被 CORS 挡住，密钥也拿不到（它在系统钥匙串里）。
 */
async function probeInBrowser(payload: ProbePayload): Promise<ProbeResult> {
  if (payload.auth.kind !== "none") {
    return {
      kind: "no-secret",
      status: 0,
      body: "",
      detail: t(
        "浏览器开发模式拿不到系统钥匙串里的密钥，只能测本机推理服务（Ollama / LM Studio / vLLM）。",
      ),
    };
  }

  const headers: Record<string, string> = {};
  for (const raw of payload.headers) {
    const at = raw.indexOf(":");
    if (at > 0) headers[raw.slice(0, at).trim()] = raw.slice(at + 1).trim();
  }
  if (payload.body !== undefined) headers["content-type"] = "application/json";

  try {
    const response = await fetch(payload.url, {
      method: payload.method,
      headers,
      body: payload.body,
    });
    const text = await response.text();
    return {
      kind: "http",
      status: response.status,
      body: text.slice(0, 400),
      detail: "",
    };
  } catch (error) {
    return {
      kind: "network",
      status: 0,
      body: "",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Rust 侧收到的流式请求 */
interface StreamRequestPayload {
  id: string;
  url: string;
  body: string;
  auth: AuthSpec;
  headers: string[];
}

/** Rust → 前端的事件负载 */
export interface StreamEvents {
  /** 一条 SSE data 负载（已按帧拼好） */
  onDelta(data: string): void;
  /** 流结束 */
  onDone(): void;
  /** 出错 */
  onError(message: string): void;
}

/**
 * 发起一次流式请求。
 *
 * @returns 取消函数
 */
export async function aiStreamChat(
  request: Omit<StreamRequestPayload, "id">,
  events: StreamEvents,
): Promise<() => void> {
  // 浏览器开发模式没有 Tauri 运行时，invoke 用不了——
  // 改走前端 fetch（见 streamInBrowser 的说明）
  if (!isTauriRuntime()) {
    return streamInBrowser(request, events);
  }

  const id = `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  // 先挂监听再发请求：否则首字节可能在监听就绪前到达而丢事件
  const offs: UnlistenFn[] = [
    await listen<{ id: string; data: string }>("ai://delta", (e) => {
      if (e.payload.id === id) events.onDelta(e.payload.data);
    }),
    await listen<{ id: string }>("ai://done", (e) => {
      if (e.payload.id === id) {
        events.onDone();
        teardown();
      }
    }),
    await listen<{ id: string; message: string }>("ai://error", (e) => {
      if (e.payload.id === id) {
        events.onError(e.payload.message);
        teardown();
      }
    }),
  ];

  let closed = false;
  function teardown(): void {
    if (closed) return;
    closed = true;
    for (const off of offs) off();
  }

  try {
    await invoke<void>("ai_stream_chat", { req: { id, ...request } });
  } catch (error) {
    // Rust 侧已经 emit 过 ai://error 的场景不会走到这里；
    // 走到这里说明是 invoke 本身失败（比如能力未授予）
    events.onError(String(error));
    teardown();
    return () => {};
  }

  return () => {
    void invoke("ai_cancel_stream", { id });
    teardown();
  };
}

/* ── 浏览器降级：前端 fetch ──────────────────────────────────────
 *
 * 为什么需要这条路：浏览器开发模式里没有 Tauri 运行时，
 * `invoke("ai_stream_chat")` 直接不可用。而**本机推理服务**
 * （Ollama / LM Studio / vLLM）本来就不需要密钥，
 * 它们默认也带 CORS 头——所以浏览器里能直连，
 * 整条「面板 → 模型 → 预览 → 写回」的链路在浏览器里也是通的。
 *
 * 为什么不推广到云端端点：浏览器的 fetch 会被 CORS 挡住
 * （OpenAI 就没有 CORS 头），而且密钥在系统钥匙串里、
 * 前端根本拿不到明文。所以**只有本地端点**能走这条路，
 * 其它端点在浏览器模式下会明确报错，而不是假装能用。
 *
 * 注意：正式应用（Tauri）走的仍然是 Rust 侧的 reqwest
 * （设计文档 D15），这条降级路径只在浏览器开发模式生效。
 */

async function streamInBrowser(
  request: Omit<StreamRequestPayload, "id">,
  events: StreamEvents,
): Promise<() => void> {
  if (request.auth.kind !== "none") {
    events.onError(
      t(
        "浏览器开发模式拿不到系统钥匙串里的密钥，只能连本机推理服务（Ollama / LM Studio / vLLM）。",
      ),
    );
    return () => {};
  }

  const controller = new AbortController();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "text/event-stream",
  };
  for (const raw of request.headers) {
    const at = raw.indexOf(":");
    if (at > 0) headers[raw.slice(0, at).trim()] = raw.slice(at + 1).trim();
  }

  try {
    const response = await fetch(request.url, {
      method: "POST",
      headers,
      body: request.body,
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text();
      events.onError(`HTTP ${response.status}：${detail.slice(0, 300)}`);
      return () => {};
    }
    if (!response.body) {
      events.onError(t("响应没有可读的流"));
      return () => {};
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const sse = new SseDecoder();

    const pump = async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const payload of sse.push(decoder.decode(value, { stream: true }))) {
          events.onDelta(payload);
        }
      }
      for (const payload of sse.finish()) {
        events.onDelta(payload);
      }
      events.onDone();
    };

    void pump().catch((error: unknown) => {
      // 取消导致的 AbortError 不算错误——用户主动停掉的
      if (controller.signal.aborted) return;
      events.onError(String(error));
    });
  } catch (error) {
    events.onError(String(error));
    return () => {};
  }

  return () => controller.abort();
}

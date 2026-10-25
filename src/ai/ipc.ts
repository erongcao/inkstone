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

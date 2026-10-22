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

import type { AuthSpec } from "./provider";

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

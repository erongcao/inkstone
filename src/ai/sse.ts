/**
 * SSE 帧解码器（浏览器降级用）。
 *
 * ## 为什么前端要有一份
 *
 * 正常路径下 SSE 是 Rust 侧解的（`src-tauri/src/ai/http.rs` 的 `SseDecoder`），
 * 前端只收 `ai://delta` 事件。但**浏览器开发模式**没有 Tauri 运行时，
 * `invoke("ai_stream_chat")` 用不了——要能在浏览器里连本机 Ollama，
 * 就得自己读 `fetch` 的响应流。
 *
 * 这份实现与 Rust 那份**按同一份规格写**，规格是：
 *
 * 1. 行尾归一化：SSE 允许 `\r\n` / `\n` / `\r` 三种行尾，
 *    而按空行切帧只认相邻的两个 `\n`。不归一化的话
 *    `\r\n\r\n` 里根本没有相邻的 `\n`，整段会并成一帧。
 * 2. 一帧 = 空行分隔；帧内所有 `data:` 行的内容用 `\n` 连起来。
 * 3. 心跳 / 注释行（没有 `data:`）丢掉。
 * 4. `[DONE]` 丢掉——它是结束标记，不该当成内容推给上层。
 * 5. 流结束时，缓冲区里没被空行收尾的残余也算一帧。
 *
 * 跨语言的两份实现改起来要同步：改动这份时记得看 Rust 那份。
 */

/**
 * 从一帧里取出 data 负载。
 *
 * @returns 心跳 / 注释帧 / `[DONE]` 返回 null
 */
export function framePayload(frame: string): string | null {
  const payload = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).replace(/^[ \t]+/, ""))
    .join("\n");
  if (!payload) return null;
  if (payload === "[DONE]") return null;
  return payload;
}

/** SSE 帧解码器 */
export class SseDecoder {
  private buffer = "";
  /**
   * 上一块末尾的 `\r` 被挂起来了。
   *
   * 因为 `\r` 可能是 `\r\n` 的前半，也可能是一个**裸**回车，
   * 而下一块的开头才能区分。急着归一化就会把 `\r\n` 拆成两个换行。
   */
  private pendingCr = false;

  /** 喂进一个网络块，返回本次能凑齐的完整帧负载 */
  push(chunk: string): string[] {
    let text = "";
    if (this.pendingCr) {
      text += "\r";
      this.pendingCr = false;
    }
    text += chunk;
    // 末尾的 `\r` 同样要挂起
    if (text.endsWith("\r")) {
      text = text.slice(0, -1);
      this.pendingCr = true;
    }

    this.buffer += text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    const out: string[] = [];
    // 必须连分隔符一起吃掉：只吃 `\n\n` 之前的部分时，
    // 流开头出现连续空行会变成死循环空转，把 CPU 打满
    for (;;) {
      const pos = this.buffer.indexOf("\n\n");
      if (pos === -1) break;
      const frame = this.buffer.slice(0, pos);
      this.buffer = this.buffer.slice(pos + 2);
      const payload = framePayload(frame);
      if (payload !== null) out.push(payload);
    }
    return out;
  }

  /** 流结束：吐出没被空行收尾的最后一帧 */
  finish(): string[] {
    if (this.pendingCr) {
      this.buffer += "\r";
      this.pendingCr = false;
    }
    const payload = framePayload(this.buffer);
    this.buffer = "";
    return payload === null ? [] : [payload];
  }
}

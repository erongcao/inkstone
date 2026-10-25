/**
 * SSE 帧解码器的测试。
 *
 * 这份实现与 Rust 侧那份（`src-tauri/src/ai/http.rs` 的 `SseDecoder`）
 * 按同一份规格写——用例也刻意对齐，改一边要记得改另一边。
 */

import { describe, expect, it } from "vitest";
import { SseDecoder, framePayload } from "@/ai/sse";

describe("framePayload", () => {
  it("取出一帧里的 data 负载", () => {
    expect(framePayload("data: a")).toBe("a");
  });

  it("心跳 / 注释帧没有负载", () => {
    expect(framePayload(": ping")).toBeNull();
    expect(framePayload("")).toBeNull();
  });

  it("[DONE] 是结束标记，不当成内容", () => {
    expect(framePayload("data: [DONE]")).toBeNull();
  });

  it("一帧里的多个 data 行用换行连起来", () => {
    expect(framePayload("data: 第一行\ndata: 第二行")).toBe("第一行\n第二行");
  });

  it("data: 后面多余的空格要去掉", () => {
    expect(framePayload("data:  甲")).toBe("甲");
  });
});

describe("SseDecoder", () => {
  it("一次喂进多帧", () => {
    const decoder = new SseDecoder();
    expect(decoder.push("data: a\n\ndata: b\n\n")).toEqual(["a", "b"]);
  });

  it("流开头的连续空行不会死循环", () => {
    const decoder = new SseDecoder();
    expect(decoder.push("\n\ndata: a\n\n")).toEqual(["a"]);
  });

  it("没被空行收尾的残余留在缓冲区里", () => {
    const decoder = new SseDecoder();
    expect(decoder.push("data: a\n\ndata: tail")).toEqual(["a"]);
    // 真正的内容在流结束时才吐出来
    expect(decoder.finish()).toEqual(["tail"]);
  });

  it("心跳帧被丢掉", () => {
    const decoder = new SseDecoder();
    expect(decoder.push(": ping\n\ndata: a\n\n")).toEqual(["a"]);
  });

  it("[DONE] 不推给上层", () => {
    const decoder = new SseDecoder();
    expect(decoder.push("data: a\n\ndata: [DONE]\n\n")).toEqual(["a"]);
  });

  it("一帧被拆到两个网络块里也能拼回来", () => {
    const decoder = new SseDecoder();
    expect(decoder.push("data: 第")).toEqual([]);
    expect(decoder.push("一块\n")).toEqual([]);
    expect(decoder.push("\n")).toEqual(["第一块"]);
  });

  it("\\r\\n 行尾要归一化", () => {
    const decoder = new SseDecoder();
    expect(decoder.push("data: a\r\n\r\ndata: b\r\n\r\n")).toEqual(["a", "b"]);
  });

  it("跨块边界的裸 \\r 不能被拆成两个换行", () => {
    const decoder = new SseDecoder();
    expect(decoder.push("data: a\r")).toEqual([]);
    expect(decoder.push("\n\r\ndata: b\r\n\r\n")).toEqual(["a", "b"]);
  });

  it("结束后缓冲区清空，不会重复吐", () => {
    const decoder = new SseDecoder();
    decoder.push("data: a\n\n");
    expect(decoder.finish()).toEqual([]);
    expect(decoder.finish()).toEqual([]);
  });
});

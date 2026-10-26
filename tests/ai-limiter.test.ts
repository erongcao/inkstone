/**
 * 并发限流的护栏测试。
 *
 * 这条链路对应一个真实的、会伤到用户的问题：
 * **GLM Coding Plan 的 Lite / Pro 档只允许 1 个并发请求，超了直接 429**。
 * 「配置里写了 maxConcurrent: 1」和「真的按 1 排队」是两回事，
 * 这里断言的是后者。
 */

import { describe, expect, it } from "vitest";
import { ConcurrencyLimiter } from "@/ai/limiter";

describe("ConcurrencyLimiter", () => {
  it("maxConcurrent = 0 表示不限", async () => {
    const limiter = new ConcurrencyLimiter();
    const a = await limiter.acquire({ id: "e", maxConcurrent: 0 });
    const b = await limiter.acquire({ id: "e", maxConcurrent: 0 });
    const c = await limiter.acquire({ id: "e", maxConcurrent: 0 });
    expect(limiter.activeCount("e")).toBe(3);
    a();
    b();
    c();
    expect(limiter.activeCount("e")).toBe(0);
  });

  it("上限为 1 时第二个请求必须排队", async () => {
    const limiter = new ConcurrencyLimiter();
    const first = await limiter.acquire({ id: "glm", maxConcurrent: 1 });
    expect(limiter.activeCount("glm")).toBe(1);

    // 第二个不能立刻拿到许可
    let secondAcquired = false;
    const pending = limiter.acquire({ id: "glm", maxConcurrent: 1 }).then((release) => {
      secondAcquired = true;
      return release;
    });

    // 让微任务队列跑一轮，确认它确实没被放行
    await Promise.resolve();
    await Promise.resolve();
    expect(secondAcquired).toBe(false);
    expect(limiter.queuedCount("glm")).toBe(1);

    first();
    const second = await pending;
    expect(secondAcquired).toBe(true);
    expect(limiter.activeCount("glm")).toBe(1);
    second();
    expect(limiter.activeCount("glm")).toBe(0);
  });

  it("上限为 2 时第三个才排队", async () => {
    const limiter = new ConcurrencyLimiter();
    const a = await limiter.acquire({ id: "x", maxConcurrent: 2 });
    const b = await limiter.acquire({ id: "x", maxConcurrent: 2 });
    expect(limiter.activeCount("x")).toBe(2);

    let thirdAcquired = false;
    const pending = limiter.acquire({ id: "x", maxConcurrent: 2 }).then((r) => {
      thirdAcquired = true;
      return r;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(thirdAcquired).toBe(false);

    a();
    const c = await pending;
    expect(thirdAcquired).toBe(true);
    b();
    c();
    expect(limiter.activeCount("x")).toBe(0);
  });

  it("不同端点互不影响", async () => {
    const limiter = new ConcurrencyLimiter();
    const a = await limiter.acquire({ id: "glm", maxConcurrent: 1 });
    // 另一个端点不应该被 GLM 的队列挡住
    const b = await limiter.acquire({ id: "kimi", maxConcurrent: 1 });
    expect(limiter.activeCount("glm")).toBe(1);
    expect(limiter.activeCount("kimi")).toBe(1);
    a();
    b();
  });

  it("排队的顺序是先进先出", async () => {
    const limiter = new ConcurrencyLimiter();
    const held = await limiter.acquire({ id: "q", maxConcurrent: 1 });
    const order: number[] = [];
    const p1 = limiter.acquire({ id: "q", maxConcurrent: 1 }).then((r) => {
      order.push(1);
      r();
    });
    const p2 = limiter.acquire({ id: "q", maxConcurrent: 1 }).then((r) => {
      order.push(2);
      r();
    });
    expect(limiter.queuedCount("q")).toBe(2);
    held();
    await p1;
    await p2;
    expect(order).toEqual([1, 2]);
    expect(limiter.activeCount("q")).toBe(0);
  });

  it("setLimit 调大上限会放行积压的等待者", async () => {
    const limiter = new ConcurrencyLimiter();
    const held = await limiter.acquire({ id: "g", maxConcurrent: 1 });
    let got = false;
    const pending = limiter.acquire({ id: "g", maxConcurrent: 1 }).then((r) => {
      got = true;
      return r;
    });
    await Promise.resolve();
    expect(got).toBe(false);

    limiter.setLimit("g", 2);
    const permit = await pending;
    expect(got).toBe(true);
    held();
    permit();
  });

  it("重复 release 不会把计数压成负数", async () => {
    const limiter = new ConcurrencyLimiter();
    const release = await limiter.acquire({ id: "r", maxConcurrent: 2 });
    release();
    release();
    release();
    expect(limiter.activeCount("r")).toBe(0);
  });

  it("取消后队列仍能继续推进（计数没被卡住）", async () => {
    const limiter = new ConcurrencyLimiter();
    const a = await limiter.acquire({ id: "c", maxConcurrent: 1 });
    const pending = limiter.acquire({ id: "c", maxConcurrent: 1 });
    a();
    const b = await pending;
    expect(limiter.activeCount("c")).toBe(1);
    b();
    expect(limiter.activeCount("c")).toBe(0);
  });
});
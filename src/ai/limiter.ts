/**
 * 并发限流。
 *
 * 为什么必须**真的限流**而不是只在 UI 上显示上限：
 * 实测 GLM Coding Plan 的 Lite / Pro 档只允许 **1** 个并发请求，
 * 超了直接返回 429。「配置里写了 maxConcurrent: 1」和「真的按 1 排队」
 * 是两回事——这个模块负责后者。
 *
 * `maxConcurrent: 0` 表示不限（按 token 计费的端点由上游按账户缩放）。
 *
 * 放前端而不是 Rust 的理由：上限是**每个端点配置**的一项，
 * 而配置存在前端；放后端要多维护一份「端点 id → 信号量」的映射，
 * 且前端刷新后队列重置本来就是可接受的行为（单窗口应用）。
 */

import type { EndpointConfig } from "./provider";

/** 等待某个信号量的许可；返回释放函数 */
type Permit = () => void;

export class ConcurrencyLimiter {
  /** 端点 id → 正在运行的请求数 */
  private readonly running = new Map<string, number>();
  /** 端点 id → 排队中的等待者 */
  private readonly queues = new Map<string, (() => void)[]>();
  /** 端点 id → 上限 */
  private readonly limits = new Map<string, number>();

  /** 更新某端点的上限（设置变更时调用） */
  setLimit(endpointId: string, max: number): void {
    this.limits.set(endpointId, max);
    // 上限被调大时，把积压的等待者放出去
    this.drain(endpointId);
  }

  /** 请求一个许可 */
  async acquire(endpoint: Pick<EndpointConfig, "id" | "maxConcurrent">): Promise<Permit> {
    const limit = endpoint.maxConcurrent;
    // 必须先记下上限：`drain()` 读的是 `this.limits`，
    // 漏了这一步会让队列永远放不出来（死锁）。
    this.limits.set(endpoint.id, limit);

    if (limit <= 0) {
      // 不限：仍然计数，便于可观测
      this.bump(endpoint.id);
      return () => this.release(endpoint.id);
    }

    const current = this.running.get(endpoint.id) ?? 0;
    if (current < limit) {
      this.bump(endpoint.id);
      return () => this.release(endpoint.id);
    }

    // 排队
    return new Promise<Permit>((resolve) => {
      const queue = this.queues.get(endpoint.id) ?? [];
      queue.push(() => {
        this.bump(endpoint.id);
        resolve(() => this.release(endpoint.id));
      });
      this.queues.set(endpoint.id, queue);
    });
  }

  private bump(id: string): void {
    this.running.set(id, (this.running.get(id) ?? 0) + 1);
  }

  private release(id: string): void {
    const next = Math.max(0, (this.running.get(id) ?? 1) - 1);
    this.running.set(id, next);
    this.drain(id);
  }

  /** 有空位就把队首放出去 */
  private drain(id: string): void {
    const limit = this.limits.get(id) ?? 0;
    if (limit <= 0) return;
    const queue = this.queues.get(id);
    if (!queue || queue.length === 0) return;
    while ((this.running.get(id) ?? 0) < limit && queue.length > 0) {
      const next = queue.shift();
      next?.();
    }
    if (queue.length === 0) this.queues.delete(id);
  }

  /** 当前正在运行的请求数（测试与调试用） */
  activeCount(id: string): number {
    return this.running.get(id) ?? 0;
  }

  /** 排队等待的数量（测试与调试用） */
  queuedCount(id: string): number {
    return this.queues.get(id)?.length ?? 0;
  }
}

/** 全局限流器 */
export const limiter = new ConcurrencyLimiter();

/**
 * 设置存储。
 *
 * 持久化层被刻意隔离在 `persist` / `hydrate` 两个函数里：
 * M0 阶段用 localStorage，M2 之后换成 Tauri store（写入 ~/.config/inkstone/settings.json），
 * 上层组件无需改动。
 */

import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_SETTINGS, type DeepPartial, type Settings } from "./schema";

const STORAGE_KEY = "inkstone.settings.v1";

/** 深度合并：用 partial 覆盖 defaults，保证新增设置项在旧配置文件上也有值 */
function mergeSettings<T>(base: T, patch: unknown): T {
  if (patch === null || patch === undefined || typeof patch !== "object") return base;
  if (Array.isArray(base) || typeof base !== "object") return patch as T;

  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    const baseValue = result[key];
    result[key] =
      baseValue !== null &&
      typeof baseValue === "object" &&
      !Array.isArray(baseValue) &&
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
        ? mergeSettings(baseValue, value)
        : value;
  }
  return result as T;
}

function readPersisted(): Partial<Settings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<Settings>;
  } catch {
    // 设置文件损坏不应导致启动失败，回退到默认值
    return {};
  }
}

let state: Settings = mergeSettings(DEFAULT_SETTINGS, readPersisted());

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): Settings {
  return state;
}

function persist(next: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 隐私模式下 localStorage 可能不可写，忽略即可（设置仍在内存中生效）
  }
}

/** 局部更新设置，深合并 */
export function updateSettings(patch: DeepPartial<Settings>): void {
  state = mergeSettings(state, patch);
  persist(state);
  emit();
}

/** 重置为默认值 */
export function resetSettings(): void {
  state = mergeSettings(DEFAULT_SETTINGS, {});
  persist(state);
  emit();
}

/** 在 M2 之后由 Tauri 侧调用，用磁盘上的配置覆盖内存中的配置 */
export function hydrateSettings(persisted: DeepPartial<Settings>): void {
  state = mergeSettings(state, persisted);
  persist(state);
  emit();
}

/** 订阅设置变化 */
export function useSettings(): [Settings, (patch: DeepPartial<Settings>) => void] {
  const settings = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const update = useCallback((patch: DeepPartial<Settings>) => updateSettings(patch), []);
  return [settings, update];
}

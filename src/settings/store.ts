/**
 * 设置存储。
 *
 * 持久化层被刻意隔离在 `persist` / `hydrate` 两个函数里：
 * M0 阶段用 localStorage，M2 之后换成 Tauri store（写入 ~/.config/inkstone/settings.json），
 * 上层组件无需改动。
 */

import { useCallback, useSyncExternalStore } from "react";
import {
  DEFAULT_SETTINGS,
  type AppearanceSettings,
  type DeepPartial,
  type EditorSettings,
  type Settings,
} from "./schema";

const STORAGE_KEY = "inkstone.settings.v1";

/**
 * 设置版本迁移。
 *
 * v1 → v2：`editor.autoPair`（布尔）拆成 `editor.autoPairMode`（off/basic/markdown）。
 *
 * v2 → v3：`appearance.fontFamily` / `appearance.monoFontFamily` 的**旧默认值**
 * 改成「空 = 跟随主题」。
 *
 * 必须显式迁移，不能指望 `mergeSettings`：
 *   - 深合并只做「按 key 覆盖」，旧的 `autoPair` key 不会被自动删掉，
 *     残留的布尔值会和新字段一起躺在 localStorage 里；
 *   - 而且布尔值 → 字符串的语义映射（true → markdown / false → off）
 *     只有迁移层知道该怎么做。
 *
 * ## 为什么要迁移字体那一项
 *
 * 旧默认值是**具体的字体栈**，不是「没设置」。
 * 不迁移的话：老用户存着那个栈 → 迁移后仍然是「设置过的字体」→
 * 主题声明的字体（学术主题的衬线体）对他们依然不生效，
 * 而新装的用户是生效的——**同一版本里两拨人表现不一样**。
 *
 * 判据是「**恰好等于旧默认值**」：用户自己填了那个栈算他选过，
 * 但那与默认值无从区分，所以按「没设过」处理——
 * 后果只是他的学术主题变回衬线体，正是这个主题本来的样子。
 */

/** 旧版的正文字体默认值（迁移判据） */
const LEGACY_FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';

/** 旧版的等宽字体默认值（迁移判据） */
const LEGACY_MONO_FONT_FAMILY =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

function migratePersisted(raw: DeepPartial<Settings>): DeepPartial<Settings> {
  let result = raw;

  // v1 → v2：autoPair 布尔 → autoPairMode
  const editor = raw.editor as
    (DeepPartial<EditorSettings> & { autoPair?: unknown }) | undefined;
  if (editor && editor.autoPair !== undefined) {
    const { autoPair, ...rest } = editor;
    const migrated: DeepPartial<EditorSettings> = { ...rest };
    if (migrated.autoPairMode === undefined) {
      migrated.autoPairMode = autoPair === true ? "markdown" : "off";
    }
    result = { ...result, editor: migrated };
  }

  // v2 → v3：旧默认字体 → 「没设过」
  const appearance = raw.appearance as
    (DeepPartial<AppearanceSettings> & { fontFamily?: unknown }) | undefined;
  if (appearance) {
    const migrated: Partial<AppearanceSettings> = { ...appearance };
    if (migrated.fontFamily === LEGACY_FONT_FAMILY) {
      migrated.fontFamily = "";
    }
    if (migrated.monoFontFamily === LEGACY_MONO_FONT_FAMILY) {
      migrated.monoFontFamily = "";
    }
    result = { ...result, appearance: migrated };
  }

  return result;
}

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

let state: Settings = mergeSettings(DEFAULT_SETTINGS, migratePersisted(readPersisted()));

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * 订阅设置变化（给 React 之外的调用点用）。
 *
 * `useSettings()` 只在组件里用得上；i18n 这类**跨切面的运行时订阅者**
 * 需要一个不依赖 React 的入口——语言一变，所有用 `t()` 渲染的界面都要跟着变。
 */
export function subscribeSettings(listener: () => void): () => void {
  return subscribe(listener);
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

/**
 * 同步读取当前设置。
 *
 * 给**非 React 的调用点**用（剪贴板事件、导出管线等）——
 * 这些地方拿不到 `useSettings()`，但仍必须用用户的真实设置，
 * 否则「编辑器里是公式、复制出去不是」这类分叉就出现了。
 *
 * 不要在组件里用它：组件应当用 `useSettings()`，那才是会触发重渲染的那条路。
 */
export function readSettings(): Settings {
  return state;
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
  // 磁盘上的配置同样可能是旧版本写的，所以**必须走迁移**。
  // 漏掉这一步的话：走 localStorage 的用户拿的是迁移后的值，
  // 走 Tauri store 的用户拿的是迁移前的值——同一版本两套行为，
  // 而且只在打包版里复现（开发时用的是 localStorage 那条路）。
  state = mergeSettings(state, migratePersisted(persisted));
  persist(state);
  emit();
}

/** 订阅设置变化 */
export function useSettings(): [Settings, (patch: DeepPartial<Settings>) => void] {
  const settings = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const update = useCallback((patch: DeepPartial<Settings>) => updateSettings(patch), []);
  return [settings, update];
}

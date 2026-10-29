/**
 * 模型列表的**模块级** store。
 *
 * ## 为什么不在组件里
 *
 * 早先模型列表是 `AiSettingsSection` 的组件内状态：
 * 面板一关，列表就没了；AI 面板（浮层）里也没法显示同一个列表——
 * 于是「在设置页选好的模型」与「在 AI 面板里选的模型」成了两件事。
 *
 * 而模型列表这件事**天生是跨面板共享**的：
 * 它按端点 id 归属（见 `settings/schema.ts` 的 `modelOverrides`），
 * 端点是全局配置，列表理应跟着端点走，而不是跟着某个面板的生死走。
 *
 * 架构上与 `panel-store.ts` 同一条规矩：
 * **状态放模块级，组件用 `useSyncExternalStore` 订阅。**
 *
 * ## 为什么快照是整个 state 而不是派生对象
 *
 * `useSyncExternalStore` 要求快照在没变化时**引用相等**。
 * 若 `useModelList(id)` 直接返回 `{ entry, loading }` 这种新对象，
 * 每次渲染都是新引用 → React 会判定「一直在变」→ 无限重渲染。
 *
 * 所以这里只暴露**稳定的 state 快照**，
 * 由调用方自己按 id 取值（`state.lists[id]`）——
 * 派生是纯计算，不产生新引用。
 */

import { useSyncExternalStore } from "react";

import type { ModelInfo } from "./models";

/** 某个端点的模型列表结果 */
export interface ModelListEntry {
  /** 拿到的模型；失败时是空数组 */
  models: ModelInfo[];
  /** 失败原因；成功时为 null */
  error: string | null;
}

/** 整个 store 的状态 */
export interface ModelListState {
  /** 端点 id → 该端点的列表结果 */
  lists: Record<string, ModelListEntry>;
  /**
   * 正在取列表的端点 id。
   *
   * 记 id 而不是布尔值：用户在请求途中换了端点，
   * 旧请求回来时不该把新端点的加载态关掉。
   */
  loadingFor: string | null;
}

const initialState: ModelListState = {
  lists: {},
  loadingFor: null,
};

let state: ModelListState = initialState;

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ModelListState {
  return state;
}

function setState(patch: Partial<ModelListState>): void {
  state = { ...state, ...patch };
  emit();
}

/* ── 对外动作 ── */

/** 记下某个端点的模型列表结果 */
export function setModelList(id: string, entry: ModelListEntry): void {
  setState({ lists: { ...state.lists, [id]: entry } });
}

/**
 * 设置「正在取哪个端点的列表」。
 *
 * 传 `null` 表示没有加载中的请求。
 * 但**只在自己那次请求结束时才该清**——
 * 所以调用方要按 id 比对（见 `finishModelListLoading`）。
 */
export function setModelListLoading(id: string | null): void {
  if (state.loadingFor === id) return;
  setState({ loadingFor: id });
}

/**
 * 结束某个端点的加载态。
 *
 * ## 为什么要有这个函数（而不是调用方自己比对）
 *
 * 调用方如果写成
 * `if (loadingFor === id) setModelListLoading(null)`，
 * 那个 `loadingFor` 是**渲染时的快照**——
 * 请求开始时它是 `null`，请求结束时它仍然是 `null`，
 * 于是条件永远不成立，加载态**永远清不掉**：
 * 按钮停在「正在获取模型列表…」而且永远是禁用的。
 *
 * 这里读的是 store 的**当前**状态，比的是「现在正在加载的是不是我」，
 * 所以中途换了端点也不会误关别人的加载态。
 */
export function finishModelListLoading(id: string): void {
  if (state.loadingFor !== id) return;
  setState({ loadingFor: null });
}

/**
 * 清掉某个端点的列表。
 *
 * 端点被删掉时必须调它：否则列表里会留着一个已经不存在的端点，
 * 而钥匙串里的密钥也可能还在（两件事要一起清，见 `removeCustomEndpoint`）。
 */
export function clearModelList(id: string): void {
  if (!(id in state.lists)) return;
  const lists = { ...state.lists };
  delete lists[id];
  setState({
    lists,
    loadingFor: state.loadingFor === id ? null : state.loadingFor,
  });
}

/** 直接读当前状态（给非 React 的调用点与测试用） */
export function getModelListState(): ModelListState {
  return state;
}

/** React 订阅（返回整个 state；由调用方按端点 id 取值） */
export function useModelListState(): ModelListState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** 测试用：回到初始状态 */
export function resetModelListState(): void {
  state = initialState;
  emit();
}

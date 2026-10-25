/**
 * 意图总线：命令表 → React 的单向出口。
 *
 * 有些命令的实现在编辑器之外——「切到源码模式」要走 `EditorSurface` 的 handle，
 * 「保存」要走 `App` 的文件操作。命令表不该因此依赖 React，所以改成发意图：
 *
 * ```
 * 命令表 --emitIntent--> 意图总线 --subscribe--> React 组件 --调 handle-->
 * ```
 *
 * 方向永远是单向的。反过来（React 主动触发命令）用 `runCommand` 就行，不需要总线。
 */

/** 目前已知的意图 */
export type Intent =
  | "view.live"
  | "view.dimmed"
  | "view.source"
  | "view.toggle-focus-mode"
  | "view.toggle-typewriter-mode"
  | "file.new"
  | "file.save"
  | "file.export";

type Listener = (intent: Intent) => void;

const listeners = new Set<Listener>();

/** 发出意图 */
export function emitIntent(intent: Intent): void {
  for (const listener of listeners) listener(intent);
}

/**
 * 订阅意图。返回取消订阅函数。
 *
 * 用订阅而不是存字段：组件卸载后必须能干净退订，
 * 否则会对着已销毁的组件调 handle。
 */
export function onIntent(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

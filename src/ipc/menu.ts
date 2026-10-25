/**
 * 菜单动作桥接：把原生菜单事件翻译成前端可用的动作。
 *
 * 约定：Rust 侧 `on_menu_event` 收到点击后，以菜单项 id 作为事件名 emit 到前端。
 * 这里统一监听并派发到内部的 action 总线。
 *
 * ## 动作清单的来源
 *
 * `MenuAction` 类型与监听列表都从 `src/shortcuts.ts` 的 `MENU_ACTION_IDS` 派生。
 * 之前这个文件里**同一个清单写了两遍**（联合类型 + 数组），
 * 加一个动作要改两处，漏一处就静默失效——菜单点了没反应。
 */

import { MENU_ACTION_IDS, type MenuAction } from "@/shortcuts";

export type { MenuAction };

type ActionHandler = (action: MenuAction) => void;

const handlers = new Map<MenuAction, Set<ActionHandler>>();

/** 订阅菜单动作，返回取消订阅函数 */
export function onMenuAction(action: MenuAction, handler: ActionHandler): () => void {
  let set = handlers.get(action);
  if (!set) {
    set = new Set();
    handlers.set(action, set);
  }
  set.add(handler);
  return () => {
    set?.delete(handler);
  };
}

/** 触发一个菜单动作（供前端自身调用，例如快捷键） */
export function dispatchMenuAction(action: MenuAction): void {
  for (const handler of handlers.get(action) ?? []) handler(action);
}

/**
 * 在 Tauri 环境中挂载原生菜单监听。
 * 在浏览器里（pnpm dev）为空操作，前端开发不受影响。
 */
export async function initMenuBridge(): Promise<void> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;

  const { listen } = await import("@tauri-apps/api/event");

  await Promise.all(
    MENU_ACTION_IDS.map((action) =>
      listen(action, () => dispatchMenuAction(action)).then((unlisten) => {
        // 保存 unlisten 以便热重载时清理
        unlisteners.push(unlisten);
      }),
    ),
  );
}

const unlisteners: (() => void)[] = [];

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    for (const unlisten of unlisteners) unlisten();
    unlisteners.length = 0;
  });
}

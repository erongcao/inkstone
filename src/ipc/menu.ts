/**
 * 菜单动作桥接：把原生菜单事件翻译成前端可用的动作。
 *
 * 约定：Rust 侧 `on_menu_event` 收到点击后，以菜单项 id 作为事件名 emit 到前端。
 * 这里统一监听并派发到内部的 action 总线。
 */

export type MenuAction =
  | "new-document"
  | "open-document"
  | "save-document"
  | "save-document-as"
  | "preferences"
  | "find"
  | "replace"
  | "copy-as-markdown"
  | "toggle-sidebar"
  | "toggle-source-mode"
  | "toggle-focus-mode"
  | "toggle-typewriter-mode"
  | "zoom-in"
  | "zoom-out"
  | "zoom-reset"
  | "markdown-reference"
  | "shortcuts"
  | "open-homepage";

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
  const actions: MenuAction[] = [
    "new-document",
    "open-document",
    "save-document",
    "save-document-as",
    "preferences",
    "find",
    "replace",
    "copy-as-markdown",
    "toggle-sidebar",
    "toggle-source-mode",
    "toggle-focus-mode",
    "toggle-typewriter-mode",
    "zoom-in",
    "zoom-out",
    "zoom-reset",
    "markdown-reference",
    "shortcuts",
    "open-homepage",
  ];

  await Promise.all(
    actions.map((action) =>
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

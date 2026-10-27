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
 * 当前**有人处理**的菜单动作 id。
 *
 * 「菜单项建出来了，前端没人处理」是个**静默**的洞：
 * 点了没反应，也没有任何报错。把注册表摊开看一眼，
 * 就能立刻看出哪个 id 没人接。
 *
 * 给测试与诊断用，不参与业务逻辑。
 */
export function subscribedMenuActions(): MenuAction[] {
  return [...handlers.entries()].filter(([, set]) => set.size > 0).map(([id]) => id);
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

/**
 * 把侧边栏的可见性同步给原生菜单的「显示侧边栏」复选项。
 *
 * ## 为什么需要它
 *
 * 侧边栏可以从**三个**地方变：原生菜单的「显示/隐藏侧边栏」、
 * 复选项本身、以及面板上的折叠按钮。而复选项只有「勾 / 不勾」两个状态可显示——
 * 一个不反映实际状态的勾选框比没有更糟：用户会以为侧边栏已经收起来了。
 *
 * 浏览器开发模式没有原生菜单，直接跳过。
 *
 * 失败只警告不抛错：勾选框没同步上，不该让整个应用出问题。
 */
export async function syncSidebarChecked(checked: boolean): Promise<void> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_sidebar_checked", { checked });
  } catch (error) {
    console.warn("[menu] 同步侧边栏复选项失败：", error);
  }
}

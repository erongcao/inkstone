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

/**
 * 目前已知的意图。
 *
 * 用**带 `type` 字段的对象**而不是裸字符串：
 * 「导出指定格式」这类意图要带参数（导的是哪个格式），字符串装不下参数。
 * 判别联合让 TypeScript 能根据 `type` 收窄出对应的参数。
 */
export type Intent =
  | { type: "view.live" }
  | { type: "view.dimmed" }
  | { type: "view.source" }
  | { type: "view.toggle-focus-mode" }
  | { type: "view.toggle-typewriter-mode" }
  /**
   * 缩放：放大 / 缩小 / 实际大小。
   *
   * 改的是 `appearance.fontSize`（也就是 `--ink-font-size`），
   * 与设置面板里「外观 → 字号」是同一个设置——
   * 所以原生菜单的三个菜单项、命令面板的三条命令、快捷键表里的三行，
   * 落到的是**同一件事**。
   */
  | { type: "view.zoom-in" }
  | { type: "view.zoom-out" }
  | { type: "view.zoom-reset" }
  | { type: "file.new" }
  | { type: "file.save" }
  /**
   * 打开导出面板。
   *
   * 带 `formatId` 时是「直接导出这个格式」——
   * 用户在设置里给某个导出项绑了快捷键，按下去就不该再开面板让用户点一次。
   */
  | { type: "file.export"; formatId?: string }
  /**
   * 打开 AI 面板。
   *
   * 带 `tab` 时直接落到那个分区（命令面板里「AI：润色」这类条目）。
   */
  | { type: "ai.open"; tab?: "rewrite" | "summarize" }
  /**
   * 检查更新。
   *
   * 原生菜单的「检查更新…」与命令面板里的是**同一个动作**——
   * 两条入口，一条执行路径（都在 App 里落到 `runUpdateCheck`）。
   */
  | { type: "app.check-update" }
  /**
   * 打开「帮助」里的两个速查面板。
   *
   * 同样是**两条入口一条执行路径**：原生菜单的「快捷键一览」/
   * 「Markdown 语法参考」与命令面板里的是同一个动作。
   *
   * 为什么命令面板也要有：原生菜单只在 Tauri 里存在，
   * 浏览器构建（`pnpm dev:web`）下菜单是空的——
   * 没有第二条入口，这些功能在浏览器里就**完全触达不到**。
   */
  | { type: "app.show-shortcuts" }
  | { type: "app.show-markdown-reference" };

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

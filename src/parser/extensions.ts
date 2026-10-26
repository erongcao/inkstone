/**
 * unified `Data` 里的扩展挂载点。
 *
 * ## 为什么要自己描述一份
 *
 * unified 的 `Data` 类型只声明了 `settings`。
 * `micromarkExtensions` / `fromMarkdownExtensions` / `toMarkdownExtensions`
 * 这三个键是 micromark / mdast 生态约定的「扩展挂载点」，
 * 由各自生态的包通过**模块增强**声明——
 * 但那些包是传递依赖，本项目 import 不到它们的类型。
 *
 * 与其把类型全提升成直接依赖（多三个包，只为了拿几个类型），
 * 不如在这里自己描述一份最小结构——
 * 与 `highlight.ts` 里原本那份合并到一处，避免同一个形状写三遍。
 */

/** unified 的 `Data` 里，插件之间传递扩展用的那几个数组 */
export interface ExtensionMounts {
  /** micromark 分词器扩展 */
  micromarkExtensions?: unknown[];
  /** mdast 解析扩展（把 token 变成 mdast 节点） */
  fromMarkdownExtensions?: unknown[];
  /** mdast 序列化扩展（把 mdast 节点变回 Markdown） */
  toMarkdownExtensions?: unknown[];
}

/** 把一个扩展挂到 unified 的 data 上 */
export function mount(
  data: ExtensionMounts,
  key: keyof ExtensionMounts,
  extension: unknown,
): void {
  const list = data[key] ?? (data[key] = []);
  list.push(extension);
}

/** 把一组扩展挂到 unified 的 data 上 */
export function mountAll(
  data: ExtensionMounts,
  key: keyof ExtensionMounts,
  extensions: readonly unknown[],
): void {
  const list = data[key] ?? (data[key] = []);
  list.push(...extensions);
}

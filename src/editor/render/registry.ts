/**
 * 块级渲染器注册表。
 *
 * 为什么用注册表而不是硬编码 if-else：
 *   表格、公式、图表、代码高亮是四个独立的能力，
 *   每个都要能单独开关、单独测试、单独扩展。
 *   装饰器管线只认「一组渲染器」，不关心具体有哪些。
 */

import type { BlockRenderer } from "./types";

const renderers: BlockRenderer[] = [];

/**
 * 注册一个块级渲染器。
 *
 * **幂等**：同 id 的重复注册会覆盖而不是报错。
 * 因为 `livePreview()` 可能在多个编辑器实例上被调用，
 * 每次都注册一遍是正常的。
 */
export function registerBlockRenderer(renderer: BlockRenderer): void {
  const index = renderers.findIndex((r) => r.id === renderer.id);
  if (index >= 0) {
    renderers[index] = renderer;
    return;
  }
  renderers.push(renderer);
}

/** 取出全部已注册的渲染器 */
export function blockRenderers(): readonly BlockRenderer[] {
  return renderers;
}

/** 清空注册表（仅测试用） */
export function clearBlockRenderers(): void {
  renderers.length = 0;
}

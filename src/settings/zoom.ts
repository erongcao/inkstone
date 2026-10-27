/**
 * 缩放：放大 / 缩小 / 实际大小。
 *
 * ## 它改的是什么
 *
 * `appearance.fontSize`——也就是 `--ink-font-size` 这个 CSS 变量。
 * 它挂在 `html` 上，所以**整个应用**都会跟着变（像浏览器的页面缩放）。
 *
 * 这与设置面板里「外观 → 字号」是**同一个设置**，
 * 所以缩放不是新的一套概念，而是给同一个设置加三个快捷入口
 * （原生菜单的「放大 / 缩小 / 实际大小」与 ⌘= / ⌘- / ⌘0）。
 *
 * ## 为什么按**预设档位**走，而不是 ±1px
 *
 * 设置面板的字号是一个**下拉框**（`FONT_SIZE_PRESETS`），不是自由输入框。
 * 缩放如果 ±1px，就会跳到下拉框里根本不存在的值——
 * 用户再去设置面板一看，那个值不在列表里（浏览器会回退成第一项）。
 * 所以缩放 = **在预设里上/下一档**。
 *
 * ## 边界
 *
 * 到头就停：最大的档再放大没意义（再大就该换主题了），最小的档同理。
 */

import { DEFAULT_SETTINGS, FONT_SIZE_PRESETS } from "./schema";

/**
 * 实际大小 = 默认字号。
 *
 * 从 `DEFAULT_SETTINGS` 取而不是写死一个 16：
 * 默认值改了，这里跟着改——两处各写一个数字，迟早会对不上。
 */
export const DEFAULT_FONT_SIZE = DEFAULT_SETTINGS.appearance.fontSize;

/** 升序的预设档位 */
const PRESETS: number[] = [...FONT_SIZE_PRESETS].sort((a, b) => a - b);

/**
 * 往大一档走。
 *
 * 当前值不在预设里也没关系（老设置、手改过的值）：
 * 取**第一个比它大的**预设；一个都没有就停在最大档。
 */
export function zoomIn(current: number): number {
  const next = PRESETS.find((size) => size > current);
  return next ?? PRESETS[PRESETS.length - 1];
}

/**
 * 往小一档走。
 *
 * 取**最后一个比它小的**预设；一个都没有就停在最小档。
 */
export function zoomOut(current: number): number {
  let result = PRESETS[0];
  for (const size of PRESETS) {
    if (size < current) result = size;
    else break;
  }
  return result;
}

/** 回到实际大小（默认字号） */
export function zoomReset(): number {
  return DEFAULT_FONT_SIZE;
}

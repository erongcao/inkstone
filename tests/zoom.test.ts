/**
 * 缩放（放大 / 缩小 / 实际大小）的档位计算。
 *
 * 这组测试守的是**缩放语义本身**：
 * 缩放改的是 `appearance.fontSize`，而设置面板里的字号是一个**下拉框**
 * （`FONT_SIZE_PRESETS`）——所以缩放必须**落在预设档位上**。
 *
 * 一旦有人把缩放改成 ±1px，就会出现「设置面板里没有这个值」的破口：
 * 用户把字号调到 17，缩放一次变成 18，再打开设置面板一看，
 * 下拉框里根本没有 18 —— 浏览器回退到第一项，字号突然跳回 13。
 * 「下拉框只显示预设值」这个特性，是这里所有断言的根据。
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_FONT_SIZE, zoomIn, zoomOut, zoomReset } from "@/settings/zoom";
import { FONT_SIZE_PRESETS } from "@/settings/schema";

const MIN_SIZE = FONT_SIZE_PRESETS[0];
const MAX_SIZE = FONT_SIZE_PRESETS[FONT_SIZE_PRESETS.length - 1];

describe("缩放", () => {
  it("放大往大的一档走", () => {
    expect(zoomIn(13)).toBe(14);
    expect(zoomIn(16)).toBe(17);
    expect(zoomIn(20)).toBe(22);
  });

  it("缩小往小的一档走", () => {
    expect(zoomOut(16)).toBe(15);
    expect(zoomOut(22)).toBe(20);
    expect(zoomOut(14)).toBe(13);
  });

  it("到头就停（不越界、不回绕）", () => {
    // 已经最大了，再放大还是最大——**不回绕到最小**
    expect(zoomIn(MAX_SIZE)).toBe(MAX_SIZE);
    // 已经最小了，再缩小还是最小
    expect(zoomOut(MIN_SIZE)).toBe(MIN_SIZE);
  });

  it("当前值不在预设里时，落到最近的可用档位", () => {
    // 老设置或手改过的值（比如 15.5）：放大落到第一个比它大的 16，缩小落到 15
    expect(zoomIn(15.5)).toBe(16);
    expect(zoomOut(15.5)).toBe(15);
    // 比最小档还小：放大落到最小的预设，缩小也停在最小
    expect(zoomIn(9)).toBe(MIN_SIZE);
    expect(zoomOut(9)).toBe(MIN_SIZE);
    // 比最大档还大：放大停在最大，缩小落到 22
    expect(zoomIn(99)).toBe(MAX_SIZE);
    expect(zoomOut(99)).toBe(MAX_SIZE);
  });

  it("实际大小 = 默认字号（与设置默认值同源）", () => {
    expect(zoomReset()).toBe(DEFAULT_FONT_SIZE);
    // 默认字号本身必须在预设里，否则「实际大小」这个档位是空的
    expect(FONT_SIZE_PRESETS).toContain(DEFAULT_FONT_SIZE);
  });

  it("每一档的往返都是恒等的：放大再缩小回到原处", () => {
    for (const size of FONT_SIZE_PRESETS) {
      if (size === MAX_SIZE) continue;
      expect(zoomOut(zoomIn(size))).toBe(size);
    }
  });

  it("产出的值永远落在预设档位内", () => {
    for (const size of FONT_SIZE_PRESETS) {
      expect(FONT_SIZE_PRESETS).toContain(zoomIn(size));
      expect(FONT_SIZE_PRESETS).toContain(zoomOut(size));
    }
  });
});

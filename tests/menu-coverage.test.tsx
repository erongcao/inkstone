/**
 * 原生菜单动作的**覆盖度**守卫。
 *
 * ## 它守的是什么
 *
 * 「菜单项建出来了，前端没人处理」——点了没反应，**没有任何报错**。
 *
 * 这个洞真实发生过，而且一次埋了四个：
 * `toggle-source-mode` / `zoom-in` / `zoom-out` / `zoom-reset`。
 * 它们在 Rust 侧建了菜单项、加速键也登记了，
 * 但前端从来没订阅过——用户点了菜单，或者按了 ⌘/、⌘=，什么都不会发生。
 *
 * ## 现有的守卫链条，以及它的断点
 *
 * | 环节 | 谁在守 |
 * |---|---|
 * | `menu.rs` 建的菜单项 ↔ `shortcuts.rs` 的 `MENU_ITEM_IDS` | Rust 测试（手工同步的清单） |
 * | `MENU_ITEM_IDS` ↔ `shortcuts.json` 的 `actions` | Rust 测试 |
 * | `shortcuts.json` ↔ `src/shortcuts.ts` 的 `MENU_ACTION_IDS` | `pnpm gen:shortcuts --check` |
 * | **`MENU_ACTION_IDS` ↔ 前端真的有人处理** | **← 本文件（之前是空的）** |
 *
 * 最后这一环之前没人守：清单上有的动作，前端可以一个都不处理。
 *
 * ## 为什么查**运行时注册表**，而不是扫源码
 *
 * 扫源码（grep `onMenuAction("…")`）看起来更直接，但它会被注释骗：
 * 被注释掉的处理者照样能被 grep 到 → 守卫照样绿 →
 * 而那个菜单项在真实运行时还是死的。
 *
 * 运行时注册表（`subscribedMenuActions()`）是**事实**：
 * App 挂载之后，谁真的订阅了，一目了然。
 */

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import App from "../src/App";
import { subscribedMenuActions } from "@/ipc/menu";
import { MENU_ACTION_IDS } from "@/shortcuts";

/*
 * 不用自己 cleanup：`tests/setup.ts` 里已经注册了全局 afterEach → cleanup()。
 * React 树一卸载，App 的菜单订阅就退了订（onMenuAction 返回的退订函数），
 * 所以「注册表」在用例之间是干净的。
 */
describe("原生菜单动作的覆盖度", () => {
  it("清单里的每个动作都有人处理（不然点了没反应）", () => {
    render(<App />);

    const subscribed = new Set(subscribedMenuActions());
    const dead = MENU_ACTION_IDS.filter((id) => !subscribed.has(id));

    expect(
      dead,
      `这些菜单动作注册了却没人处理：${dead.join("、")}。` +
        `菜单项建出来了、加速键也登记了，但前端没订阅——点了不会报错，也不会发生任何事。`,
    ).toEqual([]);
  });

  it("订阅的 id 都在动作清单里（清单外的 id 永远不会被触发）", () => {
    render(<App />);

    const known: readonly string[] = MENU_ACTION_IDS;
    const unknown = subscribedMenuActions().filter((id) => !known.includes(id));

    expect(
      unknown,
      `这些 id 不在 MENU_ACTION_IDS 里：${unknown.join("、")}。` +
        `菜单桥只监听清单里的动作，订阅清单外的 id 等于白写。`,
    ).toEqual([]);
  });

  it("这条守卫本身没有空转（自检：注册数不为零）", () => {
    /*
     * 防止上面两条因为「App 没挂上」而**假绿**：
     * 一个处理者都没注册时，"dead 为空"恰好也是 0 项，看起来就通过了。
     */
    render(<App />);

    expect(subscribedMenuActions().length).toBeGreaterThan(MENU_ACTION_IDS.length / 2);
  });
});

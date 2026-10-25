/**
 * 从快捷键注册表生成原生菜单的加速键清单。
 *
 * ## 为什么是「生成」而不是「手写」
 *
 * 原生菜单的加速键以前直接写在 `src-tauri/src/menu.rs` 里。
 * 于是同一批键位有两份真相源——TS 注册表一份、Rust 菜单一份——
 * 而它们**永远不会互相提醒**：
 *
 *   - M4-6：⌘E 同时给了原生菜单和 CM6，NSApp 先吃按键，CM6 那个功能静默失效
 *   - 「放大」菜单项写的是 `CmdOrCtrl+Plus`，而 muda 的物理键表里**没有 Plus**，
 *     Tauri 建菜单时用 `.parse().ok()`——解析失败被静默吞掉，
 *     菜单项直接没有快捷键，还不报错
 *
 * 生成之后，Rust 侧**一个加速键字符串都不写死**：
 * 全部来自 `src-tauri/shortcuts.json`，那份文件由本脚本从
 * `src/shortcuts.ts` 生成，CI 负责检查它没过期。
 *
 * ## 输出
 *
 * `src-tauri/shortcuts.json`：
 *
 * ```json
 * {
 *   "actions": ["new-document", "..."],
 *   "accelerators": { "new-document": "CmdOrCtrl+N", "...": "..." }
 * }
 * ```
 *
 * - `actions`：原生菜单的全部动作 id。前端的 `MenuAction` 类型由
 *   `MENU_ACTION_IDS` 派生，Rust 侧有测试断言「菜单里建的每个 id 都在这张表里」。
 * - `accelerators`：动作 id → Tauri 加速键。没有加速键的菜单项不在这个映射里。
 *
 * ## 用法
 *
 * ```bash
 * pnpm gen:shortcuts           # 生成 / 更新
 * pnpm gen:shortcuts -- --check  # 只校验是否最新（CI 用，不改工作区）
 * ```
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MENU_ACTION_IDS,
  MENU_CHROME,
  SHORTCUTS,
  toAccelerator,
} from "../src/shortcuts";

const here = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(here, "../src-tauri/shortcuts.json");

/**
 * macOS 的系统保留键。
 *
 * 这些键由系统菜单占用（muda 的预定义项就是这些），
 * 我们再声明一遍的话，AppKit 取**菜单树里靠前**的那个——
 * 应用菜单在前，于是我们的菜单项会被系统项吃掉，
 * 而且**不报错**：菜单显示得好好的，按下去没反应。
 *
 * 这一条是「替换」从 ⌘H 改成 ⌃H 的原因。
 */
const MACOS_RESERVED = new Set(["CmdOrCtrl+H", "CmdOrCtrl+Q", "CmdOrCtrl+W", "CmdOrCtrl+M"]);

/** 收集注册表里所有带加速键的条目 */
function collect(): { actionId: string; accelerator: string }[] {
  const entries = [
    ...SHORTCUTS.filter((item) => item.actionId).map((item) => ({
      actionId: item.actionId as string,
      accelerator: toAccelerator(item.key),
    })),
    ...MENU_CHROME.map((item) => ({
      actionId: item.actionId,
      accelerator: toAccelerator(item.key),
    })),
  ];
  // 按 MENU_ACTION_IDS 的顺序输出——文件内容稳定，diff 只有真变化时才会出现
  const order = new Map<string, number>(MENU_ACTION_IDS.map((id, index) => [id, index]));
  return entries.sort(
    (a, b) => (order.get(a.actionId) ?? 999) - (order.get(b.actionId) ?? 999),
  );
}

/** 生成前的自查；有错就直接失败，别把坏清单写出去 */
function validate(entries: { actionId: string; accelerator: string }[]): void {
  const problems: string[] = [];

  // 1. actionId 必须都在 MENU_ACTION_IDS 里（否则前端永远收不到那个菜单动作）
  const knownActions: readonly string[] = MENU_ACTION_IDS;
  for (const entry of entries) {
    if (!knownActions.includes(entry.actionId)) {
      problems.push(`动作 id "${entry.actionId}" 不在 MENU_ACTION_IDS 里`);
    }
  }

  // 2. 同一个动作 id 不能有两份加速键
  const byAction = new Map<string, string>();
  for (const entry of entries) {
    const prev = byAction.get(entry.actionId);
    if (prev) {
      problems.push(
        `动作 "${entry.actionId}" 有两个加速键：${prev} 与 ${entry.accelerator}`,
      );
    }
    byAction.set(entry.actionId, entry.accelerator);
  }

  // 3. 两个不同动作不能共用一个加速键（后绑的那个会静默失灵）
  const byAccelerator = new Map<string, string>();
  for (const entry of entries) {
    const prev = byAccelerator.get(entry.accelerator);
    if (prev && prev !== entry.actionId) {
      problems.push(
        `加速键 ${entry.accelerator} 被 "${prev}" 和 "${entry.actionId}" 同时占用`,
      );
    }
    byAccelerator.set(entry.accelerator, entry.actionId);
  }

  // 4. 不能撞上 macOS 的系统保留键
  for (const entry of entries) {
    if (MACOS_RESERVED.has(entry.accelerator)) {
      problems.push(
        `加速键 ${entry.accelerator}（"${entry.actionId}"）与 macOS 系统键冲突`,
      );
    }
  }

  if (problems.length > 0) {
    console.error("❌ 快捷键注册表有问题：");
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    process.exit(1);
  }
}

function build(): string {
  const entries = collect();
  validate(entries);

  const accelerators: Record<string, string> = {};
  for (const entry of entries) accelerators[entry.actionId] = entry.accelerator;

  return `${JSON.stringify({ actions: [...MENU_ACTION_IDS], accelerators }, null, 2)}\n`;
}

const content = build();

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(OUTPUT, "utf-8");
  } catch {
    console.error(`❌ ${OUTPUT} 不存在，请先运行 pnpm gen:shortcuts`);
    process.exit(1);
  }
  if (current !== content) {
    console.error("❌ src-tauri/shortcuts.json 已过期，请运行 pnpm gen:shortcuts");
    process.exit(1);
  }
  console.log("✅ src-tauri/shortcuts.json 与注册表一致");
} else {
  writeFileSync(OUTPUT, content, "utf-8");
  const count = Object.keys(JSON.parse(content).accelerators).length;
  console.log(`✅ 已生成 ${OUTPUT}（${MENU_ACTION_IDS.length} 个动作 / ${count} 个加速键）`);
}

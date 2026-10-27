/**
 * 设置项的覆盖度守卫。
 *
 * ## 这条守卫守的是什么
 *
 * 本项目反复踩的坑是「看起来能跑、其实没跑」。
 * 2026-10-28 一次就挖出**六个**设置项：设置面板里的复选框能点、能存，
 * 但代码里**没有任何地方读它**——
 *
 *   editor.smartPunctuation / editor.strictMode /
 *   editor.indentFirstLine / editor.indentParagraph /
 *   markdown.autoNumberEquations / general.sendAnonymousStats
 *
 * 用户看到的是「我改了设置但什么都没变」，却无处可说。
 * 最后一个尤其糟：它许了一个**不会兑现的隐私承诺**
 * （全项目没有任何遥测代码）。
 *
 * ## 两条规则，合起来才完整
 *
 * 每个设置项必须二选一：
 *
 * 1. **代码里真的有人读它**（消费）；
 * 2. **登记在 `NOT_IMPLEMENTED_SETTINGS` 里**，且面板上**确实是禁用的**。
 *
 * 只有第 1 条，设置项会在面板里凭空消失；
 * 只有第 2 条，「置灰」这件事没人监督——
 * 有人把清单里的项又接上了却忘了删条目，清单就烂掉了。
 *
 * ## 为什么「消费」用 AST 判，不用 grep
 *
 * grep 会被骗：注释里写一句「见 `settings.editor.focusMode`」
 * 就算「读过了」，而注释是**最容易被注释掉**的地方——
 * 上一轮就实测过：把一个处理者注释掉，扫源码的守卫照样绿。
 *
 * 这里用 TypeScript 的语法树收集**真正的属性访问与解构**，
 * 注释和字符串里的同名文本都不算数。
 *
 * ## 为什么还要查运行时 DOM
 *
 * 「登记了」不等于「置灰了」——清单和面板是两处代码，
 * 清单里写了、面板里忘了加 `disabled`，用户还是会看到一个能点的开关。
 * 所以最后一条断言查的是**渲染出来的 DOM**，
 * 不是源码里有没有 `disabled` 这个词。
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ts from "typescript";
import { DEFAULT_SETTINGS, SETTINGS_SECTIONS } from "@/settings/schema";
import { NOT_IMPLEMENTED_SETTINGS } from "@/settings/coverage";
import { resetSettings } from "@/settings/store";
import { SettingsPanel } from "@/views/SettingsPanel";

const SRC_DIR = join(process.cwd(), "src");

/**
 * 不算「消费」的两个文件。
 *
 * - `schema.ts`：那是**定义**，不是读取；
 * - `SettingsPanel.tsx`：那是**展示设置的地方**——
 *   它当然会提到每一个字段（要渲染出来、要存回去），
 *   把它算进去，这条守卫就永远是绿的。
 */
const NOT_CONSUMERS = new Set([
  join(SRC_DIR, "settings", "schema.ts"),
  join(SRC_DIR, "views", "SettingsPanel.tsx"),
]);

/** 递归列出 src 下的 .ts / .tsx */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (full.endsWith(join("i18n", "locales"))) continue;
      out.push(...sourceFiles(full));
    } else if (name.endsWith(".ts") || name.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * 源码里**真正被读取**的属性名。
 *
 * 收两种形态：
 * - 属性访问 `settings.editor.focusMode` → `focusMode`
 * - 解构 `const { focusMode } = settings.editor` → `focusMode`
 *
 * 不收字符串字面量与注释——那不是「读」。
 */
function consumedPropertyNames(): Set<string> {
  const names = new Set<string>();
  for (const file of sourceFiles(SRC_DIR)) {
    if (NOT_CONSUMERS.has(file)) continue;
    const source = readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node)) {
        names.add(node.name.text);
      } else if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) {
        names.add(node.name.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return names;
}

/** `DEFAULT_SETTINGS` 的所有叶子字段路径（`editor.focusMode` 这种） */
function fieldPaths(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    // 叶子：布尔 / 字符串 / 数字 / 数组
    if (child === null || typeof child !== "object" || Array.isArray(child)) return [path];
    return fieldPaths(child, path);
  });
}

const ALL_FIELDS = fieldPaths(DEFAULT_SETTINGS);
const CONSUMED = consumedPropertyNames();

describe("设置项覆盖度", () => {
  it("自检：字段清单不是空的（否则下面每条断言都是空集假绿）", () => {
    /*
     * 这一条是**自检**。
     * 第一版 `fieldPaths` 忘了把叶子推进去，返回空数组——
     * 于是「没有孤儿设置项」那条断言对着空集恒绿，
     * 看起来守住了，实际上什么都没守。
     *
     * 空集假绿是守卫最阴险的失败模式：
     * 断言「绿灯」不等于「被检查的东西存在」。
     */
    expect(ALL_FIELDS.length).toBeGreaterThan(30);
    expect(ALL_FIELDS).toContain("editor.focusMode");
    expect(ALL_FIELDS).toContain("markdown.tables");
  });

  it("每个设置项要么被消费，要么登记为「还没接线」", () => {
    const orphans = ALL_FIELDS.filter((path) => {
      const name = path.slice(path.lastIndexOf(".") + 1);
      return !CONSUMED.has(name) && !(path in NOT_IMPLEMENTED_SETTINGS);
    });

    expect(orphans).toEqual([]);
  });

  it("登记的键都是真实存在的字段（防拼错）", () => {
    const bogus = Object.keys(NOT_IMPLEMENTED_SETTINGS).filter(
      (path) => !ALL_FIELDS.includes(path),
    );
    expect(bogus).toEqual([]);
  });

  it("登记在案的字段确实还没被消费（接上了就把条目删掉）", () => {
    /*
     * 这一条防的是清单本身烂掉：
     * 哪天有人把 `smartPunctuation` 真的实现了，却忘了从清单里删掉，
     * 面板就会继续把它置灰——功能有了，用户却用不了。
     */
    const stale = Object.keys(NOT_IMPLEMENTED_SETTINGS).filter((path) => {
      const name = path.slice(path.lastIndexOf(".") + 1);
      return CONSUMED.has(name);
    });

    expect(stale).toEqual([]);
  });
});

describe("设置面板：登记为「还没接线」的开关确实是禁用的", () => {
  afterEach(() => {
    cleanup();
  });

  it("面板上渲染出来的复选框里，登记在案的那些都是 disabled", () => {
    resetSettings();
    render(<SettingsPanel onClose={() => {}} />);

    // 面板一次只渲染一个分区，逐个走一遍
    for (const section of SETTINGS_SECTIONS) {
      const tab = screen.getByRole("button", { name: section.label });
      fireEvent.click(tab);

      const boxes = Array.from(
        document.querySelectorAll<HTMLInputElement>("input[type=checkbox][data-setting-key]"),
      );
      for (const box of boxes) {
        const key = box.dataset.settingKey!;
        if (key in NOT_IMPLEMENTED_SETTINGS) {
          expect(box.disabled, `${key} 应该被置灰`).toBe(true);
        }
      }
    }
  });

  it("登记在案的每个设置项都在面板上露过面（否则用户看不到它被置灰）", () => {
    resetSettings();
    render(<SettingsPanel onClose={() => {}} />);

    const seen = new Set<string>();
    for (const section of SETTINGS_SECTIONS) {
      const tab = screen.getByRole("button", { name: section.label });
      fireEvent.click(tab);

      for (const box of document.querySelectorAll<HTMLInputElement>(
        "input[type=checkbox][data-setting-key]",
      )) {
        seen.add(box.dataset.settingKey!);
      }
    }

    const missing = Object.keys(NOT_IMPLEMENTED_SETTINGS).filter((key) => !seen.has(key));
    expect(missing).toEqual([]);
  });
});

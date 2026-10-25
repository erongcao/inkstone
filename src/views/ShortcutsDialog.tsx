/**
 * 快捷键一览。
 *
 * 之前「帮助 → 快捷键一览」也是个**注册了但没人处理**的菜单项——点了没反应。
 *
 * ## 内容是**生成**的，不是手抄的
 *
 * 全部条目从快捷键注册表（`src/shortcuts.ts` 的 `SHORTCUTS` + `MENU_CHROME`）派生。
 *
 * 手抄的清单一定会漂移：改了一个键位，速查表还写着旧的——
 * 而一个「和你实际按的键不一样」的快捷键表，比没有更糟：
 * 用户会以为键位坏了，转而去别处找。
 *
 * M5-2 把快捷键收进注册表，就是为了这一刻：
 * 表格、命令面板、原生菜单三处显示，永远是同一份真相。
 */

import { t } from "@/i18n";
import {
  MENU_CHROME,
  SHORTCUTS,
  currentPlatform,
  formatShortcut,
  type Platform,
  type ShortcutScope,
} from "@/shortcuts";

interface Props {
  onClose: () => void;
}

/** 一行：功能名 + 键位 + 生效范围 */
interface Row {
  /** 功能名（中文原文，渲染时翻译） */
  label: string;
  /** 规范形式的键位 */
  key: string;
  /** 生效范围 */
  scope: ShortcutScope;
}

/** 一组：分组名 + 组内的条目 */
interface Group {
  /** 分组名（中文原文，渲染时翻译） */
  name: string;
  rows: Row[];
}

/**
 * 从注册表拼出分组。
 *
 * 分组顺序 = 注册表里第一次出现的顺序；
 * `MENU_CHROME`（放大 / 缩小 / 实际大小）归到「视图」组，
 * 接在同名组后面而不是另开一组——它们本来就是同一类东西。
 */
export function buildShortcutGroups(): Group[] {
  const groups: Group[] = [];
  const index = new Map<string, Group>();

  const push = (name: string, label: string, key: string, scope: ShortcutScope) => {
    let group = index.get(name);
    if (!group) {
      group = { name, rows: [] };
      index.set(name, group);
      groups.push(group);
    }
    group.rows.push({ label, key, scope });
  };

  for (const item of SHORTCUTS) push(item.group, item.label, item.key, item.scope);
  // 菜单系统件没有 scope 字段——它们只存在于原生菜单里，作用域就是「全局」
  for (const item of MENU_CHROME) push(item.group, item.label, item.key, "app");

  return groups;
}

/** 作用域的中文说法（渲染时翻译） */
function scopeLabel(scope: ShortcutScope): string {
  if (scope === "app") return t("全局");
  if (scope === "editor") return t("编辑器内");
  return t("全局与编辑器内");
}

export function ShortcutsDialog({ onClose }: Props) {
  const platform: Platform = currentPlatform();
  const groups = buildShortcutGroups();

  return (
    <div
      className="recovery-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t("快捷键一览")}
    >
      <div className="recovery-panel recovery-panel--wide">
        <h2>{t("快捷键一览")}</h2>

        <p className="recovery-text recovery-text--muted">
          {platform === "mac"
            ? t("macOS 上 ⌘ 为 Command 键，⌃ 为 Control 键。")
            : t("Windows / Linux 上 Ctrl 为 Control 键，Alt 为 Alt 键。")}
        </p>

        <div className="shortcut-reference">
          {groups.map((group) => (
            <section key={group.name} className="shortcut-reference__group">
              <h3 className="shortcut-reference__title">{t(group.name)}</h3>
              <table className="shortcut-reference__table">
                <tbody>
                  {group.rows.map((row) => (
                    <tr key={`${row.label}-${row.key}`}>
                      <th scope="row">{t(row.label)}</th>
                      <td className="shortcut-reference__keys">
                        <kbd className="shortcut-reference__key">
                          {formatShortcut(row.key, platform)}
                        </kbd>
                      </td>
                      <td className="shortcut-reference__scope">
                        {scopeLabel(row.scope)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>

        <div className="recovery-actions">
          <button type="button" className="btn btn--primary" onClick={onClose}>
            {t("关闭")}
          </button>
        </div>
      </div>
    </div>
  );
}

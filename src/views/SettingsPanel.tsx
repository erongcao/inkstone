/**
 * 设置面板。
 *
 * 外观分组已完整实现（主题、明暗、字体、字号、行高、写作区宽度、自定义 CSS）；
 * 其余分组先按 schema 渲染出开关/选择器骨架，M1 起逐项接通。
 */

import { useState } from "react";
import { useSettings, resetSettings } from "@/settings/store";
import {
  AUTO_PAIR_MODES,
  CONTENT_WIDTH_PRESETS,
  FONT_SIZE_PRESETS,
  MARKER_DISPLAY_MODES,
  SETTINGS_SECTIONS,
  type DeepPartial,
  type Settings,
  type SettingsSectionId,
} from "@/settings/schema";
import { BUILTIN_THEMES } from "@/theme/themes";
import { BUILTIN_VARIABLE_LABELS } from "@/export/variables";
import {
  availableExtraFormats,
  materializeExportItems,
  parseShortcut,
  resolveExportItems,
  shortcutConflict,
} from "@/export/items";
import { formatShortcut } from "@/shortcuts";
import type { ExportItemSetting, ExportVariableSetting } from "@/settings/schema";
import { AiSection } from "./AiSettingsSection";
import { t } from "@/i18n";

interface Props {
  onClose: () => void;
  /**
   * 打开时落在哪个分区。
   *
   * AI 面板的「去设置」要直接落到 AI 分区——
   * 让用户自己再点一次「AI」是很没必要的绕路。
   */
  initialSection?: SettingsSectionId;
}

export function SettingsPanel({ onClose, initialSection = "appearance" }: Props) {
  const [settings, update] = useSettings();
  const [section, setSection] = useState<SettingsSectionId>(initialSection);

  const patch = <K extends keyof Settings>(key: K, value: DeepPartial<Settings[K]>) =>
    update({ [key]: value } as DeepPartial<Settings>);

  return (
    <div
      className="settings-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t("设置")}
    >
      <div className="settings-panel">
        <header className="settings-header">
          <h2>{t("设置")}</h2>
          <button type="button" className="btn" onClick={onClose}>
            {t("关闭")}
          </button>
        </header>

        <div className="settings-body">
          <nav className="settings-nav">
            {SETTINGS_SECTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                className="panel-tab"
                aria-selected={section === item.id}
                onClick={() => setSection(item.id)}
              >
                {t(item.label)}
              </button>
            ))}
            <button
              type="button"
              className="settings-reset"
              onClick={() => {
                if (window.confirm(t("确定要恢复所有设置为默认值吗？"))) resetSettings();
              }}
            >
              {t("恢复默认值")}
            </button>
          </nav>

          <div className="settings-content">
            {section === "appearance" && (
              <AppearanceSection settings={settings} patch={patch} />
            )}
            {section === "editor" && <EditorSection settings={settings} patch={patch} />}
            {section === "markdown" && (
              <MarkdownSection settings={settings} patch={patch} />
            )}
            {section === "export" && <ExportSection settings={settings} patch={patch} />}
            {section === "general" && (
              <GeneralSection settings={settings} patch={patch} />
            )}
            {section === "ai" && <AiSection settings={settings} patch={patch} />}
          </div>
        </div>
      </div>
    </div>
  );
}

type PatchFn = <K extends keyof Settings>(
  key: K,
  value: DeepPartial<Settings[K]>,
) => void;

function AppearanceSection({ settings, patch }: { settings: Settings; patch: PatchFn }) {
  const a = settings.appearance;
  return (
    <section className="settings-group">
      <h3>{t("主题")}</h3>
      <label className="field">
        <span>{t("主题")}</span>
        <select
          value={a.theme}
          onChange={(e) => patch("appearance", { theme: e.target.value })}
        >
          {BUILTIN_THEMES.map((theme) => (
            <option key={theme.id} value={theme.id}>
              {t(theme.name)}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>{t("明暗模式")}</span>
        <select
          value={a.colorMode}
          onChange={(e) =>
            patch("appearance", { colorMode: e.target.value as typeof a.colorMode })
          }
        >
          <option value="auto">{t("跟随系统")}</option>
          <option value="light">{t("亮色")}</option>
          <option value="dark">{t("暗色")}</option>
        </select>
      </label>

      <label className="field field--inline">
        <span>{t("跟随系统外观")}</span>
        <input
          type="checkbox"
          checked={a.followSystemAppearance}
          onChange={(e) =>
            patch("appearance", { followSystemAppearance: e.target.checked })
          }
        />
      </label>

      <h3>{t("排版")}</h3>
      <label className="field">
        <span>{t("正文字体")}</span>
        <input
          type="text"
          value={a.fontFamily}
          onChange={(e) => patch("appearance", { fontFamily: e.target.value })}
        />
      </label>
      <label className="field">
        <span>{t("等宽字体")}</span>
        <input
          type="text"
          value={a.monoFontFamily}
          onChange={(e) => patch("appearance", { monoFontFamily: e.target.value })}
        />
      </label>
      <label className="field">
        <span>{t("字号")}</span>
        <select
          value={a.fontSize}
          onChange={(e) => patch("appearance", { fontSize: Number(e.target.value) })}
        >
          {FONT_SIZE_PRESETS.map((size) => (
            <option key={size} value={size}>
              {size} px
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{t("行高")}</span>
        <input
          type="range"
          min={1.2}
          max={2.2}
          step={0.1}
          value={a.lineHeight}
          onChange={(e) => patch("appearance", { lineHeight: Number(e.target.value) })}
        />
        <em>{a.lineHeight.toFixed(1)}</em>
      </label>
      <label className="field">
        <span>{t("写作区宽度")}</span>
        <select
          value={a.contentWidth}
          onChange={(e) => patch("appearance", { contentWidth: Number(e.target.value) })}
        >
          {CONTENT_WIDTH_PRESETS.map((width) => (
            <option key={width} value={width}>
              {width} rem
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{t("页面背景")}</span>
        <input
          type="color"
          value={a.backgroundColor || "#ffffff"}
          onChange={(e) => patch("appearance", { backgroundColor: e.target.value })}
        />
        <button
          type="button"
          className="btn"
          onClick={() => patch("appearance", { backgroundColor: "" })}
        >
          {t("恢复默认")}
        </button>
      </label>

      <h3>{t("自定义 CSS")}</h3>
      <label className="field field--column">
        <span>{t("附加样式（注入到文档根节点）")}</span>
        <textarea
          className="settings-css"
          rows={8}
          spellCheck={false}
          placeholder={"/* 例如 */\np { line-height: 1.8; }"}
          value={a.customCss}
          onChange={(e) => patch("appearance", { customCss: e.target.value })}
        />
      </label>
    </section>
  );
}

function EditorSection({ settings, patch }: { settings: Settings; patch: PatchFn }) {
  const e = settings.editor;
  // markerDisplay / autoPairMode 是下拉选择不是开关，单独渲染，所以这里要排除掉
  const toggles: {
    key: Exclude<keyof typeof e, "markerDisplay" | "autoPairMode">;
    label: string;
  }[] = [
    { key: "smartPunctuation", label: t("智能标点") },
    { key: "strictMode", label: t("严格模式（严格 CommonMark）") },
    { key: "indentFirstLine", label: t("缩进首行") },
    { key: "indentParagraph", label: t("段落续行缩进") },
    { key: "spellCheck", label: t("拼写检查") },
    { key: "focusMode", label: t("焦点模式") },
    { key: "typewriterMode", label: t("打字机模式") },
    { key: "alwaysShowWordCount", label: t("始终显示字数统计") },
  ];
  return (
    <section className="settings-group">
      <h3>{t("编辑")}</h3>

      <label className="field">
        <span>{t("标记符显示")}</span>
        <select
          value={e.markerDisplay}
          onChange={(ev) =>
            patch("editor", { markerDisplay: ev.target.value as typeof e.markerDisplay })
          }
        >
          {MARKER_DISPLAY_MODES.map((mode) => (
            <option key={mode.value} value={mode.value}>
              {t(mode.label)}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>{t("自动配对")}</span>
        <select
          value={e.autoPairMode}
          onChange={(ev) =>
            patch("editor", { autoPairMode: ev.target.value as typeof e.autoPairMode })
          }
        >
          {AUTO_PAIR_MODES.map((mode) => (
            <option key={mode.value} value={mode.value}>
              {t(mode.label)}
            </option>
          ))}
        </select>
      </label>

      {toggles.map(({ key, label }) => (
        <label key={key} className="field field--inline">
          <span>{label}</span>
          <input
            type="checkbox"
            checked={e[key]}
            onChange={(ev) => patch("editor", { [key]: ev.target.checked })}
          />
        </label>
      ))}
    </section>
  );
}

function MarkdownSection({ settings, patch }: { settings: Settings; patch: PatchFn }) {
  const m = settings.markdown;
  const toggles: {
    key: keyof typeof m;
    label: string;
    hint?: string;
    /**
     * 还没实现的功能：置灰并写明原因。
     *
     * 为什么要写明原因，而不是默默置灰：
     * 一个点不动的复选框，用户只会当成 bug；
     * 写清楚了「这个功能还没做、为什么没做」，用户才知道该等还是该绕开。
     *
     * 这两个开关对应的功能**确实还不存在**——
     * 它们不在 `parser/features.ts` 的开关模型里
     * （那个模型只收「真的会生效」的开关）。
     */
    pending?: string;
  }[] = [
    { key: "inlineMath", label: t("行内数学 $…$") },
    {
      key: "inlineMathSingleDollar",
      label: t("单 $ 也当行内公式"),
      hint: t("关掉后「价格 $5 到 $10 元」不再被误判成公式；$$x^2$$ 在行内仍可用"),
    },
    { key: "blockMath", label: t("数学块 $$…$$") },
    {
      key: "autoNumberEquations",
      label: t("公式自动编号"),
      pending: t("还没实现：代码里目前没有公式编号这个功能。"),
    },
    { key: "mhchem", label: t("化学扩展 mhchem") },
    { key: "mermaid", label: t("Mermaid 图表") },
    { key: "githubAlerts", label: "GitHub Alerts" },
    { key: "footnotes", label: t("脚注") },
    { key: "highlight", label: t("行内高亮 ==…==") },
    {
      key: "subscriptSuperscript",
      label: t("下标 / 上标"),
      pending: t("还没实现：编辑器认得下标与上标，导出还不认，两边会对不上。"),
    },
    { key: "frontMatter", label: "YAML front matter" },
    { key: "tables", label: t("表格") },
    { key: "taskLists", label: t("任务列表") },
  ];
  return (
    <section className="settings-group">
      <h3>Markdown</h3>
      {toggles.map(({ key, label, hint, pending }) => (
        <label
          key={key}
          className={`field field--inline${pending ? " field--pending" : ""}`}
          title={hint}
        >
          <span>{label}</span>
          <input
            type="checkbox"
            checked={m[key]}
            disabled={pending !== undefined}
            onChange={(ev) => patch("markdown", { [key]: ev.target.checked })}
          />
          {pending && <p className="field__note">{pending}</p>}
        </label>
      ))}
    </section>
  );
}

function ExportSection({ settings, patch }: { settings: Settings; patch: PatchFn }) {
  const x = settings.export;
  return (
    <section className="settings-group">
      <h3>{t("导出")}</h3>
      <label className="field field--inline">
        <span>{t("导出后打开所在文件夹")}</span>
        <input
          type="checkbox"
          checked={x.openFolderAfterExport}
          onChange={(e) => patch("export", { openFolderAfterExport: e.target.checked })}
        />
      </label>
      <label className="field field--inline">
        <span>{t("导出后打开文件")}</span>
        <input
          type="checkbox"
          checked={x.openFileAfterExport}
          onChange={(e) => patch("export", { openFileAfterExport: e.target.checked })}
        />
      </label>
      <label className="field">
        <span>{t("PDF 纸张")}</span>
        <select
          value={x.pdfPaperSize}
          onChange={(e) =>
            patch("export", { pdfPaperSize: e.target.value as typeof x.pdfPaperSize })
          }
        >
          <option value="A4">A4</option>
          <option value="Letter">Letter</option>
          <option value="Legal">Legal</option>
          <option value="A5">A5</option>
        </select>
      </label>
      <label className="field field--inline">
        <span>{t("HTML 导出包含大纲")}</span>
        <input
          type="checkbox"
          checked={x.htmlIncludeOutline}
          onChange={(e) => patch("export", { htmlIncludeOutline: e.target.checked })}
        />
      </label>
      <label className="field field--inline">
        <span>{t("读取 YAML front matter 覆盖导出设置（不安全）")}</span>
        <input
          type="checkbox"
          checked={x.readExportSettingsFromFrontMatter}
          onChange={(e) =>
            patch("export", { readExportSettingsFromFrontMatter: e.target.checked })
          }
        />
      </label>

      <label className="field">
        <span>{t("导出文件名模板")}</span>
        <input
          type="text"
          placeholder="${title}-${today}"
          value={x.fileNameTemplate}
          onChange={(e) => patch("export", { fileNameTemplate: e.target.value })}
        />
      </label>
      <p className="settings-hint">
        {t("留空则用文档标题。支持")} {"${title}"} {"${author}"} {"${date}"} {"${today}"}{" "}
        {"${now}"} {"${filename}"} {"${words}"} {t("等变量。")}
      </p>

      <label className="field">
        <span>{t("HTML 追加内容（&lt;head&gt;）")}</span>
        <textarea
          className="settings-css"
          rows={3}
          placeholder={'<meta name="author" content="…">'}
          value={x.htmlExtraHead}
          onChange={(e) => patch("export", { htmlExtraHead: e.target.value })}
        />
      </label>

      <label className="field">
        <span>{t("HTML 追加内容（&lt;body&gt; 末尾）")}</span>
        <textarea
          className="settings-css"
          rows={3}
          placeholder={t("<footer>页脚</footer>")}
          value={x.htmlExtraBody}
          onChange={(e) => patch("export", { htmlExtraBody: e.target.value })}
        />
      </label>

      <ExportItemsSection settings={settings} patch={patch} />

      <ExportVariablesSection settings={settings} patch={patch} />
    </section>
  );
}

/**
 * 导出项自定义：重命名、重排、绑定快捷键、移除、添加。
 *
 * ## 为什么写操作都先「物化」成完整列表
 *
 * 设置里的 `export.items` 为空表示「没有自定义」。
 * 用户第一次改任何一项时，写回去的必须是**完整列表**——
 * 否则「只改了一个名字」会变成「只留了一个名字，其余全被删了」。
 *
 * `materializeExportItems` 负责这一步：把当前解析结果转成一份完整的、
 * 覆盖全部内置项与用户已添加项的列表。
 *
 * ## 快捷键为什么不能边打边规范化
 *
 * 用户输入「⌘」时，规范化会得到空串（修饰符不成键），
 * 输入框会立刻被清空——没法打字。
 *
 * 所以输入期间保留**草稿**，失焦时才解析并提交；
 * 解析失败或与已有绑定冲突时，把原因显示出来，但**不覆盖**用户已绑的值。
 */
function ExportItemsSection({ settings, patch }: { settings: Settings; patch: PatchFn }) {
  const items = settings.export.items;
  const resolved = resolveExportItems(items);
  const active = resolved.filter((item) => item.visible);
  const removed = resolved.filter((item) => !item.visible);
  const extras = availableExtraFormats(items);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const write = (next: ExportItemSetting[]) => patch("export", { items: next });

  /** 改某一项之前，先把当前状态物化成完整列表 */
  const updateItem = (id: string, mutate: (entry: ExportItemSetting) => void) => {
    const next = materializeExportItems(items);
    const entry = next.find((item) => item.id === id);
    if (!entry) return;
    mutate(entry);
    write(next);
  };

  const rename = (id: string, label: string) =>
    updateItem(id, (entry) => {
      if (label.trim()) entry.label = label.trim();
      else delete entry.label;
    });

  const move = (id: string, delta: number) => {
    const next = materializeExportItems(items);
    const index = next.findIndex((item) => item.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= next.length) return;
    const [entry] = next.splice(index, 1);
    next.splice(target, 0, entry);
    write(next);
  };

  const remove = (id: string) =>
    updateItem(id, (entry) => {
      entry.visible = false;
    });

  const restore = (id: string) =>
    updateItem(id, (entry) => {
      delete entry.visible;
    });

  const add = (formatId: string) => {
    if (!formatId) return;
    const next = materializeExportItems(items);
    if (next.some((item) => item.id === formatId)) return;
    next.push({ id: formatId });
    write(next);
  };

  const clearDraft = (id: string) => {
    setDrafts((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setErrors((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  /** 失焦时提交快捷键 */
  const commitShortcut = (id: string) => {
    const draft = drafts[id];
    if (draft === undefined) return;
    const text = draft.trim();

    if (!text) {
      updateItem(id, (entry) => {
        delete entry.shortcut;
      });
      clearDraft(id);
      return;
    }

    const parsed = parseShortcut(text);
    if (!parsed) {
      setErrors((current) => ({ ...current, [id]: t("看不懂这个快捷键") }));
      return;
    }

    const taken = resolved
      .filter((item) => item.format.id !== id)
      .map((item) => item.shortcut)
      .filter((value): value is string => Boolean(value));
    const conflict = shortcutConflict(parsed, taken);
    if (conflict) {
      setErrors((current) => ({ ...current, [id]: conflict }));
      return;
    }

    updateItem(id, (entry) => {
      entry.shortcut = parsed;
    });
    clearDraft(id);
  };

  return (
    <>
      <h3>{t("导出项")}</h3>
      <p className="settings-hint">
        {t("可以改名字、调整顺序、绑定快捷键，或移除不用的格式。快捷键写成")}{" "}
        <code>Mod-Shift-1</code> {t("或")} <code>⌘⇧1</code> {t("这样的形式都行。")}
      </p>

      <div className="export-item-list">
        {active.map((item, index) => {
          const id = item.format.id;
          const draft = drafts[id];
          const error = errors[id];
          const shortcutText = draft ?? item.shortcut;
          const parsed = shortcutText ? parseShortcut(shortcutText) : "";
          return (
            <div key={id} className="export-item-row">
              <div className="export-item-move">
                <button
                  type="button"
                  className="btn btn--icon"
                  disabled={index === 0}
                  onClick={() => move(id, -1)}
                  aria-label={t("上移")}
                  title={t("上移")}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn--icon"
                  disabled={index === active.length - 1}
                  onClick={() => move(id, 1)}
                  aria-label={t("下移")}
                  title={t("下移")}
                >
                  ↓
                </button>
              </div>

              <input
                type="text"
                className="export-item-name"
                aria-label={t("名称")}
                placeholder={item.format.label}
                value={item.label === item.format.label ? "" : item.label}
                onChange={(event) => rename(id, event.target.value)}
              />

              <button
                type="button"
                className="btn"
                onClick={() => remove(id)}
                title={t("从导出面板里移除（可以在下面恢复）")}
              >
                {t("移除")}
              </button>

              <div className="export-item-shortcut">
                <span className="export-item-shortcut-label">{t("快捷键")}</span>
                <input
                  type="text"
                  className="export-item-shortcut-input"
                  aria-label={t("快捷键")}
                  placeholder={t("未绑定")}
                  value={shortcutText}
                  onChange={(event) =>
                    setDrafts((current) => ({ ...current, [id]: event.target.value }))
                  }
                  onBlur={() => commitShortcut(id)}
                />
                {parsed && !error && (
                  <span className="export-item-shortcut-preview">
                    {formatShortcut(parsed)}
                  </span>
                )}
                {error && <span className="export-item-shortcut-error">{error}</span>}
              </div>
            </div>
          );
        })}
      </div>

      {extras.length > 0 && (
        <label className="field">
          <span>{t("添加导出项")}</span>
          {/* key 随可添加项的数量变化：加完一个就重挂载，下拉复位，
              用户可以连续加好几个。
              （不要用 `event.target.value = ""` 直接改 DOM——
                那是绕过 React 去写受控元素的值。） */}
          <select
            key={extras.length}
            defaultValue=""
            onChange={(event) => add(event.target.value)}
          >
            <option value="">{t("从 pandoc 的更多格式里添加…")}</option>
            {extras.map((format) => (
              <option key={format.id} value={format.id}>
                {t(format.label)}（{format.extension}）
              </option>
            ))}
          </select>
        </label>
      )}

      {removed.length > 0 && (
        <details className="export-item-removed">
          <summary>{t("已移除的格式（{count}）", { count: removed.length })}</summary>
          {removed.map((item) => (
            <div key={item.format.id} className="export-item-removed-row">
              <span>{t(item.format.label)}</span>
              <button
                type="button"
                className="btn"
                onClick={() => restore(item.format.id)}
              >
                {t("恢复")}
              </button>
            </div>
          ))}
        </details>
      )}

      <div className="export-item-actions">
        <button type="button" className="btn" onClick={() => write([])}>
          {t("恢复默认导出项")}
        </button>
      </div>
    </>
  );
}

/**
 * 自定义导出变量。
 *
 * 变量名可以自己起，值从「内置来源」里选或直接写固定文本。
 * 同名变量按列表顺序后者覆盖前者——所以用户可以在内置变量之上
 * 加一个自己的「title」。
 */
function ExportVariablesSection({
  settings,
  patch,
}: {
  settings: Settings;
  patch: PatchFn;
}) {
  const variables = settings.export.variables;

  const update = (next: ExportVariableSetting[]) => {
    patch("export", { variables: next });
  };

  return (
    <>
      <h3>{t("自定义导出变量")}</h3>
      {variables.length === 0 && (
        <p className="settings-hint">
          {t("还没有自定义变量。添加后可以在文件名模板与 HTML 追加内容里用")} {"${名字}"}{" "}
          {t("引用。")}
        </p>
      )}
      {variables.map((variable, index) => (
        <div key={index} className="settings-row">
          <input
            type="text"
            placeholder={t("变量名")}
            value={variable.name}
            onChange={(e) => {
              const next = [...variables];
              next[index] = { ...variable, name: e.target.value };
              update(next);
            }}
          />
          <select
            value={variable.source}
            onChange={(e) => {
              const next = [...variables];
              next[index] = {
                ...variable,
                source: e.target.value as ExportVariableSetting["source"],
              };
              update(next);
            }}
          >
            {Object.entries(BUILTIN_VARIABLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {t(label)}
              </option>
            ))}
          </select>
          {variable.source === "custom" && (
            <input
              type="text"
              placeholder={t("固定文本")}
              value={variable.value ?? ""}
              onChange={(e) => {
                const next = [...variables];
                next[index] = { ...variable, value: e.target.value };
                update(next);
              }}
            />
          )}
          <button
            type="button"
            className="btn"
            onClick={() => update(variables.filter((_, i) => i !== index))}
          >
            {t("删除")}
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn"
        onClick={() => update([...variables, { name: "", source: "custom", value: "" }])}
      >
        {t("添加变量")}
      </button>
    </>
  );
}

function GeneralSection({ settings, patch }: { settings: Settings; patch: PatchFn }) {
  const g = settings.general;
  return (
    <section className="settings-group">
      <h3>{t("通用")}</h3>
      <label className="field">
        <span>{t("界面语言")}</span>
        <select
          value={g.language}
          onChange={(e) =>
            patch("general", { language: e.target.value as typeof g.language })
          }
        >
          <option value="zh-CN">{t("简体中文")}</option>
          <option value="zh-TW">{t("繁體中文")}</option>
          <option value="en">English</option>
        </select>
      </label>
      <label className="field field--inline">
        <span>{t("自动保存")}</span>
        <input
          type="checkbox"
          checked={g.autoSave}
          onChange={(e) => patch("general", { autoSave: e.target.checked })}
        />
      </label>
      <label className="field">
        <span>{t("自动保存间隔（毫秒）")}</span>
        <input
          type="number"
          min={500}
          step={500}
          value={g.autoSaveInterval}
          onChange={(e) => patch("general", { autoSaveInterval: Number(e.target.value) })}
        />
      </label>
      <label className="field field--inline">
        <span>{t("启动时恢复上次会话")}</span>
        <input
          type="checkbox"
          checked={g.restoreSession}
          onChange={(e) => patch("general", { restoreSession: e.target.checked })}
        />
      </label>
      <label className="field field--inline">
        <span>{t("发送匿名使用统计")}</span>
        <input
          type="checkbox"
          checked={g.sendAnonymousStats}
          onChange={(e) => patch("general", { sendAnonymousStats: e.target.checked })}
        />
      </label>
    </section>
  );
}

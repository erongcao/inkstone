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

interface Props {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: Props) {
  const [settings, update] = useSettings();
  const [section, setSection] = useState<SettingsSectionId>("appearance");

  const patch = <K extends keyof Settings>(key: K, value: DeepPartial<Settings[K]>) =>
    update({ [key]: value } as DeepPartial<Settings>);

  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="设置">
      <div className="settings-panel">
        <header className="settings-header">
          <h2>设置</h2>
          <button type="button" className="btn" onClick={onClose}>
            关闭
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
                {item.label}
              </button>
            ))}
            <button
              type="button"
              className="settings-reset"
              onClick={() => {
                if (window.confirm("确定要恢复所有设置为默认值吗？")) resetSettings();
              }}
            >
              恢复默认值
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
      <h3>主题</h3>
      <label className="field">
        <span>主题</span>
        <select
          value={a.theme}
          onChange={(e) => patch("appearance", { theme: e.target.value })}
        >
          {BUILTIN_THEMES.map((theme) => (
            <option key={theme.id} value={theme.id}>
              {theme.name}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>明暗模式</span>
        <select
          value={a.colorMode}
          onChange={(e) =>
            patch("appearance", { colorMode: e.target.value as typeof a.colorMode })
          }
        >
          <option value="auto">跟随系统</option>
          <option value="light">亮色</option>
          <option value="dark">暗色</option>
        </select>
      </label>

      <label className="field field--inline">
        <span>跟随系统外观</span>
        <input
          type="checkbox"
          checked={a.followSystemAppearance}
          onChange={(e) =>
            patch("appearance", { followSystemAppearance: e.target.checked })
          }
        />
      </label>

      <h3>排版</h3>
      <label className="field">
        <span>正文字体</span>
        <input
          type="text"
          value={a.fontFamily}
          onChange={(e) => patch("appearance", { fontFamily: e.target.value })}
        />
      </label>
      <label className="field">
        <span>等宽字体</span>
        <input
          type="text"
          value={a.monoFontFamily}
          onChange={(e) => patch("appearance", { monoFontFamily: e.target.value })}
        />
      </label>
      <label className="field">
        <span>字号</span>
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
        <span>行高</span>
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
        <span>写作区宽度</span>
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
        <span>页面背景</span>
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
          恢复默认
        </button>
      </label>

      <h3>自定义 CSS</h3>
      <label className="field field--column">
        <span>附加样式（注入到文档根节点）</span>
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
    { key: "smartPunctuation", label: "智能标点" },
    { key: "strictMode", label: "严格模式（严格 CommonMark）" },
    { key: "indentFirstLine", label: "缩进首行" },
    { key: "indentParagraph", label: "段落续行缩进" },
    { key: "spellCheck", label: "拼写检查" },
    { key: "focusMode", label: "焦点模式" },
    { key: "typewriterMode", label: "打字机模式" },
    { key: "alwaysShowWordCount", label: "始终显示字数统计" },
  ];
  return (
    <section className="settings-group">
      <h3>编辑</h3>

      <label className="field">
        <span>标记符显示</span>
        <select
          value={e.markerDisplay}
          onChange={(ev) =>
            patch("editor", { markerDisplay: ev.target.value as typeof e.markerDisplay })
          }
        >
          {MARKER_DISPLAY_MODES.map((mode) => (
            <option key={mode.value} value={mode.value}>
              {mode.label}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>自动配对</span>
        <select
          value={e.autoPairMode}
          onChange={(ev) =>
            patch("editor", { autoPairMode: ev.target.value as typeof e.autoPairMode })
          }
        >
          {AUTO_PAIR_MODES.map((mode) => (
            <option key={mode.value} value={mode.value}>
              {mode.label}
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
  const toggles: { key: keyof typeof m; label: string; hint?: string }[] = [
    { key: "inlineMath", label: "行内数学 $…$" },
    {
      key: "inlineMathSingleDollar",
      label: "单 $ 也当行内公式",
      hint: "关掉后「价格 $5 到 $10 元」不再被误判成公式；$$x^2$$ 在行内仍可用",
    },
    { key: "blockMath", label: "数学块 $$…$$" },
    { key: "autoNumberEquations", label: "公式自动编号" },
    { key: "mhchem", label: "化学扩展 mhchem" },
    { key: "mermaid", label: "Mermaid 图表" },
    { key: "githubAlerts", label: "GitHub Alerts" },
    { key: "footnotes", label: "脚注" },
    { key: "highlight", label: "行内高亮 ==…==" },
    { key: "subscriptSuperscript", label: "下标 / 上标" },
    { key: "frontMatter", label: "YAML front matter" },
    { key: "tables", label: "表格" },
    { key: "taskLists", label: "任务列表" },
  ];
  return (
    <section className="settings-group">
      <h3>Markdown</h3>
      {toggles.map(({ key, label, hint }) => (
        <label key={key} className="field field--inline" title={hint}>
          <span>{label}</span>
          <input
            type="checkbox"
            checked={m[key]}
            onChange={(ev) => patch("markdown", { [key]: ev.target.checked })}
          />
        </label>
      ))}
    </section>
  );
}

function ExportSection({ settings, patch }: { settings: Settings; patch: PatchFn }) {
  const x = settings.export;
  return (
    <section className="settings-group">
      <h3>导出</h3>
      <label className="field field--inline">
        <span>导出后打开所在文件夹</span>
        <input
          type="checkbox"
          checked={x.openFolderAfterExport}
          onChange={(e) => patch("export", { openFolderAfterExport: e.target.checked })}
        />
      </label>
      <label className="field field--inline">
        <span>导出后打开文件</span>
        <input
          type="checkbox"
          checked={x.openFileAfterExport}
          onChange={(e) => patch("export", { openFileAfterExport: e.target.checked })}
        />
      </label>
      <label className="field">
        <span>PDF 纸张</span>
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
        <span>HTML 导出包含大纲</span>
        <input
          type="checkbox"
          checked={x.htmlIncludeOutline}
          onChange={(e) => patch("export", { htmlIncludeOutline: e.target.checked })}
        />
      </label>
      <label className="field field--inline">
        <span>读取 YAML front matter 覆盖导出设置（不安全）</span>
        <input
          type="checkbox"
          checked={x.readExportSettingsFromFrontMatter}
          onChange={(e) =>
            patch("export", { readExportSettingsFromFrontMatter: e.target.checked })
          }
        />
      </label>
    </section>
  );
}

function GeneralSection({ settings, patch }: { settings: Settings; patch: PatchFn }) {
  const g = settings.general;
  return (
    <section className="settings-group">
      <h3>通用</h3>
      <label className="field">
        <span>界面语言</span>
        <select
          value={g.language}
          onChange={(e) =>
            patch("general", { language: e.target.value as typeof g.language })
          }
        >
          <option value="zh-CN">简体中文</option>
          <option value="zh-TW">繁體中文</option>
          <option value="en">English</option>
        </select>
      </label>
      <label className="field field--inline">
        <span>自动保存</span>
        <input
          type="checkbox"
          checked={g.autoSave}
          onChange={(e) => patch("general", { autoSave: e.target.checked })}
        />
      </label>
      <label className="field">
        <span>自动保存间隔（毫秒）</span>
        <input
          type="number"
          min={500}
          step={500}
          value={g.autoSaveInterval}
          onChange={(e) => patch("general", { autoSaveInterval: Number(e.target.value) })}
        />
      </label>
      <label className="field field--inline">
        <span>启动时恢复上次会话</span>
        <input
          type="checkbox"
          checked={g.restoreSession}
          onChange={(e) => patch("general", { restoreSession: e.target.checked })}
        />
      </label>
      <label className="field field--inline">
        <span>发送匿名使用统计</span>
        <input
          type="checkbox"
          checked={g.sendAnonymousStats}
          onChange={(e) => patch("general", { sendAnonymousStats: e.target.checked })}
        />
      </label>
    </section>
  );
}

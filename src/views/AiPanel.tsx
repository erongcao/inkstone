/**
 * AI 面板（浮层）。
 *
 * ## 面板是受控的，逻辑在 store 里
 *
 * 打开面板的入口有三个（命令面板、工具栏、快捷键），状态放在
 * `src/ai/panel-store.ts` 的模块级 store 里——留在组件内部的话，
 * 从 A 入口打开、从 B 入口看到的就是两份状态。
 *
 * ## 写回永远要用户点一下
 *
 * 面板只负责「显示结果」和「把用户的决定传下去」，
 * 真正写进文档的是 `panel-store` 的 `acceptAiResult()`，
 * 而它走的是**普通事务**——所以按 ⌘Z 能撤销。
 */

import {
  REWRITE_LABELS,
  SUMMARIZE_LABELS,
  type RewriteAction,
  type SummarizeAction,
} from "@/ai/actions";
import { resolveEndpointConfig } from "@/ai/endpoints";
import {
  acceptAiResult,
  cancelAiRun,
  closeAiPanel,
  rejectAiResult,
  runAiAction,
  setAiTab,
  useAiPanel,
  type AiPanelState,
} from "@/ai/panel-store";
import { useSettings } from "@/settings/store";
import { t } from "@/i18n";

interface Props {
  /** 跳到设置面板的 AI 分区 */
  onOpenSettings: () => void;
}

const REWRITE_ACTIONS = Object.keys(REWRITE_LABELS) as RewriteAction[];
const SUMMARIZE_ACTIONS = Object.keys(SUMMARIZE_LABELS) as SummarizeAction[];

/**
 * 写回按钮的文案。
 *
 * 没有选区时说「替换选区」是**骗人**的——实际替换的是光标所在的那一段或那一节。
 * 按钮得说清楚它到底会动哪一块，否则用户不敢点。
 */
function replaceLabel(kind: AiPanelState["contextKind"]): string {
  switch (kind) {
    case "selection":
      return t("替换选区");
    case "paragraph":
      return t("替换当前段落");
    case "section":
      return t("替换当前章节");
    case "document":
      return t("替换整篇文档");
    default:
      return t("替换");
  }
}

export function AiPanel({ onOpenSettings }: Props) {
  const panel = useAiPanel();
  const [settings] = useSettings();

  const endpoint = resolveEndpointConfig(settings.ai);
  const enabled = settings.ai.enabled;
  const busy = panel.status === "running";
  const done = panel.status === "done" && panel.pending !== null;

  const actions =
    panel.tab === "rewrite"
      ? REWRITE_ACTIONS.map((action) => ({ action, label: REWRITE_LABELS[action] }))
      : SUMMARIZE_ACTIONS.map((action) => ({ action, label: SUMMARIZE_LABELS[action] }));

  return (
    <div
      className="ai-overlay"
      role="dialog"
      aria-modal="false"
      aria-label={t("AI 助手")}
    >
      <div className="ai-panel">
        <header className="ai-panel__header">
          <h2>{t("AI 助手")}</h2>
          <button type="button" className="btn" onClick={closeAiPanel}>
            {t("关闭")}
          </button>
        </header>

        <div className="ai-panel__meta">
          <span className="ai-panel__endpoint" title={endpoint?.baseUrl}>
            {endpoint ? `${t(endpoint.label)} · ${endpoint.model}` : t("未配置端点")}
          </span>
          {panel.contextLabel && (
            <span className="ai-panel__context">
              {t("上下文：{context}", { context: panel.contextLabel })}
            </span>
          )}
        </div>

        {!enabled && (
          <div className="ai-panel__notice">
            <p>{t("AI 还没有启用。先到「设置 → AI」打开开关、配好端点与密钥。")}</p>
            <button type="button" className="btn" onClick={onOpenSettings}>
              {t("去设置")}
            </button>
          </div>
        )}

        <div className="ai-panel__tabs">
          <button
            type="button"
            className="panel-tab"
            aria-selected={panel.tab === "rewrite"}
            onClick={() => setAiTab("rewrite")}
          >
            {t("改写")}
          </button>
          <button
            type="button"
            className="panel-tab"
            aria-selected={panel.tab === "summarize"}
            onClick={() => setAiTab("summarize")}
          >
            {t("总结")}
          </button>
        </div>

        <div className="ai-panel__actions">
          {actions.map(({ action, label }) => (
            <button
              key={action}
              type="button"
              className="btn"
              disabled={!enabled || busy}
              onClick={() => void runAiAction(action)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="ai-panel__output">
          {panel.status === "idle" && !panel.output && (
            <p className="ai-panel__hint">
              {panel.tab === "rewrite"
                ? t("选中一段文字，或把光标放在段落里，然后点一个动作。")
                : t("对整篇文档生成摘要、大纲或标签。")}
            </p>
          )}

          {busy && (
            <p className="ai-panel__hint">
              {panel.output
                ? t("正在生成「{action}」…", { action: panel.actionLabel })
                : t("模型正在思考「{action}」…", { action: panel.actionLabel })}
            </p>
          )}

          {panel.output && <pre className="ai-panel__result">{panel.output}</pre>}

          {panel.error && (
            <p className="ai-panel__error" role="alert">
              {panel.error}
            </p>
          )}
        </div>

        <footer className="ai-panel__footer">
          {done && (
            <>
              <button type="button" className="btn btn--primary" onClick={acceptAiResult}>
                {panel.mode === "rewrite"
                  ? replaceLabel(panel.contextKind)
                  : t("追加到文末")}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void navigator.clipboard?.writeText(panel.output)}
              >
                {t("复制")}
              </button>
            </>
          )}
          {busy && (
            <button type="button" className="btn" onClick={cancelAiRun}>
              {t("停止")}
            </button>
          )}
          <button type="button" className="btn" onClick={rejectAiResult}>
            {t("放弃")}
          </button>
        </footer>
      </div>
    </div>
  );
}

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
 *
 * ## 三个分区
 *
 * 改写、总结之外还有**问答**（BM25 检索 + 引用溯源）。
 * 问答的答案会列出它引用了哪几段文档——没有溯源，
 * 用户没法判断答案是从文档里来的还是模型编的。
 */

import {
  REWRITE_LABELS,
  SUMMARIZE_LABELS,
  type RewriteAction,
  type SummarizeAction,
} from "@/ai/actions";
import { resolveEndpointConfig } from "@/ai/endpoints";
import { fetchModelList } from "@/ai/models";
import { providerFor } from "@/ai/chat";
import { resolveEndpoint } from "@/ai/provider";
import {
  finishModelListLoading,
  setModelList,
  setModelListLoading,
  useModelListState,
} from "@/ai/model-list-store";
import {
  acceptAiResult,
  cancelAiRun,
  closeAiPanel,
  rejectAiResult,
  runAiAction,
  runQa,
  setAiTab,
  setQaQuestion,
  useAiPanel,
  type AiPanelState,
} from "@/ai/panel-store";
import { useSettings } from "@/settings/store";
import { scrollEditorTo } from "@/editor/active-view";
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

/** 来源摘录：只取开头若干字，并压成一行 */
function excerpt(text: string, limit = 120): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

export function AiPanel({ onOpenSettings }: Props) {
  const panel = useAiPanel();
  const [settings, update] = useSettings();
  const modelLists = useModelListState();

  const endpoint = resolveEndpointConfig(settings.ai);
  const enabled = settings.ai.enabled;
  const busy = panel.status === "running";
  const done = panel.status === "done" && panel.pending !== null;

  // 面板里的模型下拉与设置面板**同源**：
  // 同一个 `modelOverrides` 字段、同一个模块级列表 store。
  // 两处各写一套的话，设置页选好的模型在面板里会看不到。
  const endpointId = settings.ai.defaultEndpointId;
  const models = modelLists.lists[endpointId]?.models ?? [];
  const loadingModels = modelLists.loadingFor === endpointId;
  const currentModel =
    settings.ai.modelOverrides?.[endpointId] ||
    settings.ai.defaultModel ||
    endpoint?.model ||
    "";

  const actions =
    panel.tab === "rewrite"
      ? REWRITE_ACTIONS.map((action) => ({ action, label: REWRITE_LABELS[action] }))
      : SUMMARIZE_ACTIONS.map((action) => ({ action, label: SUMMARIZE_LABELS[action] }));

  /** 在面板里换模型 */
  const onPickModel = (model: string) => {
    update({
      ai: {
        modelOverrides: { ...(settings.ai.modelOverrides ?? {}), [endpointId]: model },
      },
    });
  };

  /** 在面板里取模型列表（与设置面板同一个 store） */
  const onLoadModels = async () => {
    if (!endpoint) return;
    const provider = providerFor(endpoint.protocol);
    const cfg = resolveEndpoint(endpoint);
    setModelListLoading(endpoint.id);
    try {
      const result = await fetchModelList(provider, cfg);
      setModelList(endpoint.id, {
        models: result.ok ? result.models : [],
        error: result.ok
          ? result.models.length === 0
            ? t("该端点返回了空的模型列表。")
            : null
          : result.message,
      });
    } catch (error) {
      setModelList(endpoint.id, { models: [], error: String(error) });
    } finally {
      finishModelListLoading(endpoint.id);
    }
  };

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
            {endpoint ? `${t(endpoint.label)} · ${currentModel}` : t("未配置端点")}
          </span>
          {panel.contextLabel && (
            <span className="ai-panel__context">
              {t("上下文：{context}", { context: panel.contextLabel })}
            </span>
          )}
        </div>

        {/* 换模型：与设置面板同源 */}
        <div className="ai-panel__model">
          {models.length > 0 ? (
            <select
              value={models.some((m) => m.id === currentModel) ? currentModel : ""}
              onChange={(ev) => onPickModel(ev.target.value)}
              disabled={!enabled}
            >
              <option value="">{t("— 选择模型 —")}</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label === m.id ? m.id : `${m.label} · ${m.id}`}
                </option>
              ))}
            </select>
          ) : (
            <span className="ai-panel__model-current">{currentModel}</span>
          )}
          <button
            type="button"
            className="btn"
            onClick={() => void onLoadModels()}
            disabled={!endpoint || loadingModels}
          >
            {loadingModels ? t("正在获取模型列表…") : t("获取模型列表")}
          </button>
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
          <button
            type="button"
            className="panel-tab"
            aria-selected={panel.tab === "qa"}
            onClick={() => setAiTab("qa")}
          >
            {t("问答")}
          </button>
        </div>

        {panel.tab === "qa" ? (
          <div className="ai-panel__question">
            <input
              type="text"
              value={panel.question}
              placeholder={t("问点什么，比如「这份文档的结论是什么？」")}
              onChange={(ev) => setQaQuestion(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" && !busy) void runQa(panel.question);
              }}
            />
            <button
              type="button"
              className="btn btn--primary"
              disabled={!enabled || busy || panel.question.trim().length === 0}
              onClick={() => void runQa(panel.question)}
            >
              {busy ? t("正在思考…") : t("提问")}
            </button>
          </div>
        ) : (
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
        )}

        <div className="ai-panel__output">
          {panel.status === "idle" && !panel.output && (
            <p className="ai-panel__hint">
              {panel.tab === "rewrite"
                ? t("选中一段文字，或把光标放在段落里，然后点一个动作。")
                : panel.tab === "summarize"
                  ? t("对整篇文档生成摘要、大纲或标签。")
                  : t(
                      "问一个问题，Inkstone 会先在文档里找出相关的段落，再交给模型回答。",
                    )}
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

          {/* 引用溯源：答案引用了哪几段文档 */}
          {panel.citations.length > 0 && (
            <div className="ai-panel__sources">
              <h3>{t("引用来源")}</h3>
              <ol>
                {panel.citations.map((citation) => (
                  <li key={citation.index}>
                    {citation.hit ? (
                      <button
                        type="button"
                        className="ai-panel__source-link"
                        onClick={() => scrollEditorTo(citation.hit!.chunk.from)}
                      >
                        {citation.hit.chunk.headingPath.join(" › ") || t("（无标题）")}
                      </button>
                    ) : (
                      <span className="ai-panel__source-missing">
                        {t("第 {index} 号来源不存在", { index: citation.index })}
                      </span>
                    )}
                    {citation.hit && (
                      <p className="ai-panel__excerpt">
                        {excerpt(citation.hit.chunk.text)}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}

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

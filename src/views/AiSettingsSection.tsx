/**
 * 设置面板的 AI 分区。
 *
 * 四件事在这里闭环：
 *   1. 选端点（内置预设 + 用户自建）
 *   2. 存密钥（**走系统钥匙串**，输入框里永远不是明文回显）
 *   3. 能力位联动禁用 —— 模型不支持的参数不能让用户填，
 *      否则上游直接 400（实测 GPT-5 / GLM-5.x 移除了 temperature）
 *   4. **自建端点的增删改** —— 以前 `ai.endpoints` 这个字段
 *      全项目只有读方，没有一处写入：设置里定义了它，界面却写不了它。
 *
 * 计费性质必须显示出来：订阅 / 按量 / 本地免费三者对用户的
 * 成本含义完全不同，混起来显示会让人误判。
 */

import { useCallback, useEffect, useState } from "react";
import { BUILTIN_ENDPOINTS, BILLING_LABELS } from "@/ai/endpoints";
import { aiSecretStatus, aiSetSecret, aiDeleteSecret } from "@/ai/ipc";
import type { SecretStatus } from "@/ai/ipc";
import { providerFor } from "@/ai/chat";
import { fetchModelList } from "@/ai/models";
import { resolveEndpoint, type EndpointConfig } from "@/ai/provider";
import { testConnection, type ConnectionResult } from "@/ai/connection";
import {
  clearModelList,
  finishModelListLoading,
  setModelList,
  setModelListLoading,
  useModelListState,
} from "@/ai/model-list-store";
import {
  newEndpointDefaults,
  removeEndpoint,
  upsertEndpoint,
  validateBaseUrl,
  validateEndpointId,
} from "@/ai/custom-endpoints";
import type { AiEndpointSetting, AiProtocol, Settings } from "@/settings/schema";
import { t } from "@/i18n";

type PatchFn = <K extends keyof Settings>(key: K, value: Partial<Settings[K]>) => void;

interface Props {
  settings: Settings;
  patch: PatchFn;
}

/** 表单里正在编辑的端点 */
interface EndpointDraft {
  id: string;
  label: string;
  protocol: AiProtocol;
  baseUrl: string;
  model: string;
  billing: EndpointConfig["billing"];
  maxConcurrent: number;
  note: string;
}

const PROTOCOL_LABELS: Record<AiProtocol, string> = {
  openai: "OpenAI 兼容",
  anthropic: "Anthropic",
  gemini: "Gemini",
};

export function AiSection({ settings, patch }: Props) {
  const ai = settings.ai;
  const [secretInput, setSecretInput] = useState("");
  // 状态连同它属于哪个端点一起存，渲染期比对来丢弃过期结果——
  // 既避免了「先显示上一个端点的状态」，
  // 也不需要在 effect 里同步 setState（react-hooks 规则不允许）
  const [statusFor, setStatusFor] = useState<{ id: string; value: SecretStatus } | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);

  // 模型列表放在**模块级 store**里（见 `src/ai/model-list-store.ts`）：
  // 它按端点归属，而端点是全局配置——面板一关列表就该还在，
  // AI 面板（浮层）里也要显示同一个列表。
  const modelLists = useModelListState();

  // 「测试连接」的结果。同样按端点归属：换端点就作废。
  const [probeFor, setProbeFor] = useState<{
    id: string;
    result: ConnectionResult;
  } | null>(null);
  const [probingFor, setProbingFor] = useState<string | null>(null);

  // 自建端点的编辑态
  const [draft, setDraft] = useState<EndpointDraft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  /** 正在编辑的那个端点（新建时为 null） */
  const [editingId, setEditingId] = useState<string | null>(null);

  const selectedId = ai.defaultEndpointId || BUILTIN_ENDPOINTS[0]?.id || "";
  const builtin = BUILTIN_ENDPOINTS.find((e) => e.id === selectedId);
  const custom = ai.endpoints.find((e) => e.id === selectedId);
  const active: EndpointConfig | undefined = custom ?? builtin;

  const status = statusFor?.id === selectedId ? statusFor.value : null;

  // 模型列表同样按端点归属：换端点就当没有
  const list = modelLists.lists[selectedId] ?? null;
  const loading = modelLists.loadingFor === selectedId;

  const probe = probeFor?.id === selectedId ? probeFor.result : null;
  const probing = probingFor === selectedId;

  // 该端点自己选的模型 > 全局默认 > 端点预设自带的模型
  // （与 `resolveEndpointConfig` 是同一条规则，两处不能分叉）
  const currentModel =
    ai.modelOverrides?.[selectedId] || ai.defaultModel || active?.model || "";

  /** 记下这个端点选的模型 */
  const setModel = useCallback(
    (model: string) => {
      patch("ai", {
        modelOverrides: { ...(ai.modelOverrides ?? {}), [selectedId]: model },
      });
    },
    [ai.modelOverrides, patch, selectedId],
  );

  /** 取该端点的可用模型列表 */
  const onLoadModels = useCallback(async () => {
    if (!active) return;
    const provider = providerFor(active.protocol);
    const cfg = resolveEndpoint(active);
    setModelListLoading(active.id);
    try {
      const result = await fetchModelList(provider, cfg);
      setModelList(active.id, {
        models: result.ok ? result.models : [],
        error: result.ok
          ? result.models.length === 0
            ? t("该端点返回了空的模型列表。")
            : null
          : result.message,
      });
    } catch (error) {
      setModelList(active.id, { models: [], error: String(error) });
    } finally {
      // 只关掉**自己**那次请求的加载态：用户中途换了端点就别去动别人的
      finishModelListLoading(active.id);
    }
  }, [active]);

  /**
   * 测一次连接。
   *
   * 判定的细节在 `src/ai/connection.ts`——这里只负责把结果摆出来。
   */
  const onTestConnection = useCallback(async () => {
    if (!active) return;
    const provider = providerFor(active.protocol);
    const cfg = resolveEndpoint(active);
    setProbingFor(active.id);
    try {
      const result = await testConnection(provider, cfg);
      setProbeFor({ id: active.id, result });
      // 测通了就顺手把模型列表也拉下来——用户接着就能选模型。
      if (result.outcome === "ok" && result.models.length > 0) {
        setModelList(active.id, { models: result.models, error: null });
      }
    } catch (error) {
      setProbeFor({
        id: active.id,
        result: {
          outcome: "server-error",
          models: [],
          message: t("测试连接失败：{error}", { error: String(error) }),
        },
      });
    } finally {
      setProbingFor((cur) => (cur === active.id ? null : cur));
    }
  }, [active]);

  // 切换端点时查一次密钥状态
  useEffect(() => {
    let cancelled = false;
    void aiSecretStatus(selectedId)
      .then((value) => {
        if (!cancelled) setStatusFor({ id: selectedId, value });
      })
      .catch(() => {
        if (!cancelled) setStatusFor(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const refreshStatus = useCallback(async () => {
    setStatusFor({ id: selectedId, value: await aiSecretStatus(selectedId) });
  }, [selectedId]);

  const onSaveSecret = useCallback(async () => {
    if (!selectedId || secretInput.length === 0) return;
    try {
      await aiSetSecret(selectedId, secretInput);
      setSecretInput("");
      await refreshStatus();
      setNotice(t("密钥已保存到系统钥匙串"));
    } catch (error) {
      setNotice(t("保存失败：{error}", { error: String(error) }));
    }
  }, [selectedId, secretInput, refreshStatus]);

  const onDeleteSecret = useCallback(async () => {
    if (!selectedId) return;
    try {
      await aiDeleteSecret(selectedId);
      await refreshStatus();
      setNotice(t("密钥已删除"));
    } catch (error) {
      setNotice(t("删除失败：{error}", { error: String(error) }));
    }
  }, [selectedId, refreshStatus]);

  /* ── 自建端点的增删改 ── */

  const startCreate = useCallback(() => {
    setEditingId(null);
    setDraftError(null);
    const base = newEndpointDefaults("", ai.endpoints);
    setDraft({
      id: base.id,
      label: base.label,
      protocol: base.protocol,
      baseUrl: base.baseUrl,
      model: base.model,
      billing: base.billing,
      maxConcurrent: base.maxConcurrent,
      note: base.note ?? "",
    });
  }, [ai.endpoints]);

  const startEdit = useCallback((endpoint: AiEndpointSetting) => {
    setEditingId(endpoint.id);
    setDraftError(null);
    setDraft({
      id: endpoint.id,
      label: endpoint.label,
      protocol: endpoint.protocol,
      baseUrl: endpoint.baseUrl,
      model: endpoint.model,
      billing: endpoint.billing,
      maxConcurrent: endpoint.maxConcurrent,
      note: endpoint.note ?? "",
    });
  }, []);

  const cancelDraft = useCallback(() => {
    setDraft(null);
    setDraftError(null);
    setEditingId(null);
  }, []);

  const saveDraft = useCallback(() => {
    if (!draft) return;
    const id = draft.id.trim();

    // id 冲突检查：**新建**时才查（编辑时 id 不允许改）
    if (editingId === null) {
      const idCheck = validateEndpointId(id, ai.endpoints);
      if (!idCheck.ok) {
        setDraftError(idCheck.message);
        return;
      }
    }
    const urlCheck = validateBaseUrl(draft.baseUrl);
    if (!urlCheck.ok) {
      setDraftError(urlCheck.message);
      return;
    }
    if (!draft.label.trim()) {
      setDraftError(t("显示名不能为空。"));
      return;
    }

    const endpoint: AiEndpointSetting = {
      id: editingId ?? id,
      label: draft.label.trim(),
      protocol: draft.protocol,
      baseUrl: draft.baseUrl.trim(),
      model: draft.model.trim(),
      billing: draft.billing,
      maxConcurrent: draft.maxConcurrent,
      ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
    };
    patch("ai", { endpoints: upsertEndpoint(ai.endpoints, endpoint) });
    cancelDraft();
    setNotice(t("端点已保存"));
  }, [ai.endpoints, cancelDraft, draft, editingId, patch]);

  /**
   * 删掉一个自建端点。
   *
   * **钥匙串里的密钥也要一起删**——不然它会变成孤儿：
   * 用户在钥匙串里再也看不到它，也删不掉，而端点已经不存在了。
   *
   * 模型列表与该端点选的模型也一起清掉。
   */
  const deleteEndpoint = useCallback(
    async (endpoint: AiEndpointSetting) => {
      const confirmed = window.confirm(
        t("确定删除自建端点「{label}」吗？它的密钥也会一并从钥匙串里删掉。", {
          label: endpoint.label,
        }),
      );
      if (!confirmed) return;

      patch("ai", {
        endpoints: removeEndpoint(ai.endpoints, endpoint.id),
        // 端点没了，它选的模型也就没有意义了。
        //
        // 这里**清空**而不是删键：设置是深合并的（`mergeSettings`），
        // 合并语义下删键做不到——把值置空即可（读的时候按「空 = 没用过」处理）。
        modelOverrides: { ...(ai.modelOverrides ?? {}), [endpoint.id]: "" },
      });
      clearModelList(endpoint.id);
      if (ai.defaultEndpointId === endpoint.id) {
        patch("ai", { defaultEndpointId: BUILTIN_ENDPOINTS[0]?.id ?? "" });
      }
      try {
        await aiDeleteSecret(endpoint.id);
        setNotice(
          t("端点「{label}」已删除，密钥也一并从钥匙串里删掉了。", {
            label: endpoint.label,
          }),
        );
      } catch (error) {
        setNotice(
          t("端点已删除，但钥匙串里的密钥清理失败：{error}", { error: String(error) }),
        );
      }
    },
    [ai.defaultEndpointId, ai.endpoints, ai.modelOverrides, patch],
  );

  const resolved = active ? resolveEndpoint(active) : null;
  const note = custom ? custom.note : builtin?.note;

  return (
    <section className="settings-group">
      <h3>AI</h3>

      <label className="field field--inline">
        <span>{t("启用 AI")}</span>
        <input
          type="checkbox"
          checked={ai.enabled}
          onChange={(ev) => patch("ai", { enabled: ev.target.checked })}
        />
      </label>

      <label className="field">
        <span>{t("默认端点")}</span>
        <select
          value={selectedId}
          onChange={(ev) => patch("ai", { defaultEndpointId: ev.target.value })}
        >
          <optgroup label={t("内置预设")}>
            {BUILTIN_ENDPOINTS.map((e) => (
              <option key={e.id} value={e.id}>
                {t(e.label)}
              </option>
            ))}
          </optgroup>
          {ai.endpoints.length > 0 && (
            <optgroup label={t("自建")}>
              {ai.endpoints.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>

      {active && (
        <>
          <dl className="ai-endpoint-info">
            <dt>{t("协议")}</dt>
            <dd>{active.protocol}</dd>
            <dt>{t("端点")}</dt>
            <dd className="ai-endpoint-url">{resolveEndpoint(active).baseUrl}</dd>
            <dt>{t("计费")}</dt>
            <dd>{BILLING_LABELS[active.billing]}</dd>
            <dt>{t("并发上限")}</dt>
            <dd>{active.maxConcurrent > 0 ? active.maxConcurrent : t("不限")}</dd>
          </dl>

          {note && <p className="ai-endpoint-note">{t(note)}</p>}
        </>
      )}

      <label className="field">
        <span>{t("模型 ID")}</span>
        <input
          type="text"
          value={currentModel}
          placeholder={active?.model ?? ""}
          onChange={(ev) => setModel(ev.target.value)}
        />
      </label>

      {/* 列出可用模型：云端与本地都支持。
          手输框**永远保留**——有的服务不提供列表接口，
          有的模型名是自定义的（本地推理服务启动时会打印实际名字）。 */}
      <div className="field field--actions">
        <button
          type="button"
          className="btn"
          onClick={() => void onLoadModels()}
          disabled={!active || loading}
        >
          {loading ? t("正在获取模型列表…") : t("获取模型列表")}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => void onTestConnection()}
          disabled={!active || probing}
        >
          {probing ? t("正在测试连接…") : t("测试连接")}
        </button>
      </div>

      {probe && (
        <p className={probe.outcome === "ok" ? "ai-notice" : "ai-warning"} role="status">
          {probe.message}
        </p>
      )}

      {list?.error && (
        <p className="ai-warning" role="alert">
          {list.error}
        </p>
      )}

      {list && list.models.length > 0 && (
        <label className="field">
          <span>{t("从列表中选择")}</span>
          <select
            value={list.models.some((m) => m.id === currentModel) ? currentModel : ""}
            onChange={(ev) => setModel(ev.target.value)}
          >
            <option value="">{t("— 选择模型 —")}</option>
            {list.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label === m.id ? m.id : `${m.label} · ${m.id}`}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* 密钥：输入框永远不回显已保存的值 */}
      <label className="field">
        <span>{t("API Key（存入系统钥匙串）")}</span>
        <input
          type="password"
          value={secretInput}
          placeholder={status?.configured ? t("已配置（输入新值可覆盖）") : t("未配置")}
          autoComplete="off"
          onChange={(ev) => setSecretInput(ev.target.value)}
        />
      </label>
      <div className="field field--actions">
        <button type="button" className="btn" onClick={() => void onSaveSecret()}>
          {t("保存密钥")}
        </button>
        <button type="button" className="btn" onClick={() => void onDeleteSecret()}>
          {t("删除密钥")}
        </button>
      </div>

      {status?.degraded && (
        <p className="ai-warning" role="alert">
          {t("⚠️ 当前系统的钥匙串不可用（Linux 需要 gnome-keyring / libsecret），")}
          {t("密钥已降级保存为本地文件。桌面应用通常能使用系统钥匙串。")}
        </p>
      )}

      {notice && <p className="ai-notice">{notice}</p>}

      {/* 能力位联动：不让用户填出上游会拒绝的参数 */}
      <label className="field field--inline">
        <span>{t("温度（temperature）")}</span>
        <input
          type="number"
          min={0}
          max={2}
          step={0.1}
          value={ai.temperature}
          disabled={resolved ? !resolved.resolvedCapabilities.temperature : false}
          onChange={(ev) => patch("ai", { temperature: Number(ev.target.value) })}
        />
      </label>
      {resolved && !resolved.resolvedCapabilities.temperature && (
        <p className="ai-endpoint-note">
          {t("该端点的模型不接受 temperature 参数，已禁用此设置。")}
        </p>
      )}

      <label className="field field--inline">
        <span>{t("最大输出 token")}</span>
        <input
          type="number"
          min={256}
          step={256}
          value={ai.maxOutputTokens}
          onChange={(ev) => patch("ai", { maxOutputTokens: Number(ev.target.value) })}
        />
      </label>

      {/* ── 自建端点 ── */}
      <h4 className="settings-subheading">{t("自建端点")}</h4>
      <p className="ai-endpoint-note">
        {t(
          "自建端点的 id 同时是系统钥匙串里的账号名，所以它不能与内置端点重名——重名会互相覆盖对方的密钥。",
        )}
      </p>

      {ai.endpoints.length > 0 && (
        <ul className="ai-endpoint-list">
          {ai.endpoints.map((endpoint) => (
            <li key={endpoint.id}>
              <span className="ai-endpoint-list__name">{endpoint.label}</span>
              <span className="ai-endpoint-list__meta">
                {endpoint.protocol} · {endpoint.baseUrl}
              </span>
              <span className="ai-endpoint-list__actions">
                <button type="button" className="btn" onClick={() => startEdit(endpoint)}>
                  {t("编辑")}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void deleteEndpoint(endpoint)}
                >
                  {t("删除")}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {draft === null ? (
        <div className="field field--actions">
          <button type="button" className="btn" onClick={startCreate}>
            {t("新建自建端点")}
          </button>
        </div>
      ) : (
        <div className="ai-endpoint-form">
          <label className="field">
            <span>{t("端点 id（同时是钥匙串的账号名）")}</span>
            <input
              type="text"
              value={draft.id}
              readOnly={editingId !== null}
              onChange={(ev) => setDraft({ ...draft, id: ev.target.value })}
            />
          </label>
          {editingId !== null && (
            <p className="ai-endpoint-note">
              {t(
                "端点 id 建好之后不能改——它是密钥在钥匙串里的位置，改名等于换一把钥匙，旧的那把会变成没人能删的孤儿。",
              )}
            </p>
          )}

          <label className="field">
            <span>{t("显示名")}</span>
            <input
              type="text"
              value={draft.label}
              onChange={(ev) => setDraft({ ...draft, label: ev.target.value })}
            />
          </label>

          <label className="field">
            <span>{t("协议")}</span>
            <select
              value={draft.protocol}
              onChange={(ev) =>
                setDraft({ ...draft, protocol: ev.target.value as AiProtocol })
              }
            >
              {(Object.keys(PROTOCOL_LABELS) as AiProtocol[]).map((protocol) => (
                <option key={protocol} value={protocol}>
                  {PROTOCOL_LABELS[protocol]}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>{t("端点地址")}</span>
            <input
              type="text"
              value={draft.baseUrl}
              placeholder="http://127.0.0.1:11434/v1"
              onChange={(ev) => setDraft({ ...draft, baseUrl: ev.target.value })}
            />
          </label>

          <label className="field">
            <span>{t("模型 ID")}</span>
            <input
              type="text"
              value={draft.model}
              onChange={(ev) => setDraft({ ...draft, model: ev.target.value })}
            />
          </label>

          <label className="field">
            <span>{t("计费")}</span>
            <select
              value={draft.billing}
              onChange={(ev) =>
                setDraft({
                  ...draft,
                  billing: ev.target.value as EndpointConfig["billing"],
                })
              }
            >
              {(Object.keys(BILLING_LABELS) as EndpointConfig["billing"][]).map(
                (billing) => (
                  <option key={billing} value={billing}>
                    {BILLING_LABELS[billing]}
                  </option>
                ),
              )}
            </select>
          </label>

          <label className="field">
            <span>{t("并发上限")}</span>
            <input
              type="number"
              min={0}
              step={1}
              value={draft.maxConcurrent}
              onChange={(ev) =>
                setDraft({ ...draft, maxConcurrent: Number(ev.target.value) })
              }
            />
          </label>

          <label className="field">
            <span>{t("备注")}</span>
            <input
              type="text"
              value={draft.note}
              onChange={(ev) => setDraft({ ...draft, note: ev.target.value })}
            />
          </label>

          {draftError && (
            <p className="ai-warning" role="alert">
              {draftError}
            </p>
          )}

          <div className="field field--actions">
            <button type="button" className="btn btn--primary" onClick={saveDraft}>
              {t("保存端点")}
            </button>
            <button type="button" className="btn" onClick={cancelDraft}>
              {t("取消")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export type { AiEndpointSetting };

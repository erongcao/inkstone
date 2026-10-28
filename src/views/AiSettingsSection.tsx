/**
 * 设置面板的 AI 分区。
 *
 * 三件事在这里闭环：
 *   1. 选端点（内置预设 + 用户自建）
 *   2. 存密钥（**走系统钥匙串**，输入框里永远不是明文回显）
 *   3. 能力位联动禁用 —— 模型不支持的参数不能让用户填，
 *      否则上游直接 400（实测 GPT-5 / GLM-5.x 移除了 temperature）
 *
 * 计费性质必须显示出来：订阅 / 按量 / 本地免费三者对用户的
 * 成本含义完全不同，混起来显示会让人误判。
 */

import { useCallback, useEffect, useState } from "react";
import { BUILTIN_ENDPOINTS, BILLING_LABELS } from "@/ai/endpoints";
import { aiSecretStatus, aiSetSecret, aiDeleteSecret } from "@/ai/ipc";
import type { SecretStatus } from "@/ai/ipc";
import { providerFor } from "@/ai/chat";
import { fetchModelList, type ModelInfo } from "@/ai/models";
import { resolveEndpoint, type EndpointConfig } from "@/ai/provider";
import type { AiEndpointSetting, Settings } from "@/settings/schema";
import { t } from "@/i18n";

type PatchFn = <K extends keyof Settings>(key: K, value: Partial<Settings[K]>) => void;

interface Props {
  settings: Settings;
  patch: PatchFn;
}

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
  // 模型列表与密钥状态是同一个道理：**属于某个端点**。
  // 换端点就作废，免得把上一个端点的模型摆到当前端点下面。
  const [modelList, setModelList] = useState<{
    id: string;
    models: ModelInfo[];
    error: string | null;
  } | null>(null);
  // 正在取列表的是哪个端点。记 id 而不是记布尔值：
  // 用户在请求途中换端点，旧请求回来时不该把新端点的加载态关掉。
  const [loadingFor, setLoadingFor] = useState<string | null>(null);

  const selectedId = ai.defaultEndpointId || BUILTIN_ENDPOINTS[0]?.id || "";
  const builtin = BUILTIN_ENDPOINTS.find((e) => e.id === selectedId);
  const custom = ai.endpoints.find((e) => e.id === selectedId);
  const active: EndpointConfig | undefined = custom ?? builtin;

  const status = statusFor?.id === selectedId ? statusFor.value : null;

  // 模型列表同样按端点归属：换端点就当没有
  const list = modelList?.id === selectedId ? modelList : null;
  const loading = loadingFor === selectedId;

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
    setLoadingFor(active.id);
    try {
      const result = await fetchModelList(provider, cfg);
      setModelList({
        id: active.id,
        models: result.ok ? result.models : [],
        error: result.ok
          ? result.models.length === 0
            ? t("该端点返回了空的模型列表。")
            : null
          : result.message,
      });
    } catch (error) {
      setModelList({ id: active.id, models: [], error: String(error) });
    } finally {
      // 只关掉**自己**那次请求的加载态：用户中途换了端点就别去动别人的
      setLoadingFor((cur) => (cur === active.id ? null : cur));
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
      </div>

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
    </section>
  );
}

export type { AiEndpointSetting };

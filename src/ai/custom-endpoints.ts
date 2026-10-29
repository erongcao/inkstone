/**
 * 自建端点的增删改规则。
 *
 * ## 为什么端点 id 是一件严肃的事
 *
 * **端点 id 同时是系统钥匙串里的 account 名。**
 *
 * 密钥不进设置文件（见 `src-tauri/src/ai/secrets.rs`），
 * 钥匙串里按 account 名存。所以 id 一旦定下来，它就不只是「一个名字」——
 * 它是这把钥匙在钥匙串里的**位置**。
 *
 * 于是有了两条硬规则：
 *
 * 1. **不能与内置端点重名。**
 *    内置端点的 id（`openai`、`ollama`…）在钥匙串里也占着 account 名。
 *    而 `resolveEndpointConfig` 的解析顺序是「自建优先于内置」——
 *    自建端点若用了 `openai` 这个 id，它会**悄悄接管**内置端点存的那把钥匙；
 *    用户在自建端点上填的密钥会覆盖掉 OpenAI 的密钥，
 *    删掉自建端点时又会顺手把 OpenAI 的密钥删掉。
 *    全程没有任何提示——这类「静默接管」必须从数据结构上堵死。
 *
 * 2. **自建端点之间也不能重名。**
 *    重名的话钥匙串里只有一个 account，两把钥匙叠在一起，
 *    表现是「改了 A 的密钥，B 的也变了」。
 *
 * ## 为什么 id 建好之后不允许改
 *
 * 改 id = 换一把钥匙的位置 = 旧位置变成孤儿密钥（留在钥匙串里，用户自己都看不见）。
 * 要迁移就得「读旧 account → 写新 account → 删旧 account」，
 * 任何一步失败都会留下半截状态。
 *
 * 所以 id 在**新建时定死**，之后只读。
 * 用户想改显示名（label）随时可以——那只是界面上的字。
 */

import { BUILTIN_ENDPOINTS } from "./endpoints";
import { t } from "@/i18n";
import type { AiEndpointSetting } from "@/settings/schema";

/** 校验结果 */
export type ValidationResult =
  | { ok: true }
  | {
      ok: false;
      /** 机器可读的原因（UI 据此决定文案与焦点） */
      reason: "empty" | "invalid-chars" | "duplicate" | "builtin-conflict" | "bad-url";
      /** 给用户看的一句话 */
      message: string;
    };

/** id 允许的字符 */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * 校验一个要新建的端点 id。
 *
 * @param id 用户填的 id
 * @param existing 已有的自建端点
 */
export function validateEndpointId(
  id: string,
  existing: AiEndpointSetting[],
): ValidationResult {
  const trimmed = id.trim();
  if (!trimmed) {
    return { ok: false, reason: "empty", message: t("端点 id 不能为空。") };
  }
  if (!ID_PATTERN.test(trimmed)) {
    return {
      ok: false,
      reason: "invalid-chars",
      message: t(
        "端点 id 只能包含字母、数字、点、下划线和连字符，且必须以字母或数字开头——它要当钥匙串的 account 名用。",
      ),
    };
  }
  if (existing.some((e) => e.id === trimmed)) {
    return {
      ok: false,
      reason: "duplicate",
      message: t("已经有一个 id 为「{id}」的自建端点了。", { id: trimmed }),
    };
  }
  if (BUILTIN_ENDPOINTS.some((e) => e.id === trimmed)) {
    return {
      ok: false,
      reason: "builtin-conflict",
      message: t(
        "「{id}」是内置端点的 id，不能拿来当自建端点的 id——内置端点与自建端点在钥匙串里共用同一个 account 名，会互相覆盖对方的密钥。",
        { id: trimmed },
      ),
    };
  }
  return { ok: true };
}

/** 校验 base URL */
export function validateBaseUrl(url: string): ValidationResult {
  const trimmed = url.trim();
  if (!trimmed) {
    return { ok: false, reason: "bad-url", message: t("端点地址不能为空。") };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      ok: false,
      reason: "bad-url",
      message: t("端点地址不是一个合法的 URL（要带 http:// 或 https://）。"),
    };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      reason: "bad-url",
      message: t("端点地址只支持 http:// 与 https://。"),
    };
  }
  return { ok: true };
}

/**
 * 根据显示名生成一个不冲突的 id。
 *
 * 规则：小写、空格与中文转连字符、去掉非法字符，
 * 再补 `-2`、`-3`… 直到不与已有的 id 冲突。
 */
export function suggestEndpointId(label: string, existing: AiEndpointSetting[]): string {
  const base =
    label
      .trim()
      .toLowerCase()
      .replace(/[\s]+/g, "-")
      .replace(/[^a-z0-9._-]/g, "")
      .replace(/^[^a-z0-9]+/, "") || "endpoint";
  const taken = new Set([
    ...existing.map((e) => e.id),
    ...BUILTIN_ENDPOINTS.map((e) => e.id),
  ]);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/**
 * 新建或更新一个自建端点。
 *
 * `existing` 里的同 id 端点会被**替换**（编辑场景）；
 * 没有同 id 的就是新增。
 */
export function upsertEndpoint(
  existing: AiEndpointSetting[],
  endpoint: AiEndpointSetting,
): AiEndpointSetting[] {
  const index = existing.findIndex((e) => e.id === endpoint.id);
  if (index < 0) return [...existing, endpoint];
  const next = [...existing];
  next[index] = endpoint;
  return next;
}

/** 删掉一个自建端点 */
export function removeEndpoint(
  existing: AiEndpointSetting[],
  id: string,
): AiEndpointSetting[] {
  return existing.filter((e) => e.id !== id);
}

/**
 * 新建端点时的默认配置。
 *
 * 默认用 OpenAI 兼容协议 + 本机地址：绝大多数自建服务
 * （Ollama / LM Studio / vLLM / one-api / 新浪中转…）都走这一套。
 */
export function newEndpointDefaults(
  label: string,
  existing: AiEndpointSetting[],
): AiEndpointSetting {
  return {
    id: suggestEndpointId(label, existing),
    label: label.trim() || "自建端点",
    protocol: "openai",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "",
    billing: "pay-per-token",
    maxConcurrent: 1,
  };
}

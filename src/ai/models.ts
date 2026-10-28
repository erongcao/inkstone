/**
 * 「列出可用模型」这一层。
 *
 * ## 分工
 *
 * 与流式聊天同一套规矩（见 `docs/ai-design.md` D15）：
 *   - **Rust 侧只做传输与密钥注入**——把响应体原样送回前端
 *   - **协议编解码全在前端**（本文件）——能被 vitest 直接单测
 *
 * 所以 Rust 那边不解析任何 JSON，它连「什么是模型列表」都不知道。
 *
 * ## 三种响应形状（都来自实测文档，不是推测）
 *
 * | 协议 | 形状 | 取 id 的字段 |
 * | --- | --- | --- |
 * | OpenAI 兼容 | `{ "object": "list", "data": [{ "id": "gpt-4o-mini" }] }` | `data[].id` |
 * | Anthropic | `{ "data": [{ "type": "model", "id": "claude-…", "display_name": "…" }] }` | `data[].id` |
 * | Gemini | `{ "models": [{ "name": "models/gemini-2.5-flash", "displayName": "…" }] }` | `models[].name` 去掉 `models/` 前缀 |
 *
 * ## 为什么形状判定不看协议，而是看响应本身
 *
 * 协议只决定「去哪个 URL」；返回体长什么样是**服务器**说了算。
 * OpenAI 兼容这一套事实上成了行业标准（本地推理服务全都照它来），
 * 而 Anthropic 原生恰好也用 `data[]`——所以「先看有没有 `data[]`，
 * 再看有没有 `models[]`」这一条规则覆盖得住三家，不会有第四种形状落空。
 *
 * 反过来，若按协议写死「gemini 就只认 models[]」，那么某个把
 * Anthropic 兼容包装成 OpenAI 形状的网关会直接落进「无法识别的形状」，
 * 用户看到的是「该端点没有返回模型列表」——一句**假的**话。
 *
 * 判定失败时必须说清是「没返回」还是「返回了但不是列表」：
 * 前者多半是服务端没这个接口，后者是形状不对，两者的排查方向完全不同。
 */

import { aiListModels } from "./ipc";
import type { ChatProvider, ResolvedEndpoint } from "./provider";
import { t } from "@/i18n";

/** 一个可用模型 */
export interface ModelInfo {
  /** 模型 id —— 直接填进「模型 ID」框 */
  id: string;
  /** 展示名；厂商给了就用，没给就用 id */
  label: string;
}

/** 解析结果 */
export type ModelListResult =
  | { ok: true; models: ModelInfo[] }
  | {
      ok: false;
      /** `not-json` = 返回的不是 JSON；`unknown-shape` = 是 JSON 但不是模型列表 */
      reason: "not-json" | "unknown-shape";
      message: string;
    };

/**
 * 解析上游返回的模型列表。
 *
 * 纯函数：只吃字符串、只吐结果，不碰网络——
 * 于是「形状对不对」这件事能被 vitest 直接钉死。
 */
export function parseModelList(body: string): ModelListResult {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return {
      ok: false,
      reason: "not-json",
      message: t("该端点返回的不是 JSON —— 多数服务并不提供「列出模型」接口。"),
    };
  }

  if (json === null || typeof json !== "object") {
    return {
      ok: false,
      reason: "unknown-shape",
      message: t("该端点没有返回模型列表。"),
    };
  }

  const record = json as Record<string, unknown>;

  // 顺序有讲究：OpenAI 形状在前（行业标准），Gemini 形状在后。
  if (Array.isArray(record.data)) {
    return { ok: true, models: fromDataArray(record.data) };
  }
  if (Array.isArray(record.models)) {
    return { ok: true, models: fromModelsArray(record.models) };
  }

  return {
    ok: false,
    reason: "unknown-shape",
    message: t("该端点没有返回模型列表。"),
  };
}

/**
 * 取某个端点的可用模型列表。
 *
 * 传输在 Rust 侧（密钥不经过前端），解析在前端——见本文件开头的分工说明。
 */
export async function fetchModelList(
  provider: ChatProvider,
  cfg: ResolvedEndpoint,
): Promise<ModelListResult> {
  const body = await aiListModels({
    url: provider.modelsUrl(cfg),
    auth: provider.auth(cfg),
    headers: Object.entries(provider.extraHeaders?.(cfg) ?? {}).map(
      ([name, value]) => `${name}: ${value}`,
    ),
  });
  return parseModelList(body);
}

/**
 * OpenAI / Anthropic 形状：`{ data: [{ id, display_name? }] }`
 *
 * Anthropic 额外给 `display_name`（人看的名字），OpenAI 没有——
 * 没有就用 id。
 */
function fromDataArray(entries: unknown[]): ModelInfo[] {
  const out: ModelInfo[] = [];
  for (const entry of entries) {
    if (entry === null || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    const id = readString(rec.id);
    if (!id) continue;
    out.push({ id, label: readString(rec.display_name) || id });
  }
  return dedupe(out);
}

/**
 * Gemini 形状：`{ models: [{ name: "models/x", displayName? }] }`
 *
 * 两处与 OpenAI 不同：
 *   1. `name` 带 `models/` 前缀，而调用时用的是后面那截——前缀要剥掉
 *   2. 列表里混着 embedding 之类的模型，它们不支持 `generateContent`，
 *      列出来用户选了也用不了——按 `supportedGenerationMethods` 滤掉
 */
function fromModelsArray(entries: unknown[]): ModelInfo[] {
  const out: ModelInfo[] = [];
  for (const entry of entries) {
    if (entry === null || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    const raw = readString(rec.name);
    const id = raw.startsWith("models/") ? raw.slice("models/".length) : raw;
    if (!id) continue;
    if (!supportsGeneration(rec)) continue;
    out.push({ id, label: readString(rec.displayName) || id });
  }
  return dedupe(out);
}

/**
 * Gemini 的 `supportedGenerationMethods` 决定这个模型能不能用来生成内容。
 *
 * 官方文档里这个字段列出 `generateContent` / `countTokens` /
 * `createCachedContent` / `batchGenerateContent` 等。
 * **字段缺失时不猜**——没有就当作能用，宁可多列一个也不把能用的藏起来。
 */
function supportsGeneration(rec: Record<string, unknown>): boolean {
  const methods = rec.supportedGenerationMethods;
  if (!Array.isArray(methods) || methods.length === 0) return true;
  return methods.some((m) => m === "generateContent");
}

/** 取一个非空字符串（顺手 trim） */
function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 去重，但**保持服务端给的顺序**。
 *
 * 顺序本身带信息：Anthropic 官方文档写明「新发布的模型排在前面」。
 * 自己重新排序等于把这个信息扔掉。
 */
function dedupe(models: ModelInfo[]): ModelInfo[] {
  const seen = new Set<string>();
  const out: ModelInfo[] = [];
  for (const model of models) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    out.push(model);
  }
  return out;
}

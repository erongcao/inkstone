/**
 * 「测试连接」：把「连不上」这件事说清楚。
 *
 * ## 为什么不能只有一个「测试连接」按钮
 *
 * 一个「连不上」的提示对用户几乎没有价值——
 * 用户要的是知道**该改哪里**。而连不上的原因至少有三类，
 * 它们的排查方向完全相反：
 *
 * | 现象 | 真正的原因 | 该改哪里 |
 * | --- | --- | --- |
 * | HTTP 401 / 403 | 密钥错了 / 没填 / 不属于这个账户 | API Key |
 * | HTTP 404（列表接口） | 这个服务**没有**「列出模型」接口 | 不用改，模型 ID 手输 |
 * | HTTP 404（聊天接口也 404） | base URL 写错了 | 端点地址 |
 * | 连不上（传输失败） | 服务没启动 / 端口不对 / 主机不通 | 服务与地址 |
 *
 * 只报「连接失败」的话，用户只能自己一个一个试。
 *
 * ## 判定顺序
 *
 * 先探**列模型**的接口（GET，不花 token）：
 *
 * - 成功 → 直接知道连上了，还能顺手把模型列表填上
 * - 401 / 403 → 密钥问题，不用再探第二个接口
 * - 404 → **还不能下结论**（可能是没有列表接口，也可能是路径不对），
 *   这时才探**聊天**的接口（POST）来分辨：
 *   - 聊天也 404 → 路径不对
 *   - 聊天成功 → 服务是通的，只是没有列表接口（模型 ID 手输即可）
 *
 * ## 聊天探测会花掉一点 token
 *
 * 它是真的发一次请求（`maxTokens: 1`）。这是有意的：
 * 「这个服务到底能不能聊天」只有真的问一次才知道。
 * 代价是 1 个 token，以及对方的调用记录里多一条。
 */

import { aiProbeEndpoint, type ProbePayload, type ProbeResult } from "./ipc";
import { parseModelList, type ModelInfo, type ModelListResult } from "./models";
import type { ChatProvider, ChatRequest, ResolvedEndpoint } from "./provider";
import { t } from "@/i18n";

/** 判定结果 */
export type ConnectionOutcome =
  /** 连上了，而且能列模型 */
  | "ok"
  /** 连上了，但这个服务没有「列出模型」接口 */
  | "ok-no-list"
  /** 密钥被拒绝 */
  | "unauthorized"
  /** 路径不对（列表接口与聊天接口都 404） */
  | "not-found"
  /** 被限流 */
  | "rate-limited"
  /** 服务端出错 */
  | "server-error"
  /** 连不上（传输层失败） */
  | "network"
  /** 这个端点还没配密钥 */
  | "no-secret"
  /** 鉴权方式配置有问题 */
  | "bad-auth";

export interface ConnectionResult {
  outcome: ConnectionOutcome;
  /** 给用户看的一句话 */
  message: string;
  /** 拿到的模型（只有 `ok` 时非空） */
  models: ModelInfo[];
}

/** 探测函数（可注入，便于测试） */
export type ProbeFn = (payload: ProbePayload) => Promise<ProbeResult>;

/** 依赖注入 */
export interface ConnectionDeps {
  probe?: ProbeFn;
  /** 解析模型列表（默认用 `parseModelList`） */
  parse?: (body: string) => ModelListResult;
}

/**
 * 探测用的最小聊天请求。
 *
 * `maxTokens: 1` —— 只让它吐一个字，代价最小。
 * 但 `maxTokens` 不能省：Anthropic 那边它是**必填**的
 * （`providerCapabilitiesFor` 里的 `maxTokensRequired`）。
 */
const PROBE_REQUEST: ChatRequest = {
  messages: [{ role: "user", content: "ping" }],
  maxTokens: 1,
};

/**
 * 测一个端点连不连得上。
 *
 * @param provider 该端点的协议实现
 * @param cfg 已合并能力位的端点配置
 */
export async function testConnection(
  provider: ChatProvider,
  cfg: ResolvedEndpoint,
  deps: ConnectionDeps = {},
): Promise<ConnectionResult> {
  const probe = deps.probe ?? aiProbeEndpoint;
  const parse = deps.parse ?? parseModelList;

  const auth = provider.auth(cfg);
  const headers = Object.entries(provider.extraHeaders?.(cfg) ?? {}).map(
    ([name, value]) => `${name}: ${value}`,
  );

  // ── 第一步：探列模型接口 ──
  const modelsProbe = await probe({
    url: provider.modelsUrl(cfg),
    method: "GET",
    auth,
    headers,
  });

  const first = classify(modelsProbe);
  if (first) return first;

  // 列模型接口返回 2xx —— 连上了，顺手把模型列表解析出来。
  if (
    modelsProbe.kind === "http" &&
    modelsProbe.status >= 200 &&
    modelsProbe.status < 300
  ) {
    const parsed = parse(modelsProbe.body);
    if (parsed.ok) {
      return {
        outcome: "ok",
        models: parsed.models,
        message: t("连接成功，找到 {count} 个模型。", { count: parsed.models.length }),
      };
    }
    // 返回的确实不是列表（如���探到了一个 API 根路径）——
    // 说清楚「连上了」与「但没有列表」这两件事。
    return {
      outcome: "ok-no-list",
      models: [],
      message: t("连接成功，但这个服务没有「列出模型」接口。模型 ID 需要手输。"),
    };
  }

  if (modelsProbe.kind === "http" && modelsProbe.status === 404) {
    // 404 还不能下结论——去问聊天接口。
    const chatProbe = await probe({
      url: provider.endpointUrl(cfg),
      method: "POST",
      body: provider.encodeBody(PROBE_REQUEST, cfg),
      auth,
      headers,
    });

    const second = classify(chatProbe);
    if (second) return second;

    if (chatProbe.kind === "http" && chatProbe.status >= 200 && chatProbe.status < 300) {
      return {
        outcome: "ok-no-list",
        models: [],
        message: t(
          "连接成功，但这个服务没有「列出模型」接口（HTTP 404）。模型 ID 需要手输。",
        ),
      };
    }
    if (chatProbe.kind === "http" && chatProbe.status === 404) {
      return {
        outcome: "not-found",
        models: [],
        message: t("端点地址不对（HTTP 404）。检查 base URL 是否写对。"),
      };
    }
    // 其它情况（限流 / 服务端错误 / 连不上）由 classify 兜住；
    // 走到这里说明它既不是 2xx 也不是 404——如实报状态码。
    return {
      outcome: "server-error",
      models: [],
      message: t("聊天接口返回 HTTP {status}：{detail}", {
        status: chatProbe.status,
        detail: snippet(chatProbe.body || chatProbe.detail),
      }),
    };
  }

  // 列模型接口不是 404，却也没成功——
  // 那就按「这个服务没有列表接口」处理（模型 ID 手输即可）。
  return {
    outcome: "ok-no-list",
    models: [],
    message: t("连接成功，但这个服务没有「列出模型」接口。模型 ID 需要手输。"),
  };
}

/**
 * 把一次探测结果归类。
 *
 * 返回 `null` 表示「这一类还要继续往下判」（只有 404 是这样）。
 */
function classify(probe: ProbeResult): ConnectionResult | null {
  switch (probe.kind) {
    case "no-secret":
      return {
        outcome: "no-secret",
        models: [],
        message: t("这个端点还没有配置密钥。先在上面填 API Key 并保存。"),
      };
    case "bad-auth":
      return {
        outcome: "bad-auth",
        models: [],
        message: t("鉴权方式配置有问题：{detail}", { detail: probe.detail }),
      };
    case "network":
      return {
        outcome: "network",
        models: [],
        message: t("连不上服务：{detail}。检查服务是否启动、地址与端口是否正确。", {
          detail: snippet(probe.detail),
        }),
      };
    case "http":
      break;
    default:
      return null;
  }

  const status = probe.status;
  if (status === 401 || status === 403) {
    return {
      outcome: "unauthorized",
      models: [],
      message: t(
        "密钥被拒绝（HTTP {status}）。检查 API Key 是否正确、是否属于这个端点。",
        {
          status,
        },
      ),
    };
  }
  if (status === 429) {
    return {
      outcome: "rate-limited",
      models: [],
      message: t("被限流（HTTP 429）。等一会儿再试，或者换个账户。"),
    };
  }
  if (status >= 500) {
    return {
      outcome: "server-error",
      models: [],
      message: t("服务端出错（HTTP {status}）：{detail}", {
        status,
        detail: snippet(probe.body),
      }),
    };
  }
  if (status === 404) {
    // 404 要靠第二个探测才能分辨「没有列表接口」与「路径不对」——
    // 交给调用方继续。
    return null;
  }
  if (status >= 200 && status < 300) {
    return null; // 成功：由调用方解析模型列表
  }
  return {
    outcome: "server-error",
    models: [],
    message: t("服务端返回 HTTP {status}：{detail}", {
      status,
      detail: snippet(probe.body),
    }),
  };
}

/** 截一段上游的返回体，别把整个错误页糊进界面 */
function snippet(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return t("（没有返回内容）");
  return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
}

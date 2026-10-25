/**
 * AI 面板的状态。
 *
 * 放在模块级 store 而不是组件里，理由和导出面板一样：
 * 打开面板的入口有**三个**（命令面板、工具栏按钮、AI 快捷键），
 * 状态留在组件内部的话，从 A 入口打开、从 B 入口看到的就是两份状态。
 *
 * ## 契约（D16，红线 1 的直接体现）
 *
 * **AI 结果一律不直接覆盖用户文本。**
 *
 * 流程固定是：跑动作 → 流式进预览 → 用户点「替换」/「追加到文末」才写入。
 * 写入走**普通事务**，所以能按 ⌘Z 撤销。
 * 放弃时文档一个字都不动。
 *
 * ## 写回前要核对原文
 *
 * 跑动作时记下切片范围与**当时的原文**。模型还在流式输出的时候，
 * 用户可能已经在改那一段了——这时按「替换」会覆盖掉用户刚写的东西。
 * 所以接受前比一下原文：对不上就拒绝，并说明原因。
 */

import { useSyncExternalStore } from "react";

import {
  buildRewriteRequest,
  buildSummarizeRequest,
  cleanModelOutput,
  REWRITE_LABELS,
  SUMMARIZE_LABELS,
  type RewriteAction,
  type SummarizeAction,
} from "./actions";
import { chat } from "./chat";
import { getAiEditorBridge, appendWithRule } from "./editor-bridge";
import { resolveContext, type ContextKind, type ContextSlice } from "./context";
import { resolveEndpointConfig } from "./endpoints";
import type { ChatRequest, EndpointConfig } from "./provider";
import { acceptWriteback, type PendingWriteback } from "./writeback";
import { readSettings } from "@/settings/store";
import type { AiSettings } from "@/settings/schema";
import { t } from "@/i18n";

/** 面板的两个分区 */
export type AiTab = "rewrite" | "summarize";

/** 运行状态 */
export type AiStatus = "idle" | "running" | "done" | "error";

export interface AiPanelState {
  /** 面板是否打开 */
  open: boolean;
  /** 当前分区 */
  tab: AiTab;
  /** 运行状态 */
  status: AiStatus;
  /** 当前动作的显示名（润色 / 一句话摘要…） */
  actionLabel: string;
  /** 流式输出 */
  output: string;
  /** 错误信息 */
  error: string | null;
  /** 上下文说明，如「选区（120 字）」 */
  contextLabel: string;
  /** 上下文字数 */
  contextChars: number;
  /**
   * 上下文是哪一种。
   *
   * 面板上那个按钮的文案要靠它：没有选区时说「替换选区」是**骗人**的——
   * 实际替换的是光标所在的那一段或那一节。
   */
  contextKind: ContextKind | null;
  /** 待写回的切片；跑完才有 */
  pending: PendingWriteback | null;
  /** 本次是改写（替换）还是总结（追加到文末） */
  mode: "rewrite" | "summarize";
}

const initialState: AiPanelState = {
  open: false,
  tab: "rewrite",
  status: "idle",
  actionLabel: "",
  output: "",
  error: null,
  contextLabel: "",
  contextChars: 0,
  contextKind: null,
  pending: null,
  mode: "rewrite",
};

let state: AiPanelState = initialState;

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): AiPanelState {
  return state;
}

function setState(patch: Partial<AiPanelState>): void {
  state = { ...state, ...patch };
  emit();
}

/* ── 动作分类 ── */

const SUMMARIZE_ACTIONS = new Set<string>(Object.keys(SUMMARIZE_LABELS));

function isSummarizeAction(action: string): action is SummarizeAction {
  return SUMMARIZE_ACTIONS.has(action);
}

/* ── 上下文 ── */

/** 上下文范围的中文说明 */
export function describeContext(ctx: ContextSlice): string {
  const chars = t("（{n} 字）", { n: ctx.text.length });
  switch (ctx.kind) {
    case "selection":
      return t("选区{chars}", { chars });
    case "paragraph":
      return t("当前段落{chars}", { chars });
    case "section":
      return ctx.title
        ? t("章节「{title}」{chars}", { title: ctx.title, chars })
        : t("当前章节{chars}", { chars });
    case "document":
    default:
      return t("整篇文档{chars}", { chars });
  }
}

/**
 * 取当前的上下文切片。
 *
 * 改写类用「选区 → 段落 → 章节」的降级链（`resolveContext` 的默认行为）；
 * 总结类用**整篇文档**（设计文档：「当前文档 → 一句话摘要」）。
 */
function resolveCurrentContext(mode: "rewrite" | "summarize"): ContextSlice | null {
  const editor = getAiEditorBridge();
  if (!editor) return null;
  const source = editor.getSource();
  if (mode === "summarize") {
    return resolveContext({
      source,
      cursor: editor.getCursor(),
      selection: editor.getSelection(),
      kind: "document",
    });
  }
  return resolveContext({
    source,
    cursor: editor.getCursor(),
    selection: editor.getSelection(),
    kind: "selection",
  });
}

/**
 * 构造一次请求，并说清楚这次是改写还是总结。
 *
 * 单独抽出来是因为「标签 / 请求构造 / 写回方式」三件事都由
 * 「这个动作属于哪一类」决定——分成三处判断的话，
 * 迟早会出现「标签写着润色，写回却追加到文末」这种错位。
 */
function buildRequest(
  action: RewriteAction | SummarizeAction,
  ctx: ContextSlice,
  aiSettings: AiSettings,
): { request: ChatRequest; label: string; mode: "rewrite" | "summarize" } {
  const common = {
    // 这两个来自设置：**不接上的话设置面板上的两个控件就是摆设**。
    // provider 那边会按能力位决定发不发 temperature——
    // 模型不支持时根本不会出现在请求体里（而不是发了让上游 400）。
    maxTokens: aiSettings.maxOutputTokens,
    temperature: aiSettings.temperature,
  };
  if (isSummarizeAction(action)) {
    return {
      request: {
        ...buildSummarizeRequest(action, ctx, aiSettings.summarizeSystemPrompt),
        ...common,
      },
      label: SUMMARIZE_LABELS[action],
      mode: "summarize",
    };
  }
  return {
    request: {
      ...buildRewriteRequest(action, ctx, aiSettings.rewriteSystemPrompt),
      ...common,
    },
    label: REWRITE_LABELS[action],
    mode: "rewrite",
  };
}

/* ── 运行器（可替换，便于测试） ── */

/** 一次流式请求的调用形态，与 `chat` 一致 */
export type AiRunner = (
  endpoint: EndpointConfig,
  request: ChatRequest,
  handlers: {
    onDelta(text: string): void;
    onDone(): void;
    onError(message: string): void;
  },
) => Promise<() => void>;

let runner: AiRunner = chat;

/**
 * 替换请求的发起方式。
 *
 * 生产代码不调用它——它存在是为了让「流式 → 预览 → 接受」这条链路
 * 能在没有真实 API Key 的情况下被测到（单元测试与开发期浏览器验收）。
 */
export function setAiRunner(next: AiRunner): void {
  runner = next;
}

/** 恢复默认请求方式 */
export function resetAiRunner(): void {
  runner = chat;
}

/** 正在跑的请求的取消函数 */
let cancelCurrent: (() => void) | null = null;

/* ── 对外动作 ── */

/** 打开面板 */
export function openAiPanel(tab: AiTab = "rewrite"): void {
  const ctx = resolveCurrentContext(tab);
  setState({
    ...initialState,
    open: true,
    tab,
    contextLabel: ctx ? describeContext(ctx) : "",
    contextChars: ctx?.text.length ?? 0,
    contextKind: ctx?.kind ?? null,
  });
}

/** 关闭面板（不写回任何东西） */
export function closeAiPanel(): void {
  cancelAiRun();
  setState({ ...initialState });
}

/** 切换分区 */
export function setAiTab(tab: AiTab): void {
  if (tab === state.tab) return;
  cancelAiRun();
  const ctx = resolveCurrentContext(tab);
  setState({
    ...initialState,
    open: true,
    tab,
    contextLabel: ctx ? describeContext(ctx) : "",
    contextChars: ctx?.text.length ?? 0,
    contextKind: ctx?.kind ?? null,
  });
}

/** 中断正在跑的请求 */
export function cancelAiRun(): void {
  if (cancelCurrent) {
    cancelCurrent();
    cancelCurrent = null;
  }
}

/**
 * 跑一个动作。
 *
 * 改写类动作写回时**替换**切片范围；总结类动作**追加到文末**
 * （塞到光标中间会把用户正在写的思路打断）。
 */
export async function runAiAction(
  action: RewriteAction | SummarizeAction,
): Promise<void> {
  cancelAiRun();

  const settings = readSettings();
  if (!settings.ai.enabled) {
    setState({ status: "error", error: t("AI 未启用。请先到「设置 → AI」打开开关。") });
    return;
  }

  const endpoint = resolveEndpointConfig(settings.ai);
  if (!endpoint) {
    setState({
      status: "error",
      error: t("没有可用的端点。请到「设置 → AI」选一个端点。"),
    });
    return;
  }

  const editor = getAiEditorBridge();
  if (!editor) {
    setState({ status: "error", error: t("编辑器还没准备好。") });
    return;
  }

  const probe = isSummarizeAction(action) ? "summarize" : "rewrite";
  const ctx = resolveCurrentContext(probe);
  if (!ctx) {
    setState({ status: "error", error: t("没有可用的上下文（文档是空的）。") });
    return;
  }

  const { request, label, mode } = buildRequest(action, ctx, settings.ai);

  setState({
    status: "running",
    actionLabel: t(label),
    mode,
    output: "",
    error: null,
    pending: null,
    contextLabel: describeContext(ctx),
    contextChars: ctx.text.length,
    contextKind: ctx.kind,
  });

  let streamed = "";
  let finished = false;
  try {
    cancelCurrent = await runner(endpoint, request, {
      onDelta: (text) => {
        streamed += text;
        setState({ output: streamed });
      },
      onDone: () => {
        finished = true;
        cancelCurrent = null;
        const cleaned = cleanModelOutput(streamed);
        if (!cleaned) {
          setState({ status: "error", error: t("模型没有返回任何内容。") });
          return;
        }
        setState({
          status: "done",
          output: cleaned,
          pending: {
            from: ctx.from,
            to: ctx.to,
            text: cleaned,
            // 记下**当时的原文**：接受前要核对，
            // 用户在流式输出期间改了这一段的话不能覆盖
            original: editor.getSource().slice(ctx.from, ctx.to),
            label,
          },
        });
      },
      onError: (message) => {
        finished = true;
        cancelCurrent = null;
        setState({ status: "error", error: message });
      },
    });
    // 请求在返回取消函数之前就结束了（同步完成的 mock、
    // 或者极快的响应）——这时不该再留着一个取消函数，
    // 否则下一次 cancelAiRun 会去取消一个早就结束的请求
    if (finished) cancelCurrent = null;
  } catch (error) {
    cancelCurrent = null;
    setState({ status: "error", error: String(error) });
  }
}

/**
 * 接受结果并写回。
 *
 * 写回前核对原文——用户在模型输出期间改了这一段的话，
 * 按原偏移替换会覆盖掉他刚写的东西。
 */
export function acceptAiResult(): void {
  const { pending, mode } = state;
  if (!pending) return;
  const editor = getAiEditorBridge();
  if (!editor) {
    setState({ status: "error", error: "编辑器还没准备好。" });
    return;
  }

  const current = editor.getSource();
  const actual = current.slice(pending.from, pending.to);
  if (actual !== pending.original) {
    setState({
      status: "error",
      error: t("原文在等待期间被改过了，直接替换会覆盖你刚写的内容。请重新跑一次。"),
    });
    return;
  }

  if (mode === "rewrite") {
    editor.replaceRange(pending.from, pending.to, pending.text);
  } else {
    appendWithRule(editor, pending.text);
  }
  closeAiPanel();
}

/** 放弃结果：文档一个字都不动 */
export function rejectAiResult(): void {
  cancelAiRun();
  setState({ ...state, status: "idle", output: "", pending: null, error: null });
}

/** React 订阅 */
export function useAiPanel(): AiPanelState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** 直接读当前状态（给非 React 的调用点与测试用） */
export function getAiPanelState(): AiPanelState {
  return state;
}

export { acceptWriteback };
export type { RewriteAction, SummarizeAction };

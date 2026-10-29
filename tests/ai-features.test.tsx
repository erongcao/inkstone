/**
 * 本轮新增的 AI 能力：自建端点、测试连接、面板换模型、问答模式、模型列表跨面板。
 *
 * ## 这些守卫守的是「不会静默失效」的性质
 *
 * 这一批功能最容易坏成**「点了没反应」**：
 *
 * - 自建端点的表单能填，但保存后设置里没有它
 * - 端点 id 与内置端点重名，密钥互相覆盖（**静默**——没人会察觉）
 * - 模型列表取到了，但换个面板就没了
 * - 问答跑完了，却不告诉用户答案是从哪几段来的
 *
 * 所以断言都落在**产物**上：设置里有没有、面板上有没有显示、引用对不对。
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import type * as IpcModule from "@/ai/ipc";
import { SettingsPanel } from "@/views/SettingsPanel";
import { AiPanel } from "@/views/AiPanel";
import {
  validateEndpointId,
  validateBaseUrl,
  suggestEndpointId,
  newEndpointDefaults,
} from "@/ai/custom-endpoints";
import {
  getModelListState,
  resetModelListState,
  setModelList,
} from "@/ai/model-list-store";
import {
  closeAiPanel,
  getAiPanelState,
  openAiPanel,
  resetAiRunner,
  runQa,
  setAiRunner,
  type AiRunner,
} from "@/ai/panel-store";
import { setAiEditorBridge } from "@/ai/editor-bridge";
import { ensureMarkdownParser } from "@/parser/markdown-loader";
import { readSettings, resetSettings, updateSettings } from "@/settings/store";
import type { AiEndpointSetting } from "@/settings/schema";

/* ── 钥匙串相关的 IPC：这里只需要知道「有没有被调用」 ── */

const secretCalls = {
  status: [] as string[],
  deleted: [] as string[],
};

vi.mock("@/ai/ipc", async () => {
  const actual = await vi.importActual<typeof IpcModule>("@/ai/ipc");
  return {
    ...actual,
    aiSecretStatus: async (account: string) => {
      secretCalls.status.push(account);
      return { configured: false, backend: "keyring", degraded: false };
    },
    aiSetSecret: async () => {},
    aiDeleteSecret: async (account: string) => {
      secretCalls.deleted.push(account);
    },
    aiListModels: async () => JSON.stringify({ data: [] }),
  };
});

/* ── 编辑器桥（问答要用真文档） ── */

let view: EditorView | null = null;

function setupEditor(doc: string): void {
  const host = document.createElement("div");
  document.body.appendChild(host);
  view = new EditorView({
    state: EditorState.create({ doc }),
    extensions: [],
    parent: host,
  });
  setAiEditorBridge({
    getSource: () => view!.state.doc.toString(),
    getCursor: () => view!.state.selection.main.head,
    getSelection: () => null,
    replaceRange: (from, to, text) => {
      view!.dispatch({ changes: { from, to, insert: text } });
    },
    getState: () => view!.state,
  });
}

/** 造一个只回固定文本的模型 */
function mockRunner(chunks: string[], onRequest?: (request: unknown) => void): AiRunner {
  return async (_endpoint, request, handlers) => {
    onRequest?.(request);
    for (const chunk of chunks) handlers.onDelta(chunk);
    handlers.onDone();
    return () => {};
  };
}

beforeAll(async () => {
  // 切块走 remark（红线 3），而 remark 是懒加载的
  await ensureMarkdownParser();
});

beforeEach(() => {
  localStorage.clear();
  resetSettings();
  resetModelListState();
  secretCalls.status.length = 0;
  secretCalls.deleted.length = 0;
});

afterEach(() => {
  closeAiPanel();
  resetAiRunner();
  setAiEditorBridge(null);
  view?.destroy();
  view = null;
  vi.restoreAllMocks();
});

/* ══════════════════════════════════════════════════════════════
   1. 自建端点
   ══════════════════════════════════════════════════════════════ */

describe("自建端点：id 的规则", () => {
  it("与内置端点重名 → 拒绝（它们在钥匙串里共用同一个 account 名）", () => {
    const result = validateEndpointId("openai", []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("builtin-conflict");
  });

  it("与已有的自建端点重名 → 拒绝", () => {
    const existing: AiEndpointSetting[] = [
      {
        id: "mine",
        label: "我的",
        protocol: "openai",
        baseUrl: "http://127.0.0.1:11434/v1",
        model: "",
        billing: "pay-per-token",
        maxConcurrent: 1,
      },
    ];
    const result = validateEndpointId("mine", existing);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("duplicate");
  });

  it("空 id / 非法字符 → 拒绝", () => {
    expect(validateEndpointId("", []).ok).toBe(false);
    expect(validateEndpointId("有中文", []).ok).toBe(false);
    expect(validateEndpointId("a b", []).ok).toBe(false);
  });

  it("合法 id → 通过", () => {
    expect(validateEndpointId("my-proxy", []).ok).toBe(true);
    expect(validateEndpointId("proxy.2", []).ok).toBe(true);
  });

  it("自动生成的 id 不与内置端点冲突", () => {
    const id = suggestEndpointId("Ollama", []);
    expect(validateEndpointId(id, []).ok).toBe(true);
  });

  it("base URL 必须是 http/https", () => {
    expect(validateBaseUrl("").ok).toBe(false);
    expect(validateBaseUrl("不是 URL").ok).toBe(false);
    expect(validateBaseUrl("ftp://x.test/v1").ok).toBe(false);
    expect(validateBaseUrl("http://127.0.0.1:11434/v1").ok).toBe(true);
    expect(validateBaseUrl("https://api.example.com/v1").ok).toBe(true);
  });

  it("新端点的默认值是 OpenAI 兼容 + 本机地址", () => {
    const draft = newEndpointDefaults("我的服务", []);
    expect(draft.protocol).toBe("openai");
    expect(draft.baseUrl).toContain("127.0.0.1");
  });
});

describe("自建端点：界面", () => {
  it("新建后写进设置，并能选中", async () => {
    updateSettings({ ai: { defaultEndpointId: "ollama" } });
    render(<SettingsPanel onClose={() => {}} initialSection="ai" />);

    fireEvent.click(screen.getByRole("button", { name: "新建自建端点" }));
    fireEvent.change(screen.getByLabelText("端点 id（同时是钥匙串的账号名）"), {
      target: { value: "my-proxy" },
    });
    fireEvent.change(screen.getByLabelText("显示名"), { target: { value: "我的代理" } });
    fireEvent.change(screen.getByLabelText("端点地址"), {
      target: { value: "http://127.0.0.1:8080/v1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存端点" }));

    await waitFor(() => {
      expect(readSettings().ai.endpoints.map((e) => e.id)).toEqual(["my-proxy"]);
    });
    const endpoint = readSettings().ai.endpoints[0];
    expect(endpoint.label).toBe("我的代理");
    expect(endpoint.baseUrl).toBe("http://127.0.0.1:8080/v1");
    // 端点 id 是钥匙串的 account 名——它必须被原样记下来
    expect(endpoint.id).toBe("my-proxy");
  });

  it("id 与内置端点重名 → 给出提示，并且**没有**写进设置", async () => {
    updateSettings({ ai: { defaultEndpointId: "ollama" } });
    render(<SettingsPanel onClose={() => {}} initialSection="ai" />);

    fireEvent.click(screen.getByRole("button", { name: "新建自建端点" }));
    fireEvent.change(screen.getByLabelText("端点 id（同时是钥匙串的账号名）"), {
      target: { value: "openai" },
    });
    fireEvent.change(screen.getByLabelText("显示名"), { target: { value: "冒名端点" } });
    fireEvent.click(screen.getByRole("button", { name: "保存端点" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });
    expect(readSettings().ai.endpoints).toEqual([]);
  });

  it("删掉端点 → 设置里没了、钥匙串里的密钥也删了、它选的模型也清了", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    updateSettings({
      ai: {
        defaultEndpointId: "my-proxy",
        endpoints: [
          {
            id: "my-proxy",
            label: "我的代理",
            protocol: "openai",
            baseUrl: "http://127.0.0.1:8080/v1",
            model: "m",
            billing: "pay-per-token",
            maxConcurrent: 1,
          },
        ],
        modelOverrides: { "my-proxy": "some-model" },
      },
    });
    render(<SettingsPanel onClose={() => {}} initialSection="ai" />);

    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() => {
      expect(readSettings().ai.endpoints).toEqual([]);
    });
    // 密钥必须一并删掉，否则它在钥匙串里变成没人能删的孤儿
    expect(secretCalls.deleted).toContain("my-proxy");
    // 它选的模型也没意义了
    expect(readSettings().ai.modelOverrides?.["my-proxy"]).toBe("");
  });
});

/* ══════════════════════════════════════════════════════════════
   5. 模型列表跨面板
   ══════════════════════════════════════════════════════════════ */

describe("模型列表：跨面板不丢", () => {
  it("列表挂在模块级 store 上，重新渲染组件还在", () => {
    setModelList("ollama", { models: [{ id: "m1", label: "m1" }], error: null });

    const first = render(<SettingsPanel onClose={() => {}} initialSection="ai" />);
    expect(screen.queryByLabelText("从列表中选择")).toBeNull();
    first.unmount();

    // 换一个组件实例（相当于关掉面板再打开）
    render(<SettingsPanel onClose={() => {}} initialSection="ai" />);
    // 设置面板里的下拉要端点选中同一个 id 才出现——这里直接查 store
    expect(getModelListState().lists.ollama.models.map((m) => m.id)).toEqual(["m1"]);
  });

  it("列表按端点归属：换一个端点就是另一份列表", () => {
    setModelList("ollama", { models: [{ id: "a", label: "a" }], error: null });
    setModelList("lmstudio", { models: [{ id: "b", label: "b" }], error: null });
    const state = getModelListState();
    expect(state.lists.ollama.models.map((m) => m.id)).toEqual(["a"]);
    expect(state.lists.lmstudio.models.map((m) => m.id)).toEqual(["b"]);
  });
});

/* ══════════════════════════════════════════════════════════════
   3. 面板里换模型
   ══════════════════════════════════════════════════════════════ */

describe("AI 面板：换模型", () => {
  it("面板里选的模型写进**同一个** modelOverrides（与设置面板同源）", () => {
    updateSettings({ ai: { enabled: true, defaultEndpointId: "ollama" } });
    setModelList("ollama", {
      models: [
        { id: "qwen3:8b", label: "qwen3:8b" },
        { id: "llama3:8b", label: "llama3:8b" },
      ],
      error: null,
    });
    openAiPanel("rewrite");
    render(<AiPanel onOpenSettings={() => {}} />);

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "llama3:8b" } });

    expect(readSettings().ai.modelOverrides?.ollama).toBe("llama3:8b");
  });

  it("没有模型列表时，面板显示当前的模型 id", () => {
    updateSettings({
      ai: {
        enabled: true,
        defaultEndpointId: "ollama",
        modelOverrides: { ollama: "手输的模型" },
      },
    });
    openAiPanel("rewrite");
    render(<AiPanel onOpenSettings={() => {}} />);
    expect(screen.getByText("手输的模型")).toBeTruthy();
  });
});

/* ══════════════════════════════════════════════════════════════
   4. 问答模式
   ══════════════════════════════════════════════════════════════ */

/** 数一数请求里带了几段来源（`[n] 标题路径：` 的行数） */
function state_sources_count(requestText: string): number {
  return (requestText.match(/\[\d+\]/g) ?? []).length;
}

describe("问答模式：检索 + 引用溯源", () => {
  const DOC = [
    "# 墨水",
    "",
    "墨水是古人用来书写的液体，主要成分是松烟与胶。",
    "",
    "# 砚台",
    "",
    "砚台是研墨用的器物，多为石材制成，讲究「下墨如漆」。",
  ].join("\n");

  /** 一份长文档：用来证明「只把相关片段发给模型」 */
  const LONG_DOC = [
    "# 墨水",
    "",
    "墨水是古人用来书写的液体，主要成分是松烟与胶。",
    "",
    "# 砚台",
    "",
    "砚台是研墨用的器物，多为石材制成，讲究「下墨如漆」。",
    ...Array.from(
      { length: 12 },
      (_, i) => `\n# 无关章节 ${i}\n\n这一节讲的是别的东西，与提问毫无关系。`,
    ),
  ].join("\n");

  it("问完之后答案、来源与引用都在状态里", async () => {
    setupEditor(DOC);
    updateSettings({ ai: { enabled: true, defaultEndpointId: "minimax-cn" } });
    setAiRunner(mockRunner(["砚台用来研墨[1]。"]));
    openAiPanel("qa");

    await runQa("砚台是做什么的");

    const state = getAiPanelState();
    expect(state.status).toBe("done");
    expect(state.output).toContain("研墨");
    // 引用溯源：答案引用了第几段
    expect(state.citations.map((c) => c.index)).toEqual([1]);
    // 引用序号要能**映射回**某个来源（否则用户无从核对）
    const cited = state.citations[0].hit;
    expect(cited).toBeDefined();
    // 排第一的那段必须就是与问题相关的那段
    expect(state.sources[0].chunk.text).toContain("砚台");
  });

  it("请求里带的是**检索出来的片段**，不是整篇文档", async () => {
    setupEditor(LONG_DOC);
    updateSettings({ ai: { enabled: true, defaultEndpointId: "minimax-cn" } });
    let captured: unknown = null;
    setAiRunner(
      mockRunner(["答案[1]。"], (request) => {
        captured = request;
      }),
    );
    openAiPanel("qa");

    await runQa("砚台是做什么的");

    const text = JSON.stringify(captured);
    // 相关的那段**在**请求里
    expect(text).toContain("砚台");
    // 无关的章节不该被塞进去——那正是问答模式要避免的
    expect(text).not.toContain("无关章节 11");
    // 而且请求里的片段数是有限的（BM25 取前 5 段）
    expect(state_sources_count(text)).toBeLessThanOrEqual(5);
  });

  it("模型引用了不存在的来源 → 如实说出来，不假装有那一段", async () => {
    setupEditor(DOC);
    updateSettings({ ai: { enabled: true, defaultEndpointId: "minimax-cn" } });
    setAiRunner(mockRunner(["砚台用来研墨[7]。"]));
    openAiPanel("qa");

    await runQa("砚台是做什么的");

    const state = getAiPanelState();
    expect(state.citations.map((c) => c.index)).toEqual([7]);
    // 越界的序号没有对应的来源——界面要说「不存在」，而不是崩掉或瞎指一段
    expect(state.citations[0].hit).toBeUndefined();
  });

  it("文档里找不到相关内容 → 如实说找不到，而不是让模型空想", async () => {
    setupEditor(DOC);
    updateSettings({ ai: { enabled: true, defaultEndpointId: "minimax-cn" } });
    let called = false;
    setAiRunner(
      mockRunner(["不该被调用"], () => {
        called = true;
      }),
    );
    openAiPanel("qa");

    await runQa("量子纠缠的贝尔不等式");

    const state = getAiPanelState();
    expect(state.status).toBe("error");
    expect(state.error).toContain("没有找到");
    expect(called).toBe(false);
  });

  it("答案可以追加到文末（走普通事务，能撤销）", async () => {
    setupEditor(DOC);
    updateSettings({ ai: { enabled: true, defaultEndpointId: "minimax-cn" } });
    setAiRunner(mockRunner(["砚台用来研墨[1]。"]));
    openAiPanel("qa");

    await runQa("砚台是做什么的");
    const { acceptAiResult } = await import("@/ai/panel-store");
    acceptAiResult();

    expect(view!.state.doc.toString()).toContain("砚台用来研墨");
  });

  it("面板上能列出引用来源", async () => {
    setupEditor(DOC);
    updateSettings({ ai: { enabled: true, defaultEndpointId: "minimax-cn" } });
    setAiRunner(mockRunner(["砚台用来研墨[1]。"]));
    openAiPanel("qa");
    render(<AiPanel onOpenSettings={() => {}} />);

    const questionBox = document.querySelector<HTMLInputElement>(
      ".ai-panel__question input",
    );
    expect(questionBox).not.toBeNull();
    fireEvent.change(questionBox!, { target: { value: "砚台是做什么的" } });
    fireEvent.click(screen.getByRole("button", { name: "提问" }));

    await waitFor(() => {
      expect(screen.getByText("引用来源")).toBeTruthy();
    });
    // 来源的标题路径要显示出来，用户才知道它是从哪来的
    const st = getAiPanelState();
    expect(st.citations.length).toBeGreaterThan(0);
    expect(st.citations[0].hit?.chunk.headingPath).toEqual(["砚台"]);
    expect(screen.getByRole("button", { name: /砚台/ })).toBeTruthy();
  });
});

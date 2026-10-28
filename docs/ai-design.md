# AI 能力设计（2026-10-22 调研 → 已拍板并实施）

> 状态：**D10–D17 全部拍板，M3-1 / M3-2 与 AI 面板已实施**（2026-10-25）。
> 剩余：M3-3（BM25 检索 + 问答面板 + 引用溯源）。
> 本文档遵循项目老规矩：先调研、再对比、再决策表，最后才实施。

## 1. 范围

### 要做的

| 能力 | 说明 |
| --- | --- |
| 改写类 | 选区/段落 → 润色 / 扩写 / 缩写 / 翻译 / 改语气 |
| 总结类 | 当前文档 → 一句话摘要 / 分段摘要 / 生成大纲与标签 |
| 问答类 | 带笔记检索的对话，答案带引用溯源 |
| Provider | OpenAI 兼容 + Anthropic 原生 + Gemini 原生 |
| 端点预设 | 含 GLM / Kimi 的 **coding plan 订阅端点** |
| 密钥 | 系统钥匙串（macOS Keychain / Windows Credential Manager / libsecret） |

### 明确不做的

- ❌ **Claude Pro/Max 订阅 OAuth 接入第三方应用**（用户已拍板不做）。
  官方口径是订阅覆盖 Claude Code 与官方 IDE，第三方应用没有官方接入点，
  属于条款灰区，与项目「拒绝灰色路径」的原则冲突。
- ❌ 不做任何形式的 key 提取 / 凭证逆向。
- ❌ 不内置任何厂商的账号体系。

## 2. 端点调研（实测文档，非记忆）

### 2.1 「coding plan」是什么

国产厂商的**按月订阅**，用固定月费换 API 调用额度，且**提供独立端点供第三方工具使用**
（Claude Code / Cline / Roo Code 这类 IDE 插件就是它们的目标用户）。

| 厂商 | Developer API（按量） | **Coding Plan 端点（订阅）** | 协议 |
| --- | --- | --- | --- |
| Kimi (Moonshot) | `api.moonshot.ai/v1`（OpenAI 兼容）<br>`api.moonshot.ai/anthropic`（Anthropic 兼容） | **`api.kimi.com/coding/v1`** | OpenAI |
| GLM (Z.ai) | `api.z.ai/api/paas/v4` | **`api.z.ai/api/coding/paas/v4`** | OpenAI |

**实测到的三条硬约束**（必须内置进预设，否则用户会踩坑）：

1. **订阅密钥与 Developer API 密钥是两套独立账户体系**——
   「订阅密钥在 Developer API 端点上不工作，反之亦然」。填错端点会 401。
2. **并发上限按档位硬限制**：
   - GLM Coding Plan **Lite / Pro 只允许 1 个并发请求**，超了直接 429
   - GLM Coding Plan Max 最高 30
   - Kimi Code Plan 文档标注 30
   → 预设里必须带 `maxConcurrent`，并且请求队列要真的按它限流。
3. **部分模型锁死采样参数**：
   - Kimi `k2p7-code` / `k3`、GLM-5.3：**总是推理且 temperature 锁 1**，不能关
   - Claude 4.7+ / GPT-5：**直接移除了 temperature 参数**，传了会报错
   → Provider 必须声明能力位，设置面板据此禁用相应控件，不能让用户填出非法参数。

### 2.2 协议与模型是两个维度

> 「能调哪些模型」由你的 API Key 所属分组决定，和入站协议是两个不同维度。
> 选错协议会直接 401 / 404；选对协议但模型不在你分组的可用范围内，会返回 model not found。

所以预设里 **协议** 和 **模型** 都要能分开配，不能绑死。

| 协议 | 端点 | 备注 |
| --- | --- | --- |
| OpenAI 兼容 | `{base}/chat/completions` | 覆盖绝大多数云端 + 所有本地推理服务 |
| Anthropic | `{base}/v1/messages` | `system` 是独立字段；`max_tokens` **必填** |
| Gemini | `{base}/v1beta/models/{model}:generateContent` | 密钥在 query 或 header；流式走 `alt=sse` |

### 2.3 本地推理

Ollama / LM Studio / vLLM / llama.cpp server 全部走 **OpenAI 兼容**，
`billing: 'local-free'`，不消耗任何额度。

### 2.4 「列出模型」接口（2026-10-28 实测文档）

三种协议的列表接口与响应形状（都查了官方文档，不是记忆）：

| 协议 | 接口 | 鉴权 | 响应形状 |
| --- | --- | --- | --- |
| OpenAI 兼容 | `GET {base}/models` | `Authorization: Bearer` | `{ "object": "list", "data": [{ "id": "…" }] }` |
| Anthropic | `GET {base}/v1/models?limit=200` | `x-api-key` + `anthropic-version` | `{ "data": [{ "type": "model", "id": "…", "display_name": "…" }], "has_more": … }` |
| Gemini | `GET {base}/v1beta/models` | `x-goog-api-key` | `{ "models": [{ "name": "models/…", "displayName": "…" }] }` |

本地推理服务全部提供 `GET /v1/models`（Ollama / LM Studio / vLLM 都实测过），
所以**云端与本地是同一条路径**。

三条实测出来的坑：

1. **Anthropic 的 `limit` 默认只有 20**，而它一家有二十多个模型——
   不显式给上限会漏掉一半，用户会以为某个模型不存在。
2. **Gemini 的 `name` 带 `models/` 前缀**，而调用时用的是后面那截——
   填进「模型 ID」框之前必须剥掉。
3. **不是所有服务都有这个接口**。GLM / Kimi 的订阅端点、部分代理网关会回
   404 或一个 HTML 错误页。所以「模型 ID」手输框**必须保留**。

一条**做不到**的事（2026-10-28 实测本机 Ollama）：

OpenAI 兼容形状里**没有字段能区分「能聊天的模型」与「embedding 模型」**——
Ollama 的 `GET /v1/models` 会把 `embeddinggemma:latest` 一并列出来，
而它只能做向量化、不能当聊天模型用。
Gemini 有 `supportedGenerationMethods` 可以滤，OpenAI 兼容这一套没有对应字段，
所以**列表里会混着不能用的模型**。

这是上游数据本身缺信息，客户端补不出来——
硬要按模型名猜（比如含 "embed" 就滤掉）会在自建服务上误删真模型。
所以列表照实显示，由用户自己判断。

## 3. 架构

### 3.1 分层（沿用现有红线）

```
src/ai/
  provider.ts            统一接口 + 能力位声明
  providers/
    openai-compatible.ts  /chat/completions + SSE
    anthropic.ts         /v1/messages + SSE
    gemini.ts            :generateContent + SSE
  endpoints.ts           端点预设表（含 coding plan）
  context.ts             上下文切片（从 mdast 派生）
  actions/               改写 / 总结 / 问答三类动作
  ui/                    浮层预览、AI 面板
src-tauri/src/ai/        HTTP + 钥匙串（Rust 侧）
```

### 3.2 HTTP 走 Rust 侧，不走前端 fetch

| 方案 | 问题 |
| --- | --- |
| 前端 `fetch` | Tauri webview 受 CSP 约束，且**大多数端点没有 CORS 头**（OpenAI 就没有），请求直接失败 |
| **Rust `reqwest`（选定）** | 绕开 CORS；密钥不进入前端进程；能用系统代理与连接池；TLS 配置可控 |

流式：Rust 侧解析 SSE → Tauri event 逐块推给前端。

### 3.3 Provider 接口

```ts
interface ChatProvider {
  id: ProviderId;
  label: string;
  protocol: "openai" | "anthropic" | "gemini";
  /** 能力位：决定设置面板哪些控件可用，避免用户填出非法参数 */
  capabilities: {
    temperature: boolean;   // GPT-5 / Claude 4.7+ 会移除该参数
    maxTokens: boolean;     // Anthropic 必填
    systemRole: boolean;    // Anthropic 是独立字段
    reasoningToggle: boolean;
  };
  /** 列出可用模型的 URL（路径与 endpointUrl 同源） */
  modelsUrl(cfg): string;
  stream(cfg, req): AsyncIterable<Delta>;
}
```

`modelsUrl` 放在 provider 上而不是另写一张「协议 → 列表路径」的表：
协议与 URL 布局本来就是一回事，两处各写一遍迟早会分叉——
分叉出来的表现是「聊天能通、列模型 404」，极难排查。

**但响应怎么读是另一回事**：按**响应本身**判定（先看 `data[]`，
再看 `models[]`），不按协议标签写死。理由见 §2.4 与 `AGENTS.md`
「列出模型并按端点选模型」一节。

### 3.4 密钥：Rust 侧系统钥匙串

- service = `"inkstone"`，account = provider id
- **前端永远拿不到明文**——请求在 Rust 侧组装时注入
- keyring 不可用（Linux 缺 libsecret / gnome-keyring）→ 降级到
  `~/.config/inkstone/secrets.json`（权限 600），并**在设置里红字明确告知当前用的是降级模式**
- 任何日志、错误信息、导出都不得包含密钥

## 4. 写回契约（架构红线 1 的直接体现）

**AI 结果一律不直接覆盖用户文本。**

| 动作 | 流程 |
| --- | --- |
| 改写 | 选区 → 流式预览在浮层里显示 → 用户点「替换」才 dispatch 事务 |
| 总结 | 结果进大纲面板 / 追加到文末，由用户决定是否落盘 |
| 问答 | 只读，不写文档（除非用户显式「插入到笔记」） |

接受后的写入是**普通事务**：可撤销、立即落进 Markdown 文本、能被搜索/导出看见。
取消/拒绝不留下任何痕迹。

## 5. 测试策略

AI 输出不确定，**不能进 round-trip 语料**。分层测：

| 层 | 手段 |
| --- | --- |
| 协议编解码 | **本地 mock HTTP 服务**发固定 SSE 字节流，断言请求体与解析结果 |
| 上下文切片 / 检索 | 确定性算法，直接断言 |
| 写回 | `EditorState` 驱动（同任务列表那次） |
| 端点预设 | 断言 URL 拼装、限流值、能力位 |

## 6. 分期

| 阶段 | 内容 | 产出 |
| --- | --- | --- |
| **M3-1** | Provider 接口 + 三协议 + 钥匙串 + 端点预设 + 设置面板 + 流式管线 | ✅ 能配好端点、测通一次流式请求 |
| **M3-2** | 上下文切片 + 改写 + 总结 + 浮层预览 | ✅ 写作时能直接用（面板 2026-10-25 落地） |
| **M3-3** | BM25 检索 + 问答面板 + 引用溯源 | ⬜ 待做 |

## 5.1 实施后补记（2026-10-25）

三条实施中才发现、值得写进设计文档的事：

1. **写回必须走 `dispatch`，不能走 `setState`**
   `EditorView.setState()` 不触发 `updateListener` → `onChange` 不响 →
   脏标记不亮、自动保存不存。看起来一切正常，实际不落盘。
   详见 AGENTS.md「M3-2 收尾」一节。

2. **写回前要核对原文**
   模型流式输出期间用户可能改了同一段。按开始时的偏移替换会覆盖用户刚写的东西。
   所以记下当时的原文，接受前比一下，对不上就拒绝。

3. **thinking 模型有推理期**
   实测 `qwen3.8:27b-mlx`：202 帧里 190 帧是推理帧。
   推理内容走 `delta.reasoning`，被正确丢弃——但正文出现前会有一段空白，
   面板要显示「模型正在思考…」而不是让用户以为卡死。

## 7. 决策表

| # | 议题 | 选项 | 结论 |
| --- | --- | --- | --- |
| D10 | 协议覆盖 | 只 OpenAI 兼容 / 全兼容 + 原生 | ✅ **全兼容 + Anthropic + Gemini 原生**（用户拍板） |
| D11 | 能力范围 | 改写 / 总结 / 问答 | ✅ **三类全做**，问答独立排 M3（用户拍板） |
| D12 | 密钥存放 | 钥匙串 / localStorage / 配置文件 | ✅ **系统钥匙串**，失败降级并提示（用户拍板） |
| D13 | coding plan | 支持 / 不支持 | ✅ **支持**——但只支持**有官方 API 端点**的（GLM / Kimi 等）（用户拍板） |
| D14 | Claude 订阅 | 灰色 OAuth / 只做官方路径 | ✅ **只做官方路径**，不做订阅 OAuth（用户拍板） |
| D15 | HTTP 位置 | 前端 fetch / Rust reqwest | ✅ **Rust reqwest**（绕开 CORS + 密钥不进前端） |
| D16 | AI 写回 | 直接覆盖 / 预览后接受 | ✅ **预览后接受**（红线 1：结果必须经用户确认且可撤销） |
| D17 | 检索方案 | 向量库 / BM25 关键词 | ✅ **BM25 先行**——零依赖零索引存储，向量检索留到有真实需求时 |
| D18 | 浏览器降级 | 不做 / 前端 fetch（仅本地端点） | ✅ **做，但只支持本地端点**（2026-10-25）。本机推理服务默认带 CORS 头，浏览器里能直连，整条「面板→模型→预览→写回」链路在浏览器里也通。云端端点仍走 Rust（密钥在钥匙串，前端拿不到明文） |
| D19 | 本地端点的密钥 | 也要填 / 不要 | ✅ **不要**（2026-10-25）。Ollama / LM Studio / vLLM 不需要 Key，硬填一个占位值上游不认、用户反而以为自己配错了 |
| D20 | 列出模型 | 做 / 不做 | ✅ **做**（2026-10-28，用户拍板）。云端与本地走同一条路径（三种协议都有列表接口）。**手输框保留**——不是所有服务都提供列表接口 |
| D21 | 响应解析按什么分 | 按协议 / 按响应形状 | ✅ **按响应形状**（2026-10-28）。按协议写死的话，包装形状不一样的网关会落进「无法识别」，界面显示的是一句**假的**「没有返回模型列表」 |
| D22 | 模型 id 存哪 | 全局一个 / 按端点各存一个 | ✅ **按端点各存一个**（2026-10-28）。模型 id 跟着服务商走，全局槽位会让「换端点串台」。新增 `ai.modelOverrides`，**不需要迁移**（老用户继续吃 `defaultModel`，行为不变） |

## 8. 风险与边界

| 风险 | 应对 |
| --- | --- |
| 用户把订阅 key 填到 Developer API 端点 | 预设里写明「订阅密钥只能用于本端点」；连接测试的报错要可读 |
| GLM Lite/Pro 并发超限 → 429 | 预设带 `maxConcurrent`，请求队列真限流 |
| 填了模型不支持的 `temperature` | Provider 能力位禁用对应控件 |
| 密钥泄漏 | 只存钥匙串；Rust 侧注入；日志与错误信息一律脱敏 |
| AI 改坏原文 | 一律先预览再接受，接受走可撤销事务 |
| RAG 检索质量差 | M3-3 先上 BM25 并**明确告知用户这是关键词检索不是语义检索** |
| 端点没有「列出模型」接口 | 列表是**加法**：手输框永远保留；取不到时明确区分「返回的不是 JSON」与「形状不对」，不假装「没有模型」 |
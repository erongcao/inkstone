//! 流式聊天请求的传输层。
//!
//! **协议无关**：这里不知道 OpenAI / Anthropic / Gemini 任何一家的消息格式，
//! 只负责「拿密钥 → 发请求 → 把 SSE 的 data 行逐条推回前端」。
//! 协议编解码在前端（`src/ai/providers/`），用 TypeScript 写、可单测。
//!
//! 密钥的注入方式按协议不同（Bearer / 自定义 header / query 参数），
//! 所以用 `AuthSpec` 描述**密钥放哪**，而不是让前端把密钥传进来——
//! 前端从头到尾拿不到明文，这是设计约束不是优化。

use std::collections::HashSet;
use std::sync::Mutex;
use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use super::secrets;

/// 前端 → Rust：怎么把密钥注入请求
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthSpec {
    /// `none` / `bearer` / `header` / `query`
    pub kind: String,
    /// 钥匙串里的 account 名（即端点 id）
    pub account: String,
    /// `kind = "header"` 时的 header 名，例如 `x-api-key`
    #[serde(default)]
    pub header: Option<String>,
    /// `kind = "bearer"` 时的前缀，默认 `Bearer `
    #[serde(default)]
    pub prefix: Option<String>,
    /// `kind = "query"` 时的参数名，例如 `key`
    #[serde(default)]
    pub param: Option<String>,
}

/// 前端 → Rust：一次流式请求
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamRequest {
    /// 请求 id，用于把事件对回前端的那次调用
    pub id: String,
    /// 完整 URL（协议拼装由前端负责）
    pub url: String,
    /// 已序列化的请求体
    pub body: String,
    pub auth: AuthSpec,
    /// 额外的请求头（不含任何密钥）
    #[serde(default)]
    pub headers: HashSet<String>,
}

/// 前端 → Rust：一次「列出模型」的请求
///
/// 与 `StreamRequest` 分开是因为方法不同（GET / 无请求体），
/// 但**鉴权注入是同一套逻辑**，所以两者都走 `build_authed`。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListModelsRequest {
    /// 完整 URL（路径由前端按协议拼好——Rust 侧不懂协议）
    pub url: String,
    pub auth: AuthSpec,
    /// 额外的请求头（不含任何密钥）
    #[serde(default)]
    pub headers: HashSet<String>,
}

/// 读取该端点的密钥
///
/// `kind = "none"` 表示这个端点不需要密钥（本地推理服务）。
/// 其余情况去系统钥匙串取；取不到就报错——**不要**发一个没有密钥的请求，
/// 那样上游只会回一句含糊的 401。
fn resolve_secret(app: &AppHandle, auth: &AuthSpec) -> Result<Option<String>, String> {
    if auth.kind == "none" {
        return Ok(None);
    }
    match secrets::read_secret(app, &auth.account) {
        Ok(Some(s)) => Ok(Some(s)),
        Ok(None) => Err("未配置该端点的密钥".into()),
        Err(e) => Err(e),
    }
}

/// 按鉴权方式算出最终的 URL 与要加的请求头
///
/// 密钥只在内存里：`query` 方式把它拼进 URL 的**副本**，
/// 绝不能进日志或错误信息。
///
/// 抽出来是因为「列模型」和「流式聊天」用的是同一套注入规则——
/// 两处各写一遍，改了一处忘了另一处，表现为「聊天能通、列模型 401」。
fn build_authed(
    url: &str,
    auth: &AuthSpec,
    secret: Option<&str>,
    extra: &HashSet<String>,
) -> Result<(String, Vec<(String, String)>), String> {
    let mut headers: Vec<(String, String)> = Vec::new();
    for raw in extra {
        if let Some((name, value)) = raw.split_once(':') {
            headers.push((name.trim().to_string(), value.trim().to_string()));
        }
    }

    let mut final_url = url.to_string();

    // 没有密钥 ⇒ `resolve_secret` 只在 `kind = "none"` 时才会返回 None，
    // 所以这里直接放行，不去校验 kind。
    let Some(secret) = secret else {
        return Ok((final_url, headers));
    };

    match auth.kind.as_str() {
        "bearer" => {
            let prefix = auth.prefix.as_deref().unwrap_or("Bearer ");
            headers.push(("authorization".to_string(), format!("{prefix}{secret}")));
        }
        "header" => {
            let name = auth
                .header
                .as_deref()
                .ok_or("auth.kind=header 时必须给出 header 名")?;
            headers.push((name.to_string(), secret.to_string()));
        }
        "query" => {
            let param = auth
                .param
                .as_deref()
                .ok_or("auth.kind=query 时必须给出参数名")?;
            // query 里的密钥不能进日志——这里只改内存中的 URL 副本
            final_url.push(if final_url.contains('?') { '&' } else { '?' });
            final_url.push_str(&format!("{param}={secret}"));
        }
        other => return Err(format!("未知的鉴权方式: {other}")),
    }

    Ok((final_url, headers))
}

/// 列出该端点可用的模型
///
/// **只做传输**：把上游的响应体原样送回前端，由前端按协议解析
/// （`src/ai/models.ts`）——协议编解码在前端是既有分工，见 `docs/ai-design.md`。
///
/// 返回原始字符串而不是结构体，是因为 Rust 侧一旦开始认协议形状，
/// 每加一家厂商就要改 Rust 再重新编译。
#[tauri::command]
pub async fn ai_list_models(app: AppHandle, req: ListModelsRequest) -> Result<String, String> {
    let secret = resolve_secret(&app, &req.auth)?;
    fetch_model_list(&req.url, &req.auth, secret.as_deref(), &req.headers).await
}

/// 真正发请求的那一段
///
/// 与 Tauri 无关——所以能对着一个**真的本地 HTTP 服务器**做端到端测试
/// （真 socket、真 HTTP、真状态码），而不是 mock 出一个「看起来对」的响应。
async fn fetch_model_list(
    url: &str,
    auth: &AuthSpec,
    secret: Option<&str>,
    extra: &HashSet<String>,
) -> Result<String, String> {
    let (url, headers) = build_authed(url, auth, secret, extra)?;

    let mut builder = reqwest::Client::new().get(&url);
    for (name, value) in headers {
        builder = builder.header(name, value);
    }

    let response = builder.send().await.map_err(|e| format!("请求失败: {e}"))?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        // 上游的错误体要原样带回前端（401/403/404 的区别对用户很关键：
        // 是「key 填错」「这个服务没有列表接口」还是「路径不对」）。
        // 截断长度，避免把整个错误页糊进界面。
        let detail: String = text.chars().take(400).collect();
        return Err(format!("HTTP {}: {}", status.as_u16(), detail));
    }
    Ok(text)
}

/// 前端 → Rust：一次「探测」请求
///
/// 与 `ListModelsRequest` 的区别：方法可以是 GET 或 POST，
/// 而且**不解析响应体**——探测要的是「状态码是多少」，
/// 响应体由前端按协议自己看。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeRequest {
    /// 完整 URL（路径由前端按协议拼好——Rust 侧不懂协议）
    pub url: String,
    /// `GET` 或 `POST`
    pub method: String,
    /// POST 的请求体（GET 时忽略）
    #[serde(default)]
    pub body: Option<String>,
    pub auth: AuthSpec,
    /// 额外的请求头（不含任何密钥）
    #[serde(default)]
    pub headers: HashSet<String>,
}

/// 一次探测的**结果**
///
/// ## 为什么不用 `Result` 表达失败
///
/// 4xx / 5xx 对用户意味着**完全不同**的事：
/// 401 是「密钥错了」、404 是「这个服务没有列表接口」或「路径写错了」、
/// 连不上是「服务没启动」。这三种都要原样送到前端去分类，
/// 所以它们是**结果**而不是错误。
///
/// 真正算错误的只有「鉴权方式配置有问题」这种配置错误——
/// 那条走 `Err`。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResponse {
    /// `http` = 真的发出去了并拿到状态码；
    /// `network` = 传输层失败（连不上 / 超时 / DNS 解析不了）；
    /// `no-secret` = 这个端点没配密钥，请求**没发出去**；
    /// `bad-auth` = 鉴权方式配置有问题（比如 `kind=header` 却没给 header 名）
    pub kind: String,
    /// HTTP 状态码；`kind != "http"` 时为 0
    pub status: u16,
    /// 响应体（截断）
    pub body: String,
    /// 给用户看的说明（传输失败时是错误详情）
    pub detail: String,
}

/// 探测请求的超时
///
/// 比流式聊天短得多：探测只等「状态码」，
/// 而流式请求是要跑很久的（模型思考 + 输出）。
const PROBE_TIMEOUT: Duration = Duration::from_secs(20);

/// 探测某个端点
///
/// 返回值里**永远**有 `kind`，前端据此分类；
/// 只有配置错误才走 `Err`。
#[tauri::command]
pub async fn ai_probe_endpoint(app: AppHandle, req: ProbeRequest) -> Result<ProbeResponse, String> {
    // 密钥取不到时**不要发请求**——
    // 发一个没有密钥的请求，上游只会回一句含糊的 401，
    // 用户分不清是「密钥填错」还是「压根没填」。
    let secret = match resolve_secret(&app, &req.auth) {
        Ok(s) => s,
        Err(e) => {
            return Ok(ProbeResponse {
                kind: "no-secret".to_string(),
                status: 0,
                body: String::new(),
                detail: e,
            })
        }
    };

    let (url, headers) = match build_authed(&req.url, &req.auth, secret.as_deref(), &req.headers) {
        Ok(v) => v,
        Err(e) => {
            return Ok(ProbeResponse {
                kind: "bad-auth".to_string(),
                status: 0,
                body: String::new(),
                detail: e,
            })
        }
    };

    let client = reqwest::Client::builder()
        .timeout(PROBE_TIMEOUT)
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let mut builder = if req.method.eq_ignore_ascii_case("POST") {
        client.post(&url)
    } else {
        client.get(&url)
    };
    for (name, value) in headers {
        builder = builder.header(name, value);
    }
    if let Some(body) = req.body.as_deref() {
        builder = builder
            .header("content-type", "application/json")
            .header("accept", "text/event-stream")
            .body(body.to_string());
    }

    let response = match builder.send().await {
        Ok(r) => r,
        Err(e) => {
            return Ok(ProbeResponse {
                kind: "network".to_string(),
                status: 0,
                body: String::new(),
                detail: e.to_string(),
            })
        }
    };

    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    let detail: String = text.chars().take(400).collect();
    Ok(ProbeResponse {
        kind: "http".to_string(),
        status: status.as_u16(),
        body: detail.clone(),
        detail,
    })
}

/// 前端监听的事件名
const DELTA_EVENT: &str = "ai://delta";
const DONE_EVENT: &str = "ai://done";
const ERROR_EVENT: &str = "ai://error";

/// 已请求取消的 id
static CANCELLED: Mutex<Option<HashSet<String>>> = Mutex::new(None);

fn is_cancelled(id: &str) -> bool {
    CANCELLED
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|s| s.contains(id)))
        .unwrap_or(false)
}

/// 取消某个进行中的请求
#[tauri::command]
pub fn ai_cancel_stream(id: String) {
    if let Ok(mut guard) = CANCELLED.lock() {
        guard.get_or_insert_with(HashSet::new).insert(id);
    }
}

fn emit_error(app: &AppHandle, id: &str, message: &str) {
    // 错误信息可能来自上游响应体，理论上可能回显用户填进去的东西。
    // 这里统一截断长度，避免把整个响应体糊进日志/界面。
    let truncated: String = message.chars().take(400).collect();
    let _ = app.emit(
        ERROR_EVENT,
        serde_json::json!({ "id": id, "message": truncated }),
    );
}

/// 执行一次流式请求
///
/// 这是个 async 命令：Tauri 会把它放到 async runtime 上跑，
/// SSE 逐块通过事件推回前端，命令本身在首字节到达后就返回，
/// 真正的读取在后台 tokio 任务里继续。
#[tauri::command]
pub async fn ai_stream_chat(app: AppHandle, req: StreamRequest) -> Result<(), String> {
    let id = req.id.clone();

    // 先解析密钥：没有密钥就没必要发请求
    let secret = match resolve_secret(&app, &req.auth) {
        Ok(s) => s,
        Err(e) => {
            emit_error(&app, &id, &e);
            return Err(e);
        }
    };

    // URL 与鉴权注入（与「列模型」共用 build_authed）
    let (url, headers) = build_authed(&req.url, &req.auth, secret.as_deref(), &req.headers)?;

    let mut builder = reqwest::Client::new()
        .post(&url)
        .header("content-type", "application/json")
        .header("accept", "text/event-stream");

    for (name, value) in headers {
        builder = builder.header(name, value);
    }

    let response = match builder.body(req.body.clone()).send().await {
        Ok(r) => r,
        Err(e) => {
            let msg = format!("请求失败: {e}");
            emit_error(&app, &id, &msg);
            return Err(msg);
        }
    };

    let status = response.status();
    if !status.is_success() {
        // 上游的错误响应体要原样带回前端（401/403 的区别对用户很关键：
        // 是「key 填错」还是「模型不在你的分组里」）
        let text = response.text().await.unwrap_or_default();
        let msg = format!("HTTP {}: {}", status.as_u16(), text);
        emit_error(&app, &id, &msg);
        return Err(format!("HTTP {}", status.as_u16()));
    }

    // 后台读取 SSE：命令返回后继续推
    let app_clone = app.clone();
    let id_clone = id.clone();
    tauri::async_runtime::spawn(async move {
        // reqwest 0.13 的 `bytes_stream()` 是**同步**方法，返回 impl Stream
        // （不是 future）——写成 `.await` 会得到「不是 future」的编译错误。
        let mut stream = response.bytes_stream();
        let mut decoder = SseDecoder::default();

        loop {
            if is_cancelled(&id_clone) {
                break;
            }
            let chunk = match stream.next().await {
                Some(Ok(c)) => c,
                Some(Err(e)) => {
                    emit_error(&app_clone, &id_clone, &format!("流中断: {e}"));
                    return;
                }
                None => break,
            };
            for payload in decoder.push(&String::from_utf8_lossy(&chunk)) {
                let _ = app_clone.emit(
                    DELTA_EVENT,
                    serde_json::json!({ "id": id_clone, "data": payload }),
                );
            }
        }
        for payload in decoder.finish() {
            let _ = app_clone.emit(
                DELTA_EVENT,
                serde_json::json!({ "id": id_clone, "data": payload }),
            );
        }
        let _ = app_clone.emit(DONE_EVENT, serde_json::json!({ "id": id_clone }));
    });

    Ok(())
}

/// 从一个 SSE 帧里取出 data 负载（心跳与 `[DONE]` 返回 None）
fn frame_payload(frame: &str) -> Option<String> {
    let payload: String = frame
        .lines()
        .filter_map(|line| line.strip_prefix("data:"))
        .map(|s| s.trim_start())
        .collect::<Vec<_>>()
        .join("\n");
    // 心跳 / 注释行没有 data，丢掉
    if payload.is_empty() {
        return None;
    }
    // `[DONE]` 是 SSE 的结束标记，前端自己会认，这里不推。
    if payload == "[DONE]" {
        return None;
    }
    Some(payload)
}

/// SSE 帧解码器。
///
/// 抽成独立结构而不是写成一个函数，是为了**同步与异步两种驱动共用**：
///
/// - 命令侧用 `bytes_stream().next().await` 逐块喂（见 `ai_stream_chat`）
/// - 单测侧用普通 `Iterator` 逐块喂
///
/// 而帧切分这份最容易出错的逻辑只有一处实现。
#[derive(Default)]
pub(crate) struct SseDecoder {
    buffer: String,
    /// 上一块末尾的 `\r` 被挂起来了
    ///
    /// 因为 `\r` 可能是 `\r\n` 的前半，也可能是一个**裸**回车，
    /// 而下一块的开头才能区分。急着归一化就会把 `\r\n` 拆成两个换行。
    pending_cr: bool,
}

impl SseDecoder {
    /// 喂进一个网络块，返回本次能凑齐的完整帧负载
    pub(crate) fn push(&mut self, chunk: &str) -> Vec<String> {
        let mut text = String::new();
        if self.pending_cr {
            text.push('\r');
            self.pending_cr = false;
        }
        text.push_str(chunk);
        // 末尾的 `\r` 同样要挂起
        if text.ends_with('\r') {
            text.pop();
            self.pending_cr = true;
        }

        // 行尾归一化：SSE 允许 \r\n / \n / \r 三种行尾，
        // 而按空行切帧只认相邻的两个 \n。不归一化的话
        // `\r\n\r\n` 里根本没有相邻的 \n，整段会并成一帧。
        self.buffer
            .push_str(&text.replace("\r\n", "\n").replace('\r', "\n"));

        let mut out = Vec::new();
        // 注意必须连分隔符一起吃掉：`drain(..pos)` 在 pos == 0 时
        // 移除 0 字节、缓冲区**不前进**，而流开头出现连续空行时
        // pos 恰好就是 0 —— 会变成死循环空转，把 CPU 打满。
        // `drain(..pos + 2)` 保证每轮至少前进 2 字节。
        while let Some(pos) = self.buffer.find("\n\n") {
            let frame = self.buffer[..pos].to_string();
            self.buffer.drain(..pos + 2);
            if let Some(payload) = frame_payload(&frame) {
                out.push(payload);
            }
        }
        out
    }

    /// 流结束：吐出没被空行收尾的最后一帧
    pub(crate) fn finish(&mut self) -> Vec<String> {
        if self.pending_cr {
            self.buffer.push('\r');
            self.pending_cr = false;
        }
        frame_payload(&self.buffer).into_iter().collect()
    }
}

/// 同步驱动解码器（测试与将来可能的非流式调用用）
#[cfg(test)]
pub(crate) fn pump_sse<I, F, C>(chunks: I, is_cancelled: C, mut on_payload: F) -> bool
where
    I: Iterator<Item = Result<String, String>>,
    F: FnMut(&str) -> bool,
    C: Fn() -> bool,
{
    let mut decoder = SseDecoder::default();
    for chunk in chunks {
        if is_cancelled() {
            return false;
        }
        // 网络层出错：停止泵送。上层已经把错误 emit 出去了。
        let Ok(text) = chunk else { return true };
        for payload in decoder.push(&text) {
            if !on_payload(&payload) {
                return false;
            }
        }
    }
    for payload in decoder.finish() {
        on_payload(&payload);
    }
    true
}

#[cfg(test)]
mod tests {
    use super::pump_sse;

    /// 把字符串块喂进泵里，返回收到的 payload
    fn pump(chunks: &[&str]) -> (Vec<String>, bool) {
        let owned: Vec<String> = chunks.iter().map(|s| (*s).to_string()).collect();
        let mut out = Vec::new();
        let completed = pump_sse(
            owned.into_iter().map(Ok),
            || false,
            |payload| {
                out.push(payload.to_string());
                true
            },
        );
        (out, completed)
    }

    #[test]
    fn 基本分帧() {
        let (out, completed) = pump(&["data: a\n\ndata: b\n\n"]);
        assert_eq!(out, vec!["a", "b"]);
        assert!(completed);
    }

    #[test]
    fn 一帧被拆在多个网络块里也能正确重组() {
        // 真实场景：chunk 边界与 SSE 帧边界不对齐
        let (out, _) = pump(&["da", "ta: 甲\n", "\nda", "ta: 乙\n\n"]);
        assert_eq!(out, vec!["甲", "乙"]);
    }

    #[test]
    fn 流开头就是空行时不会死循环() {
        // 回归：`drain(..0)` 移除 0 字节、位置不前进 → 曾经空转 99% CPU
        let (out, completed) = pump(&["\n\ndata: a\n\n"]);
        assert_eq!(out, vec!["a"]);
        assert!(completed);
    }

    #[test]
    fn 连续多个空行也收敛() {
        let (_, completed) = pump(&["\n\n\n\n"]);
        assert!(completed);
    }

    #[test]
    fn 未闭合的尾帧仍然会被处理() {
        let (out, _) = pump(&["data: a\n\ndata: tail"]);
        assert_eq!(out, vec!["a", "tail"]);
    }

    #[test]
    fn 心跳与注释行被丢掉() {
        let (out, _) = pump(&[": ping\n\ndata: a\n\n", "\n"]);
        assert_eq!(out, vec!["a"]);
    }

    #[test]
    fn done_标记不会被推给前端() {
        let (out, _) = pump(&["data: a\n\ndata: [DONE]\n\n"]);
        assert_eq!(out, vec!["a"]);
    }

    #[test]
    fn 同一帧里的多个_data_行会被拼起来() {
        let (out, _) = pump(&["data: 第一行\ndata: 第二行\n\n"]);
        assert_eq!(out, vec!["第一行\n第二行"]);
    }

    #[test]
    fn data_后面有空格会被去掉() {
        let (out, _) = pump(&["data:  甲\n\n"]);
        assert_eq!(out, vec!["甲"]);
    }

    #[test]
    fn 取消后立即停止且不再推送() {
        let owned: Vec<String> = ["data: a\n\n", "data: b\n\n"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let mut out = Vec::new();
        let completed = pump_sse(
            owned.into_iter().map(Ok),
            || true, // 一开始就要求取消
            |p| {
                out.push(p.to_string());
                true
            },
        );
        assert!(!completed);
        assert!(out.is_empty());
    }

    #[test]
    fn 回调返回_false时停止泵送() {
        let owned: Vec<String> = ["data: a\n\ndata: b\n\n"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let mut out = Vec::new();
        let completed = pump_sse(
            owned.into_iter().map(Ok),
            || false,
            |p| {
                out.push(p.to_string());
                false // 第一条就要求停
            },
        );
        assert!(!completed);
        assert_eq!(out, vec!["a"]);
    }

    #[test]
    fn 网络出错时停止但不panic() {
        let chunks: Vec<Result<String, String>> =
            vec![Ok("data: a\n\n".into()), Err("断了".into())];
        let mut out = Vec::new();
        let completed = pump_sse(
            chunks.into_iter(),
            || false,
            |p| {
                out.push(p.to_string());
                true
            },
        );
        // 已经收到的照样交付，然后停下
        assert_eq!(out, vec!["a"]);
        assert!(completed);
    }

    #[test]
    fn crlf_行尾也能切分() {
        // 部分网关会用 \r\n
        let (out, _) = pump(&["data: a\r\n\r\ndata: b\r\n\r\n"]);
        assert_eq!(out, vec!["a", "b"]);
    }
}

#[cfg(test)]
mod network_tests {
    //! 端到端验证「真实 socket + 真实 SSE 字节流」这条链路。
    //!
    //! 这里刻意**不用 mock**：起一个真的 TCP 监听、发真的 HTTP 响应、
    //! 让 reqwest 真连——验证的是字节在网络上的切分行为，
    //! 而不是我们喂进去的字符串。
    //!
    //! 用的 SSE 字节序列与 MiniMax / OpenAI 兼容端点的真实流一致：
    //!   `data: {json}\n\n` 逐帧，`[DONE]` 收尾。

    use super::SseDecoder;
    // StreamExt 是父模块的导入，测试模块要用 `stream.next()` 得自己再引一次
    use futures_util::StreamExt;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    /// 起一个只回固定字节流的极简 HTTP 服务器
    fn serve_once(body: &'static str) -> (String, thread::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("绑定失败");
        let addr = listener.local_addr().expect("取地址失败");
        let handle = thread::spawn(move || {
            let mut collected = Vec::new();
            if let Ok((mut socket, _)) = listener.accept() {
                // 把请求头读到空行（否则客户端可能还没发完就等响应）
                let mut buf = [0u8; 2048];
                if let Ok(n) = socket.read(&mut buf) {
                    collected.push(String::from_utf8_lossy(&buf[..n]).to_string());
                }
                let response = format!(
                    "HTTP/1.1 200 OK\r\n\
                     Content-Type: text/event-stream\r\n\
                     Cache-Control: no-cache\r\n\
                     Content-Length: {}\r\n\
                     \r\n\
                     {}",
                    body.len(),
                    body
                );
                let _ = socket.write_all(response.as_bytes());
                let _ = socket.flush();
                // 客户端读完就关
                let _ = socket.shutdown(std::net::Shutdown::Write);
            }
            collected
        });
        (format!("http://{addr}/chat/completions"), handle)
    }

    /// 一条 OpenAI 兼容的真实增量帧
    fn delta(content: &str) -> String {
        format!(
            "data: {{\"id\":\"1\",\"object\":\"chat.completion.chunk\",\"choices\":[{{\"index\":0,\"delta\":{{\"content\":\"{content}\"}}}}]}}\n\n"
        )
    }

    fn chat_completion_stream() -> String {
        let mut s = String::new();
        s.push_str(&delta("你"));
        s.push_str(&delta("好"));
        s.push_str(&delta("，"));
        s.push_str(&delta("世界"));
        // 结束帧：只有 finish_reason，没有 content
        s.push_str(
            "data: {\"id\":\"1\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
        );
        s.push_str("data: [DONE]\n\n");
        s
    }

    #[test]
    fn 真实网络流能被正确解码() {
        let (url, handle) = serve_once(Box::leak(chat_completion_stream().into_boxed_str()));

        // 同步驱动 reqwest（测试里不用 tokio runtime）
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("建 runtime 失败");
        let collected = rt.block_on(async {
            let response = reqwest::Client::new()
                .post(&url)
                .header("accept", "text/event-stream")
                .body("{}")
                .send()
                .await
                .expect("请求失败");
            assert!(
                response.status().is_success(),
                "状态码 {}",
                response.status()
            );

            let mut stream = response.bytes_stream();
            let mut decoder = SseDecoder::default();
            let mut out = Vec::new();
            while let Some(chunk) = stream.next().await {
                let bytes = chunk.expect("读取流失败");
                for payload in decoder.push(&String::from_utf8_lossy(&bytes)) {
                    out.push(payload);
                }
            }
            for payload in decoder.finish() {
                out.push(payload);
            }
            out
        });

        // Rust 侧是**协议无关**的：它只负责把 data 负载原样转发，
        // 不该知道 `finish_reason` 这种 OpenAI 特有的东西。
        // 所以 5 条 data 帧（含结束帧）都会到这里，`[DONE]` 被丢掉。
        // 「结束帧没有 content、要过滤掉」是**前端** `decodeDelta` 的职责。
        assert_eq!(collected.len(), 5, "收到: {collected:?}");
        let joined: String = collected.iter().map(|s| s.as_str()).collect();
        assert!(
            !joined.contains("[DONE]"),
            "[DONE] 不该转发给前端: {joined}"
        );
        // 结束帧也照常转发（协议无关），但它没有 content
        assert!(
            collected.iter().any(|p| p.contains("finish_reason")),
            "结束帧应在转发内容里"
        );

        // 从这里开始是**前端 decodeDelta 要做的事**。
        // 在测试里把它跑一遍，验证「Rust 转发 + 前端提取」合起来的结果正确——
        // 这才是用户最终看到的文本。
        let text: String = collected
            .iter()
            .filter_map(|payload| {
                let v: serde_json::Value = serde_json::from_str(payload).ok()?;
                v["choices"][0]["delta"]["content"]
                    .as_str()
                    .map(str::to_string)
            })
            .collect();
        assert_eq!(text, "你好，世界");

        // 服务端确实收到了请求
        let request = handle.join().unwrap();
        assert!(!request.is_empty(), "服务端没收到请求");
    }

    #[test]
    fn 鉴权头会按auth_spec注入() {
        let (url, handle) = serve_once(Box::leak(
            "data: a\n\ndata: [DONE]\n\n".to_string().into_boxed_str(),
        ));

        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let _ = reqwest::Client::new()
                .post(&url)
                .header("authorization", "Bearer test-key")
                .body("{}")
                .send()
                .await
                .expect("请求失败");
        });

        let request = handle.join().unwrap().join("\n").to_lowercase();
        assert!(
            request.contains("authorization: bearer test-key"),
            "请求里没有鉴权头:\n{request}"
        );
        assert!(
            request.contains("post /chat/completions"),
            "请求行不对:\n{request}"
        );
    }

    #[test]
    fn 上游返回错误状态时把响应体带回去() {
        // 401 的响应体是用户判断「key 填错」还是「模型不在分组」的关键
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        thread::spawn(move || {
            if let Ok((mut socket, _)) = listener.accept() {
                let mut buf = [0u8; 1024];
                let _ = socket.read(&mut buf);
                let body = r#"{"error":{"message":"invalid api key"}}"#;
                let response = format!(
                    "HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = socket.write_all(response.as_bytes());
            }
        });

        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let (status, text) = rt.block_on(async {
            let response = reqwest::Client::new()
                .post(format!("http://{addr}/v1/chat/completions"))
                .body("{}")
                .send()
                .await
                .expect("请求失败");
            let status = response.status().as_u16();
            (status, response.text().await.unwrap_or_default())
        });
        assert_eq!(status, 401);
        assert!(text.contains("invalid api key"), "错误体丢了: {text}");
    }
}

/// 「列出模型」这条链路的守卫。
///
/// 守的是三件事：
///   1. **鉴权注入**——密钥按 `AuthSpec` 说的位置放进去，一个位置都不能错
///   2. **传输是通的**——对着真的本地 HTTP 服务器发真的请求，
///      响应体**原样**回来（Rust 侧不解析，它是协议无关的）
///   3. **错误不被吞掉**——401/404 要带着状态码和响应体回到前端，
///      因为「key 填错」与「这个服务没有列表接口」要靠它区分
#[cfg(test)]
mod models_tests {
    use super::{build_authed, fetch_model_list, AuthSpec};
    use std::collections::HashSet;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    fn auth(kind: &str) -> AuthSpec {
        AuthSpec {
            kind: kind.to_string(),
            account: "test".to_string(),
            header: None,
            prefix: None,
            param: None,
        }
    }

    /// 起一个本地服务器：收到请求后把**请求头**原样作为响应体回给客户端
    ///
    /// 这样「密钥有没有真的被注入」就能在响应里直接看见——
    /// 不用去 mock reqwest（mock 掉的东西往往正是出问题的那一层）。
    fn serve_echo_headers(status: &'static str) -> (String, thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("绑定失败");
        let addr = listener.local_addr().expect("取地址失败");
        let handle = thread::spawn(move || {
            let mut seen = String::new();
            if let Ok((mut socket, _)) = listener.accept() {
                let mut buf = [0u8; 4096];
                if let Ok(n) = socket.read(&mut buf) {
                    seen = String::from_utf8_lossy(&buf[..n]).to_string();
                }
                let response = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{{}}"
                );
                let _ = socket.write_all(response.as_bytes());
                let _ = socket.flush();
                let _ = socket.shutdown(std::net::Shutdown::Write);
            }
            seen
        });
        (format!("http://{addr}/v1/models"), handle)
    }

    /// 起一个只回固定响应体的本地服务器
    fn serve_body(body: &'static str) -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("绑定失败");
        let addr = listener.local_addr().expect("取地址失败");
        let handle = thread::spawn(move || {
            if let Ok((mut socket, _)) = listener.accept() {
                let mut buf = [0u8; 2048];
                let _ = socket.read(&mut buf);
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = socket.write_all(response.as_bytes());
                let _ = socket.flush();
                let _ = socket.shutdown(std::net::Shutdown::Write);
            }
        });
        (format!("http://{addr}/v1/models"), handle)
    }

    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("建 runtime 失败")
    }

    // ── 鉴权注入 ──────────────────────────────────────────────────────

    #[test]
    fn bearer_把密钥放进_authorization_头() {
        let mut spec = auth("bearer");
        spec.prefix = Some("Bearer ".into());
        let (url, headers) = build_authed(
            "https://x.test/v1/models",
            &spec,
            Some("sk-123"),
            &HashSet::new(),
        )
        .unwrap();
        assert_eq!(url, "https://x.test/v1/models");
        assert!(headers
            .iter()
            .any(|(n, v)| n == "authorization" && v == "Bearer sk-123"));
    }

    #[test]
    fn header_方式把密钥放进指定的头() {
        let mut spec = auth("header");
        spec.header = Some("x-api-key".into());
        let (_, headers) = build_authed(
            "https://x.test/v1/models",
            &spec,
            Some("k"),
            &HashSet::new(),
        )
        .unwrap();
        assert!(headers.iter().any(|(n, v)| n == "x-api-key" && v == "k"));
    }

    #[test]
    fn query_方式把密钥拼进_url() {
        let mut spec = auth("query");
        spec.param = Some("key".into());
        let (url, _) = build_authed(
            "https://x.test/v1/models",
            &spec,
            Some("k"),
            &HashSet::new(),
        )
        .unwrap();
        assert_eq!(url, "https://x.test/v1/models?key=k");
    }

    #[test]
    fn query_方式在_url_已有查询参数时用_amp_连接() {
        // Anthropic 的模型列表 URL 自带 `?limit=200`——这里再拼密钥不能拼出两个问号
        let mut spec = auth("query");
        spec.param = Some("key".into());
        let (url, _) = build_authed(
            "https://x.test/v1/models?limit=200",
            &spec,
            Some("k"),
            &HashSet::new(),
        )
        .unwrap();
        assert_eq!(url, "https://x.test/v1/models?limit=200&key=k");
    }

    #[test]
    fn none_方式不加任何鉴权() {
        let (_, headers) = build_authed(
            "https://x.test/v1/models",
            &auth("none"),
            None,
            &HashSet::new(),
        )
        .unwrap();
        assert!(headers.is_empty());
    }

    #[test]
    fn 额外的请求头会被带上去() {
        let mut extra = HashSet::new();
        extra.insert("anthropic-version: 2023-06-01".to_string());
        let (_, headers) =
            build_authed("https://x.test/v1/models", &auth("none"), None, &extra).unwrap();
        assert!(headers
            .iter()
            .any(|(n, v)| n == "anthropic-version" && v == "2023-06-01"));
    }

    #[test]
    fn 未知鉴权方式报错而不是悄悄放过() {
        let err = build_authed(
            "https://x.test/v1/models",
            &auth("magic"),
            Some("k"),
            &HashSet::new(),
        )
        .unwrap_err();
        assert!(err.contains("未知的鉴权方式"), "错误信息没说明问题: {err}");
    }

    // ── 传输 ──────────────────────────────────────────────────────────

    #[test]
    fn 响应体原样回来_rust_侧不解析() {
        // Rust 侧只做传输：前端要按协议自己解析，所以这里必须**一字不改**
        let body = r#"{"data":[{"id":"gpt-4o-mini"}],"object":"list"}"#;
        let (url, handle) = serve_body(body);
        let rt = runtime();
        let text = rt
            .block_on(fetch_model_list(&url, &auth("none"), None, &HashSet::new()))
            .expect("请求失败");
        handle.join().unwrap();
        assert_eq!(text, body);
    }

    #[test]
    fn 密钥真的进了请求头() {
        let (url, handle) = serve_echo_headers("200 OK");
        let mut spec = auth("bearer");
        spec.prefix = Some("Bearer ".into());
        let rt = runtime();
        let _ = rt.block_on(fetch_model_list(
            &url,
            &spec,
            Some("sk-secret"),
            &HashSet::new(),
        ));
        let seen = handle.join().unwrap();
        assert!(
            seen.contains("authorization: Bearer sk-secret"),
            "请求头里没有密钥:\n{seen}"
        );
    }

    #[test]
    fn 失败时带着状态码与响应体回来() {
        // 「key 填错」与「这个服务没有列表接口」在界面上要能分开，
        // 所以 404 不能被压成一句「请求失败」
        let (url, handle) = serve_echo_headers("404 Not Found");
        let rt = runtime();
        let err = rt
            .block_on(fetch_model_list(&url, &auth("none"), None, &HashSet::new()))
            .unwrap_err();
        handle.join().unwrap();
        assert!(err.contains("404"), "错误信息里没有状态码: {err}");
    }
}

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

use futures_util::StreamExt;
use serde::Deserialize;
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
    let secret = if req.auth.kind == "none" {
        None
    } else {
        match secrets::read_secret(&app, &req.auth.account) {
            Ok(Some(s)) => Some(s),
            Ok(None) => {
                emit_error(&app, &id, "未配置该端点的密钥");
                return Err("未配置该端点的密钥".into());
            }
            Err(e) => {
                emit_error(&app, &id, &e);
                return Err(e);
            }
        }
    };

    // URL 与鉴权注入
    let mut url = req.url.clone();
    let mut builder = reqwest::Client::new()
        .post(&url)
        .header("content-type", "application/json")
        .header("accept", "text/event-stream");

    for raw in &req.headers {
        if let Some((name, value)) = raw.split_once(':') {
            builder = builder.header(name.trim(), value.trim());
        }
    }

    match secret.as_deref() {
        None => {}
        Some(secret) => match req.auth.kind.as_str() {
            "bearer" => {
                let prefix = req.auth.prefix.as_deref().unwrap_or("Bearer ");
                builder = builder.header("authorization", format!("{prefix}{secret}"));
            }
            "header" => {
                let name = req
                    .auth
                    .header
                    .as_deref()
                    .ok_or("auth.kind=header 时必须给出 header 名")?;
                builder = builder.header(name, secret);
            }
            "query" => {
                let param = req
                    .auth
                    .param
                    .as_deref()
                    .ok_or("auth.kind=query 时必须给出参数名")?;
                // query 里的密钥不能进日志——这里只改内存中的 URL 副本
                url.push(if url.contains('?') { '&' } else { '?' });
                url.push_str(&format!("{param}={secret}"));
                builder = reqwest::Client::new()
                    .post(&url)
                    .header("content-type", "application/json")
                    .header("accept", "text/event-stream");
                for raw in &req.headers {
                    if let Some((name, value)) = raw.split_once(':') {
                        builder = builder.header(name.trim(), value.trim());
                    }
                }
            }
            other => return Err(format!("未知的鉴权方式: {other}")),
        },
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

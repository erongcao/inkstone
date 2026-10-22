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

        // SSE 帧边界由这里切：按空行分隔，每帧可能有多个 data: 行
        let mut buffer = String::new();
        while let Some(chunk) = stream.next().await {
            if is_cancelled(&id_clone) {
                break;
            }
            let chunk = match chunk {
                Ok(c) => c,
                Err(e) => {
                    emit_error(&app_clone, &id_clone, &format!("流中断: {e}"));
                    return;
                }
            };
            buffer.push_str(&String::from_utf8_lossy(&chunk));

            // 注意必须连分隔符一起吃掉：`drain(..pos)` 在 pos == 0 时
            // 移除 0 字节、缓冲区**不前进**，而流开头出现连续空行时
            // pos 恰好就是 0 —— 会变成死循环空转，把 CPU 打满。
            // `drain(..pos + 2)` 保证每轮至少前进 2 字节。
            while let Some(pos) = buffer.find("\n\n") {
                let frame = buffer[..pos].to_string();
                buffer.drain(..pos + 2);
                emit_frame(&app_clone, &id_clone, &frame);
            }
        }
        if !buffer.is_empty() {
            emit_frame(&app_clone, &id_clone, &buffer);
        }
        let _ = app_clone.emit(DONE_EVENT, serde_json::json!({ "id": id_clone }));
    });

    Ok(())
}

/// 把一个 SSE 帧里的 data 行拼出来推给前端
fn emit_frame(app: &AppHandle, id: &str, frame: &str) {
    let payload: String = frame
        .lines()
        .filter_map(|line| line.strip_prefix("data:"))
        .map(|s| s.trim_start())
        .collect::<Vec<_>>()
        .join("\n");
    if payload.is_empty() {
        return;
    }
    // `[DONE]` 是 SSE 的结束标记，前端自己会认，这里不推。
    if payload == "[DONE]" {
        return;
    }
    let _ = app.emit(
        DELTA_EVENT,
        serde_json::json!({ "id": id, "data": payload }),
    );
}

#[cfg(test)]
mod tests {
    /// 把生产代码里的切分逻辑抽出来单独测——
    /// 那个 while 曾经因为 `drain(..0)` 不前进而死循环空转，
    /// 所以这里必须覆盖「开头就是空行」这个边界。
    fn split_frames(buffer: &mut String) -> Vec<String> {
        let mut frames = Vec::new();
        while let Some(pos) = buffer.find("\n\n") {
            let frame = buffer[..pos].to_string();
            buffer.drain(..pos + 2);
            frames.push(frame);
        }
        frames
    }

    #[test]
    fn 分帧逻辑按空行切分() {
        let mut buffer = String::from("data: a\n\ndata: b\n\n");
        assert_eq!(split_frames(&mut buffer), vec!["data: a", "data: b"]);
        assert!(buffer.is_empty());
    }

    #[test]
    fn 流开头就是空行时不会死循环() {
        // 回归用例：`drain(..0)` 移除 0 字节、位置不前进 → 曾经空转 99% CPU
        let mut buffer = String::from("\n\ndata: a\n\n");
        let frames = split_frames(&mut buffer);
        assert_eq!(frames, vec!["", "data: a"]);
        assert!(buffer.is_empty());
    }

    #[test]
    fn 连续多个空行也收敛() {
        let mut buffer = String::from("\n\n\n\n");
        let frames = split_frames(&mut buffer);
        assert!(frames.len() <= 3);
        assert!(buffer.is_empty());
    }

    #[test]
    fn 未闭合的尾帧仍然会被处理() {
        // 上游最后一段可能没有空行结尾
        let mut buffer = String::from("data: a\n\ndata: tail");
        assert_eq!(split_frames(&mut buffer), vec!["data: a"]);
        assert_eq!(buffer, "data: tail");
    }
}

//! AI 能力的 Rust 侧。
//!
//! 分工：**Rust 只做传输与密钥，协议编解码在前端**。
//!
//! 这样切的三个理由：
//!   1. HTTP 必须走 Rust（绕开 CORS、密钥不进前端进程）——见 `docs/ai-design.md` D15
//!   2. 协议编解码放 TypeScript 能被 vitest 直接单测，
//!      而 Rust 侧只测「帧怎么切」这种纯逻辑
//!   3. 前端要能**动态拼**请求体（不同模型能力位不同），
//!      放 Rust 意味着每加一家厂商就要改 Rust 再重新编译

pub mod http;
pub mod secrets;

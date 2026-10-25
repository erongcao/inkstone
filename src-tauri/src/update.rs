//! 检查更新：问 GitHub Releases 最新发布是什么。
//!
//! ## 为什么只做到「打开下载页」
//!
//! 最简形态：查到新版本 → 告诉用户 → 给一个下载页链接，
//! 让用户自己下载、自己替换。
//!
//! 不做自动下载、不做自动安装、不做差分更新——
//! 那需要发布签名密钥、增量包、跨平台安装器替换逻辑，
//! 而这个项目连第一个正式版本都还没发。
//! 现在做那些，等于给一个还不存在的发布流程写适配层。
//!
//! ## 只负责取数据，版本比较留在前端
//!
//! 版本号怎么比，放到 TypeScript 那边（`src/ipc/update.ts`），
//! 这样它能被 vitest 直接测到——
//! 「1.10.0 比 1.9.0 新」这种坑，正是要靠测试钉住的。
//! Rust 这边只做一次 HTTP GET。

use serde::Serialize;

/// 仓库坐标（GitHub owner/repo）
const REPO: &str = "erongcao/inkstone";

/// GitHub Releases 的最新发布（只取用得上的字段）
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatestRelease {
    /// 当前应用版本（来自 Cargo.toml）
    pub current: String,
    /// 发布标签，可能带 `v` 前缀（`v0.2.0`）
    pub tag: String,
    /// 发布页地址
    pub url: String,
    /// 发布说明，可能是空串
    pub notes: String,
}

/// GitHub 返回的 release 里我们用得上的字段
#[derive(serde::Deserialize)]
struct ReleasePayload {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    body: Option<String>,
}

/// 取最新发布
///
/// 还没有正式发布时（仓库里只有 draft release）返回空 tag ——
/// 那不是错误，是「目前没有新版本可升」。
#[tauri::command]
pub async fn latest_release() -> Result<LatestRelease, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let url = format!("https://api.github.com/repos/{REPO}/releases/latest");

    let client = reqwest::Client::builder()
        .user_agent(format!("Inkstone/{current}"))
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let response = client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| format!("连接 GitHub 失败: {e}"))?;

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        // 还没有正式发布：给出发布列表页当下载入口
        return Ok(LatestRelease {
            current,
            tag: String::new(),
            url: format!("https://github.com/{REPO}/releases"),
            notes: String::new(),
        });
    }

    if !response.status().is_success() {
        return Err(format!("GitHub 返回 {}", response.status()));
    }

    let payload: ReleasePayload = response
        .json()
        .await
        .map_err(|e| format!("解析 GitHub 响应失败: {e}"))?;

    Ok(LatestRelease {
        current,
        tag: payload.tag_name,
        url: payload.html_url,
        notes: payload.body.unwrap_or_default(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 解析发布字段() {
        // 用 r###"…"### 而不是 r#"…"#：发布说明里常出现 Markdown 标题
        // （"## 变更"），那串 `"##` 会把 r#"…"#、r##"…"## 提前截断。
        let json = r###"{
            "tag_name": "v0.2.0",
            "html_url": "https://github.com/erongcao/inkstone/releases/tag/v0.2.0",
            "body": "## 变更\n- 修了三个 bug"
        }"###;
        let payload: ReleasePayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.tag_name, "v0.2.0");
        assert_eq!(
            payload.html_url,
            "https://github.com/erongcao/inkstone/releases/tag/v0.2.0"
        );
        assert_eq!(payload.body.unwrap(), "## 变更\n- 修了三个 bug");
    }

    #[test]
    fn 没有发布说明时是空串而不是报错() {
        let json = r#"{"tag_name": "v0.2.0", "html_url": "https://x/", "body": null}"#;
        let payload: ReleasePayload = serde_json::from_str(json).unwrap();
        assert!(payload.body.unwrap_or_default().is_empty());
    }

    #[test]
    fn 缺少_body_字段也能解析() {
        let json = r#"{"tag_name": "v0.2.0", "html_url": "https://x/"}"#;
        let payload: ReleasePayload = serde_json::from_str(json).unwrap();
        assert!(payload.body.is_none());
    }

    #[test]
    fn 当前版本来自_cargo_manifest() {
        // 这个断言的意义：发布出去的二进制必须与 Cargo.toml 里的版本一致，
        // 否则「检查更新」会比出一个假的「有新版」
        assert_eq!(env!("CARGO_PKG_VERSION"), "0.1.0");
    }
}

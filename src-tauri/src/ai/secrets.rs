//! 密钥存储。
//!
//! 主路径是**系统钥匙串**：macOS Keychain / Windows Credential Manager /
//! Linux libsecret（secret-service）。前端永远拿不到明文——
//! 明文只在 Rust 侧组装请求时注入。
//!
//! 钥匙串不可用时（典型是 Linux 没装 gnome-keyring / libsecret）
//! 降级到 `~/.config/inkstone/secrets.json`，权限强制 600，
//! 并且**必须**让前端知道当前处于降级模式——安全提示不能沉默。
//!
//! 绝不做的事：
//!   - 不把密钥写进 `Cargo.toml` 附近的任何配置或日志
//!   - 不把密钥放进 Tauri 的 state 让前端能读
//!   - 错误信息里不回显密钥（哪怕是「key=xxx」这种形式）

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// 钥匙串里的 service 名
const SERVICE: &str = "inkstone";

/// 密钥文件的权限位（仅 owner 可读写）
#[cfg(unix)]
fn restrict_permissions(path: &PathBuf) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|e| format!("设置密钥文件权限失败: {e}"))
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &PathBuf) -> Result<(), String> {
    Ok(())
}

fn secrets_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("定位配置目录失败: {e}"))?;
    Ok(dir.join("secrets.json"))
}

fn read_fallback(app: &AppHandle) -> Result<HashMap<String, String>, String> {
    let path = secrets_path(app)?;
    match fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| format!("密钥文件损坏: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
        Err(e) => Err(format!("读取密钥文件失败: {e}")),
    }
}

fn write_fallback(app: &AppHandle, map: &HashMap<String, String>) -> Result<(), String> {
    let path = secrets_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {e}"))?;
    }
    let text = serde_json::to_string_pretty(map).map_err(|e| format!("序列化密钥失败: {e}"))?;
    fs::write(&path, text).map_err(|e| format!("写入密钥文件失败: {e}"))?;
    restrict_permissions(&path)
}

/// 当前密钥后端。前端据此提示用户是否处于降级模式。
#[derive(Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SecretBackend {
    /// 系统钥匙串（安全）
    Keyring,
    /// 降级到权限 600 的本地文件（不安全但可用）
    FileFallback,
}

fn probe_keyring(account: &str) -> bool {
    // 探针：写一个空值再删掉。写比读更能暴露「存储不可用」
    // （只读探针在凭据库锁定时会误判为可用）。
    keyring::Entry::new(SERVICE, account)
        .and_then(|e| e.set_password(""))
        .and_then(|_| keyring::Entry::new(SERVICE, account)?.delete_credential())
        .is_ok()
}

/// 前端可见的密钥状态：**永远不含明文**
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretStatus {
    /// 该端点是否已配置密钥
    pub configured: bool,
    /// 当前使用的后端
    pub backend: SecretBackend,
    /// 后端是否为降级模式（前端据此显示红字提示）
    pub degraded: bool,
}

/// 查询某个端点的密钥状态
#[tauri::command]
pub fn ai_secret_status(app: AppHandle, account: String) -> Result<SecretStatus, String> {
    let backend = if probe_keyring(&account) {
        SecretBackend::Keyring
    } else {
        SecretBackend::FileFallback
    };
    let configured = match backend {
        SecretBackend::Keyring => keyring::Entry::new(SERVICE, &account)
            .and_then(|e| e.get_password())
            .is_ok_and(|s| !s.is_empty()),
        SecretBackend::FileFallback => read_fallback(&app)?
            .get(&account)
            .is_some_and(|s| !s.is_empty()),
    };
    Ok(SecretStatus {
        configured,
        backend,
        degraded: backend == SecretBackend::FileFallback,
    })
}

/// 写入密钥（不返回明文，也不回显旧值）
#[tauri::command]
pub fn ai_set_secret(app: AppHandle, account: String, secret: String) -> Result<(), String> {
    if probe_keyring(&account) {
        keyring::Entry::new(SERVICE, &account)
            .and_then(|e| e.set_password(&secret))
            .map_err(|e| format!("写入钥匙串失败: {e}"))
    } else {
        let mut map = read_fallback(&app)?;
        map.insert(account, secret);
        write_fallback(&app, &map)
    }
}

/// 读取密钥。**只供 Rust 内部组装请求时使用**，
/// 不通过 `invoke_handler` 暴露——前端要拿到密钥就没有意义了。
pub(crate) fn read_secret(app: &AppHandle, account: &str) -> Result<Option<String>, String> {
    if let Ok(entry) = keyring::Entry::new(SERVICE, account) {
        if let Ok(secret) = entry.get_password() {
            if !secret.is_empty() {
                return Ok(Some(secret));
            }
        }
    }
    Ok(read_fallback(app)?.get(account).cloned())
}

/// 删除密钥
#[tauri::command]
pub fn ai_delete_secret(app: AppHandle, account: String) -> Result<(), String> {
    if let Ok(entry) = keyring::Entry::new(SERVICE, &account) {
        // 删不存在的条目不算失败
        match entry.delete_credential() {
            Ok(()) => {}
            Err(keyring::Error::NoEntry) => {}
            Err(e) => return Err(format!("从钥匙串删除失败: {e}")),
        }
    }
    let mut map = read_fallback(&app)?;
    map.remove(&account);
    write_fallback(&app, &map)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 后端判定不泄漏密钥内容() {
        // 这是纯函数层面的护栏：状态结构体里根本没有明文字段
        let status = SecretStatus {
            configured: true,
            backend: SecretBackend::Keyring,
            degraded: false,
        };
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"configured\":true"));
        assert!(json.contains("\"backend\":\"keyring\""));
        // 没有 secret / password 之类的字段
        assert!(!json.contains("secret"));
        assert!(!json.contains("password"));
    }
}

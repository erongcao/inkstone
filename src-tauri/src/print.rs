//! PDF 导出：临时 WebView 窗口 + 系统打印面板。
//!
//! ## 为什么用系统打印面板而不是自己生成 PDF
//!
//! 本机没有 LaTeX / wkhtmltopdf / weasyprint / typst / libreoffice
//! （实测全部缺失），所以「渲染成 PDF 文件」这件事只能交给系统。
//!
//! macOS 的 WKWebView 提供 `printOperation:`，弹出的打印面板里有
//! 「PDF → 存储为 PDF」，能把当前 WebView 的内容存成 PDF 文件。
//! Tauri 2 的 `Webview::print()` 正是封装了这个调用。
//!
//! ## 流程
//!
//! 1. 前端把打印专用 HTML 传进来
//! 2. 写进临时目录的一个 `.html` 文件
//! 3. 开一个临时窗口加载它（隐藏，只用于打印）
//! 4. **等页面报「就绪」** → 调 `print()` → 弹出系统打印面板
//! 5. 用户在面板里选「存储为 PDF」
//!
//! ## 第 4 步为什么是「等页面报就绪」而不是「睡一会儿」
//!
//! 原来的实现是「等 load 事件 → `sleep(300ms)` → 打印」。
//! 那个 300ms 是个**猜测**：睡够了没有，取决于机器快慢、网络图大小、
//! 字体是否命中——每次都不一样。
//!
//! 实测同类工具的教训很直白：连续 6 次 dump，页数依次是 2/0/1/0/3/1——
//! **靠固定时长猜「内容稳了」，两头都会错**，最后产出半截文件。
//!
//! 所以改成：页面里挂一段就绪脚本（见 `src/export/pdf.ts` 的 `printReadyScript`），
//! 等字体加载完、每张图**解码**完（不只是下载完），在 `<html>` 上放一个
//! `data-print-ready="1"`；这边用 `eval_with_callback` 读这个标记，
//! 读到了才打印。
//!
//! 两道保险：
//!   - 页内 15 秒兜底——一张永远加载不出来的图不该把导出卡死；
//!   - 这边 20 秒兜底——超时后照样打印（少张图好过没文件）。
//!
//! ## 为什么用 `eval_with_callback` 而不是 `eval`
//!
//! Tauri 2 的 `eval` **没有返回值**（`Result<()>`），
//! `eval_with_callback` 才把 JS 的求值结果回传。
//! 回传的是 **JSON 序列化**后的字符串（wry 用 `NSJSONSerialization`，
//! 开了 `FragmentsAllowed`），所以布尔值回来是 `"true"` / `"false"`。
//!
//! ## 为什么用临时文件而不是 data: URL
//!
//! data: URL 有长度限制（WKWebView 上约 2 MB），而一份带内联 CSS 的
//! 文档很容易超过它。临时文件没有这个限制。
//!
//! ## 窗口要不要显示
//!
//! 显示。理由：打印面板是**系统级**的，它覆盖在应用窗口之上，
//! 但用户仍然需要能看到「要打印的是什么」。隐藏窗口会让用户对着
//! 一个凭空出现的打印对话框，不知道自己在打印什么。

use std::path::PathBuf;
use std::sync::mpsc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// 临时窗口的 label
const PRINT_WINDOW_LABEL: &str = "inkstone-print";

/// 探测页面状态的 JS
///
/// 返回三个值之一：
///
///   - `"ready"`   —— 内容就绪，可以打印
///   - `"pending"` —— 就绪门在跑，但还没好
///   - `"absent"`  —— **脚本压根没跑起来**（抛异常了？被挡了？）
///     这种时候不该等——每导一次都白等 20 秒，比原来的 300ms 还糟。
///
/// 页面里的就绪脚本一进去就写 `data-print-gate="1"`，
/// 等完字体与图才写 `data-print-ready="1"`
/// （见 `src/export/pdf.ts` 的 `printReadyScript`）。
const READY_PROBE_JS: &str = "(function(){var e=document.documentElement;\
if(e.getAttribute('data-print-ready')==='1')return 'ready';\
if(e.getAttribute('data-print-gate')==='1')return 'pending';\
return 'absent';})()";

/// 这边最多等多久（毫秒）。超时后照样打印——少张图好过没文件。
const READY_TIMEOUT: Duration = Duration::from_secs(20);

/// 两次探测之间的间隔
const READY_POLL_INTERVAL: Duration = Duration::from_millis(50);

/// 单次探测的等待上限
///
/// `eval_with_callback` 的回调是异步的（要回到主线程执行），
/// 所以这里给它一个上限，别让某一次不回调把整个等待拖死。
const PROBE_TIMEOUT: Duration = Duration::from_millis(500);

/// 页面就绪状态
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReadyState {
    /// 内容就绪
    Ready,
    /// 就绪门在跑，还没好
    Pending,
    /// 脚本没跑起来——别等了
    Absent,
}

/// 探测一次页面的就绪状态
///
/// 返回 `None` = 这次没拿到结果（eval 失败，或回调没在时限内回来）。
fn probe_print_ready(window: &WebviewWindow) -> Option<ReadyState> {
    let (tx, rx) = mpsc::channel::<String>();
    window
        .eval_with_callback(READY_PROBE_JS, move |result| {
            let _ = tx.send(result);
        })
        .ok()?;
    let raw = rx.recv_timeout(PROBE_TIMEOUT).ok()?;
    // 回传的是 JSON 序列化的结果：字符串 → `"\"ready\""`（带引号）
    let text = raw.trim().trim_matches('"');
    match text {
        "ready" => Some(ReadyState::Ready),
        "pending" => Some(ReadyState::Pending),
        _ => Some(ReadyState::Absent),
    }
}

/// 等页面报「就绪」
///
/// `probe` 抽成闭包是为了能离线测：真实的探测要一个 WebView，
/// 而「等多久就放弃」「探测失败怎么办」这些**策略**必须能验。
///
/// 探测失败（`None`）**不等于**「没就绪」，也不等于「就绪」——
/// 它只是这次没拿到结果，要接着等。
fn wait_until_ready(
    mut probe: impl FnMut() -> Option<ReadyState>,
    deadline: Instant,
    interval: Duration,
) -> ReadyState {
    loop {
        match probe() {
            Some(ReadyState::Ready) => return ReadyState::Ready,
            // 脚本压根没跑起来 → 不等了，直接打印
            Some(ReadyState::Absent) => return ReadyState::Absent,
            Some(ReadyState::Pending) | None => {}
        }
        let now = Instant::now();
        if now >= deadline {
            return ReadyState::Pending;
        }
        // 睡到间隔或者 deadline，取小的那个——
        // 不然最后一段会睡过头，超时就不准了
        std::thread::sleep(interval.min(deadline.saturating_duration_since(now)));
    }
}

/// 在真实的打印窗口上等就绪
fn wait_for_print_ready(window: &WebviewWindow, timeout: Duration) -> ReadyState {
    wait_until_ready(
        || probe_print_ready(window),
        Instant::now() + timeout,
        READY_POLL_INTERVAL,
    )
}

/// 打印完（用户关掉打印面板）后要清理临时文件
#[tauri::command]
pub async fn print_document(
    app: AppHandle,
    html: String,
    suggested_path: String,
) -> Result<(), String> {
    // 1. 写临时 HTML
    let dir = temp_dir()?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let file_path = dir.join(format!(
        "inkstone-print-{}-{stamp}.html",
        std::process::id()
    ));
    std::fs::write(&file_path, html).map_err(|e| format!("写入临时文件失败: {e}"))?;

    // 2. 关掉可能存在的旧窗口（上一次打印没关干净的情况）
    if let Some(existing) = app.get_webview_window(PRINT_WINDOW_LABEL) {
        let _ = existing.close();
    }

    // 3. 开临时窗口
    //
    // `on_page_load` 是 **builder 上的**方法（消费 self 并返回 Self），
    // 不是 WebviewWindow 上的实例方法——所以必须链在 build 之前。
    let url = tauri::Url::from_file_path(&file_path)
        .map_err(|_| format!("无法构造临时文件 URL: {}", file_path.display()))?;

    let file_for_cleanup = file_path.clone();
    // macOS 的打印面板默认拿**页面标题**当 PDF 文件名。
    // 所以窗口标题就是建议的文件名（去掉目录与扩展名）——
    // 用户在面板里直接点「存储为 PDF」就能得到想要的名字。
    let suggested_name = std::path::Path::new(&suggested_path)
        .file_stem()
        .map(|stem| stem.to_string_lossy().to_string())
        .unwrap_or_else(|| "未命名".to_string());

    WebviewWindowBuilder::new(&app, PRINT_WINDOW_LABEL, WebviewUrl::External(url))
        .title(&suggested_name)
        .inner_size(900.0, 1200.0)
        .on_page_load(move |window, payload| {
            // 4. 等页面加载完再打印——
            //    立刻调 print() 的话页面还没渲染，打出来是空白页
            if payload.event() != tauri::webview::PageLoadEvent::Finished {
                return;
            }
            let file = file_for_cleanup.clone();
            // 放到后台线程：print() 是同步的阻塞调用，
            // 在 UI 线程上调会让窗口卡住不响应
            std::thread::spawn(move || {
                // 等页面**自己报**就绪（字体加载完、图解码完），
                // 而不是靠睡一个猜出来的时长。
                match wait_for_print_ready(&window, READY_TIMEOUT) {
                    ReadyState::Ready => {}
                    ReadyState::Absent => {
                        // 脚本没跑起来——多半是抛异常了。
                        // 这时再等下去只是白等，直接打印。
                        eprintln!("打印页面的就绪脚本没有跑起来，直接打印（PDF 里可能缺图）");
                    }
                    ReadyState::Pending => {
                        eprintln!(
                            "打印页面在 {:?} 内没有报就绪，仍然继续打印（PDF 里可能缺图）",
                            READY_TIMEOUT
                        );
                    }
                }
                // 解码完成后还要给渲染留一帧的时间
                std::thread::sleep(Duration::from_millis(50));
                if let Err(err) = window.print() {
                    eprintln!("调起打印面板失败: {err}");
                }
                // 打印面板是模态的，用户关掉它之后窗口就没用了。
                // 这里等一段时间再关——立刻关会让打印面板连带消失。
                std::thread::sleep(Duration::from_secs(30));
                let _ = window.close();
                let _ = std::fs::remove_file(&file);
            });
        })
        .build()
        .map_err(|e| format!("创建打印窗口失败: {e}"))?;

    Ok(())
}

/// 临时目录（优先用系统临时目录）
fn temp_dir() -> Result<PathBuf, String> {
    std::env::temp_dir()
        .join("inkstone-print")
        .canonicalize()
        .or_else(|_| {
            let dir = std::env::temp_dir().join("inkstone-print");
            std::fs::create_dir_all(&dir).map_err(|e| format!("创建临时目录失败: {e}"))?;
            dir.canonicalize()
                .map_err(|e| format!("解析临时目录失败: {e}"))
        })
}

/// 用系统默认程序打开一个路径（文件或文件夹）
///
/// 自己实现而不用 `tauri-plugin-opener`：那个插件的 `opener:default` 权限
/// 只允许打开 http/https URL，不含任意本地路径。而「导出后打开文件」
/// 必须能打开本地文件——这正是用户的预期。
#[tauri::command]
pub async fn open_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("打开失败: {e}"))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("打开失败: {e}"))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("打开失败: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 临时目录可用() {
        let dir = temp_dir().expect("临时目录应该能创建");
        assert!(dir.exists());
        assert!(dir.to_string_lossy().contains("inkstone-print"));
    }

    #[test]
    fn 等到就绪就返回() {
        let mut n = 0;
        let state = wait_until_ready(
            || {
                n += 1;
                Some(if n >= 3 {
                    ReadyState::Ready
                } else {
                    ReadyState::Pending
                })
            },
            Instant::now() + Duration::from_secs(5),
            Duration::from_millis(1),
        );
        assert_eq!(state, ReadyState::Ready);
        assert!(n >= 3, "至少要探测到第三次");
    }

    #[test]
    fn 一直没就绪就超时放弃() {
        let state = wait_until_ready(
            || Some(ReadyState::Pending),
            Instant::now() + Duration::from_millis(60),
            Duration::from_millis(10),
        );
        assert_eq!(state, ReadyState::Pending);
    }

    #[test]
    fn 探测失败不当成没就绪也不当成就绪() {
        // `None` 只是「这次没拿到结果」——
        // 当成「没就绪」会白等，当成「就绪」会提前打印（缺图）。
        // 两种都不对：应该接着等。
        let mut n = 0;
        let state = wait_until_ready(
            || {
                n += 1;
                if n < 3 {
                    None
                } else {
                    Some(ReadyState::Ready)
                }
            },
            Instant::now() + Duration::from_secs(5),
            Duration::from_millis(1),
        );
        assert_eq!(state, ReadyState::Ready);
        assert!(n >= 3);
    }

    #[test]
    fn 脚本没跑起来就不等() {
        // 「脚本压根没跑起来」与「还没好」是两回事：
        // 前者再等下去只是白等（每次导出都白等 20 秒，比原来的 300ms 还糟）。
        let start = Instant::now();
        let state = wait_until_ready(
            || Some(ReadyState::Absent),
            start + Duration::from_secs(20),
            Duration::from_millis(50),
        );
        assert_eq!(state, ReadyState::Absent);
        assert!(
            start.elapsed() < Duration::from_millis(500),
            "不该等，实际耗时 {:?}",
            start.elapsed()
        );
    }

    #[test]
    fn 超时之后不再多等() {
        // 超时点要准：睡到间隔或 deadline 里小的那个，
        // 不然最后一段会睡过头，超时就不准了。
        let start = Instant::now();
        let state = wait_until_ready(
            || Some(ReadyState::Pending),
            start + Duration::from_millis(100),
            Duration::from_millis(500),
        );
        assert_eq!(state, ReadyState::Pending);
        let elapsed = start.elapsed();
        assert!(
            elapsed < Duration::from_millis(400),
            "不该睡过头，实际耗时 {elapsed:?}"
        );
    }

    #[test]
    fn 探测用的_js_读的是就绪标记() {
        // 探测的判据必须与页面脚本放的标记一致——
        // 两边各写一个字符串，改了一边就永远读不到。
        assert!(READY_PROBE_JS.contains("data-print-ready"));
        assert!(READY_PROBE_JS.contains("data-print-gate"));
        assert!(READY_PROBE_JS.contains("ready"));
        assert!(READY_PROBE_JS.contains("pending"));
        assert!(READY_PROBE_JS.contains("absent"));
    }
}

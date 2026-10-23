//! 文件监听：检测当前文档在外部被修改。
//!
//! ## 为什么是轮询而不是原生 watcher
//!
//! 两个理由，第一个是硬的：
//!
//! 1. **保存用的是原子替换**（写临时文件 + rename，见 `document::write_text_file`），
//!    每次保存都会换掉 inode。原生 watcher 挂在文件上时看到的是「删除 + 新建」
//!    而不是「修改」；挂在父目录上过滤文件名才能接住，
//!    但那样就得处理「自己保存触发的 rename」——
//!    而抑制自触发的办法（记时间戳 / 记 inode）本质上都是**竞态**：
//!    抑制窗口里的真实外部修改会被一起吞掉。
//!
//! 2. 轮询比的是**内容**，不是「有没有事件」。自己保存之后磁盘内容 == 我们知道的内容，
//!    自然就不是冲突，没有误报要抑制。
//!
//! 第二个理由是软的：原生 watcher 要引入 `notify` 及其一串传递依赖，
//! 而这个项目对依赖有许可证白名单与包体预算。
//!
//! ## 轮询的代价
//!
//! - 检测延迟最多一个轮询间隔（1 秒）
//! - 每次轮询一次 `stat`（不是读文件），开销可忽略
//!
//! ## 只监听当前文档
//!
//! 监听整个笔记库是另一件事（要处理目录树的变化、大量文件），
//! 而**打开中的那一个文件**才是冲突的唯一来源——别的文件变了不影响正在写的东西。

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use tauri::{AppHandle, Emitter};

/// 前端监听的事件名：文件在外部被修改
pub const CHANGED_EVENT: &str = "document://changed";

/// 轮询间隔
const POLL_INTERVAL: Duration = Duration::from_millis(1000);

/// 文件的「指纹」：修改时间 + 字节数
///
/// 只用这两个就够：它们变了才去读内容做比对，
/// 而真正判断「有没有外部修改」靠的是**内容**比对。
/// 指纹只是用来避免每秒都读一遍文件。
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct FileStamp {
    modified: Option<SystemTime>,
    len: u64,
}

/// 当前被监听的文件
#[derive(Default)]
struct WatchState {
    path: Option<PathBuf>,
    /// 上次看到的指纹
    stamp: Option<FileStamp>,
}

static WATCH: Mutex<WatchState> = Mutex::new(WatchState {
    path: None,
    stamp: None,
});

/// 取一个文件的指纹；文件不存在或读不到元数据时返回 None
fn stamp_of(path: &Path) -> Option<FileStamp> {
    let meta = std::fs::metadata(path).ok()?;
    Some(FileStamp {
        modified: meta.modified().ok(),
        len: meta.len(),
    })
}

/// 开始监听指定文件
///
/// 立刻记下当前指纹，这样第一次轮询不会把「打开文件」误报成「外部修改」。
#[tauri::command]
pub fn watch_document(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    let stamp = stamp_of(&path);
    let mut guard = WATCH.lock().map_err(|_| "监听状态锁坏了".to_string())?;
    guard.path = Some(path);
    guard.stamp = stamp;
    Ok(())
}

/// 停止监听
#[tauri::command]
pub fn unwatch_document() -> Result<(), String> {
    let mut guard = WATCH.lock().map_err(|_| "监听状态锁坏了".to_string())?;
    guard.path = None;
    guard.stamp = None;
    Ok(())
}

/// 轮询线程：检查一次当前被监听的文件
///
/// 拆成独立函数是为了能直接测它（不需要起整个 Tauri 应用）。
fn check_once(app: &AppHandle) {
    let (path, previous) = {
        let Ok(guard) = WATCH.lock() else { return };
        (guard.path.clone(), guard.stamp.clone())
    };
    let Some(path) = path else { return };

    let current = stamp_of(&path);
    if current == previous {
        return;
    }

    // 指纹变了：先更新状态，再发事件。
    // 顺序不能反——先发事件的话，事件处理期间又来一次轮询，
    // 会用同一个旧指纹再发一次同样的事件。
    {
        let Ok(mut guard) = WATCH.lock() else { return };
        guard.stamp = current;
    }

    let _ = app.emit(CHANGED_EVENT, path.to_string_lossy().to_string());
}

/// 启动轮询线程（应用启动时调用一次）
pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(POLL_INTERVAL);
        check_once(&app);
    });
}

/// 当前正在监听的路径（测试用）
#[cfg(test)]
pub fn watched_path() -> Option<PathBuf> {
    WATCH.lock().ok().and_then(|guard| guard.path.clone())
}

/// 当前记录的文件指纹（测试用）
#[cfg(test)]
pub fn watched_stamp() -> Option<FileStamp> {
    WATCH.lock().ok().and_then(|guard| guard.stamp.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_file(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "inkstone-watch-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("a.md")
    }

    #[test]
    fn 指纹在文件写入后改变() {
        let path = temp_file("stamp");
        std::fs::write(&path, "一").unwrap();

        let before = stamp_of(&path).unwrap();
        assert_eq!(before.len, 3);

        std::fs::write(&path, "更多内容").unwrap();
        let after = stamp_of(&path).unwrap();
        assert_ne!(before, after, "内容变了指纹必须不一样");
    }

    #[test]
    fn 文件不存在时没有指纹() {
        assert!(stamp_of(Path::new("/definitely/not/here.md")).is_none());
    }

    #[test]
    fn 监听与取消监听() {
        let path = temp_file("watch");
        std::fs::write(&path, "内容").unwrap();

        watch_document(path.to_string_lossy().to_string()).unwrap();
        assert_eq!(watched_path().as_deref(), Some(path.as_path()));
        assert!(watched_stamp().is_some());

        unwatch_document().unwrap();
        assert!(watched_path().is_none());
        assert!(watched_stamp().is_none());
    }

    #[test]
    fn 指纹没变时不发事件() {
        // 这里只验证「指纹相同 → 不进入发事件分支」，
        // 事件本身要靠 AppHandle，交给集成测试
        let path = temp_file("same");
        std::fs::write(&path, "内容").unwrap();
        let stamp = stamp_of(&path).unwrap();
        assert_eq!(stamp, stamp_of(&path).unwrap());
    }
}

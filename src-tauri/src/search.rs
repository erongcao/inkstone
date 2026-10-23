//! 全局搜索：跨文件查找（普通文本 / 正则）。
//!
//! ## 为什么要放在 Rust 侧
//!
//! 一次搜索可能要读上千个文件。放在前端（浏览器）做，要么把文件全读进内存，
//! 要么让渲染进程卡住；放在 Rust 侧可以：
//!   - 阻塞在 `spawn_blocking` 里，不占异步运行时
//!   - 多线程并行读文件
//!   - 内存占用可控（一个文件读完就丢）
//!
//! ## 验收指标
//!
//! 打开 1000 个文件的目录，搜索响应 < 200ms（见 `docs/plan.md` M3）。
//! 达不到时先量，别凭直觉优化。

use regex::{Regex, RegexBuilder};
use serde::Serialize;
use std::path::Path;
use std::time::Instant;
use walkdir::WalkDir;

/// 一次搜索的结果上限。
///
/// 不是为了「跑得快」，而是为了**可用**：搜一个常见词（"的"）能出几万条，
/// 列表根本没法看，而且会把界面卡住。超限时如实告诉调用方被截断了。
const MAX_HITS: usize = 500;

/// 参与搜索的文件数上限（防止误搜到 `/` 之类的根目录）
const MAX_FILES: usize = 20_000;

/// 单个文件大小上限：超过的跳过。
///
/// 5 MB 的 .md 基本是误放进去的数据库导出，
/// 正则扫它既慢又会出几十万条结果。
const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;

/// 一处命中
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    /// 文件绝对路径
    pub path: String,
    /// 行号，1 起
    pub line: u32,
    /// 命中起始列，1 起（按字符算，不是字节）
    pub column: u32,
    /// 命中的那一行（去掉行尾 \r）
    pub text: String,
    /// 命中的那段文字
    pub match_text: String,
}

/// 一次搜索的完整结果
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub hits: Vec<SearchHit>,
    /// 实际扫了多少个文件
    pub scanned_files: usize,
    /// 命中数被截断了吗（达到 MAX_HITS）
    pub truncated: bool,
    /// 耗时（毫秒）
    pub elapsed_ms: u64,
}

/// 在 `root` 下递归查找 `query`。
///
/// `query` 为空时直接返回空结果——那不是「搜索全部」，那是用户还没输完。
#[tauri::command]
pub async fn search_files(
    root: String,
    query: String,
    regex: bool,
    case_sensitive: bool,
) -> Result<SearchResult, String> {
    if query.trim().is_empty() {
        return Ok(SearchResult {
            hits: Vec::new(),
            scanned_files: 0,
            truncated: false,
            elapsed_ms: 0,
        });
    }

    // 编译放在阻塞线程外：正则编译失败是**用户输入错误**，
    // 要尽快报错，而不是先把目录扫一遍才发现
    let matcher = build_matcher(&query, regex, case_sensitive)?;

    tokio::task::spawn_blocking(move || search_blocking(&root, &matcher))
        .await
        .map_err(|e| format!("搜索任务失败: {e}"))?
}

/// 把查询编译成匹配器。
///
/// 普通文本也走 regex：把字面量转义后加上 `case_insensitive`。
/// 这样只有一条匹配路径，列号计算、命中片段提取都只有一份实现——
/// 而「大小写不敏感」用 `to_lowercase()` 手写会每行分配一个字符串。
fn build_matcher(query: &str, regex: bool, case_sensitive: bool) -> Result<Regex, String> {
    let pattern = if regex {
        query.to_string()
    } else {
        regex::escape(query)
    };
    RegexBuilder::new(&pattern)
        .case_insensitive(!case_sensitive)
        .build()
        .map_err(|e| format!("正则表达式无效: {e}"))
}

/// 列出 `root` 下的所有笔记文件（扁平路径列表）。
///
/// 给「快速打开」用：文件树是**按需展开**的，只存了展开过的目录，
/// 所以拿不到全量文件列表；这里一次性给出全部路径。
///
/// 排序按「文件名自然序 + 路径」：用户找文件是按**名字**找的，
/// 而同名文件（不同目录）再按路径排，保证顺序是确定的。
#[tauri::command]
pub async fn list_all_files(root: String) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || {
        let root_path = Path::new(&root);
        if !root_path.is_dir() {
            return Err(format!("路径不是目录或不存在: {root}"));
        }
        let mut files = collect_files(&root);
        files.sort_by(|a, b| {
            let na = a.file_name().unwrap_or_default().to_string_lossy();
            let nb = b.file_name().unwrap_or_default().to_string_lossy();
            crate::fs::natural_cmp(&na, &nb).then_with(|| a.cmp(b))
        });
        Ok(files
            .into_iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect())
    })
    .await
    .map_err(|e| format!("列目录失败: {e}"))?
}

/// 阻塞部分：遍历目录 → 读文件 → 逐行匹配
fn search_blocking(root: &str, matcher: &Regex) -> Result<SearchResult, String> {
    let started = Instant::now();

    // 目录不存在要报错，不能当成「搜到 0 条」——
    // 后者会被界面显示成「没有匹配项」，和「路径打错了」完全不是一回事
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        return Err(format!("搜索路径不是目录或不存在: {root}"));
    }

    let files = collect_files(root);
    let scanned = files.len();
    let hits = search_files_parallel(&files, matcher);

    Ok(SearchResult {
        truncated: hits.len() >= MAX_HITS,
        hits: hits.into_iter().take(MAX_HITS).collect(),
        scanned_files: scanned,
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}

/// 收集目录下所有「算笔记」的文件。
///
/// 用 `fs::should_show` 判文件和目录——和文件树用的是同一套规则。
/// 两处各写一份过滤，迟早会不一致（文件树里能打开、搜索却搜不到）。
fn collect_files(root: &str) -> Vec<std::path::PathBuf> {
    let mut files = Vec::new();
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            // 目录要按同一套规则过滤：`.git` / `node_modules` 之类直接剪掉，
            // 不进目录就省掉了整棵子树的遍历
            let name = e.file_name().to_string_lossy();
            if e.file_type().is_dir() {
                return !name.starts_with('.') && name != "node_modules";
            }
            true
        })
        .flatten()
    {
        if files.len() >= MAX_FILES {
            break;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let Some(name) = entry.file_name().to_str() else {
            continue; // 非 UTF-8 文件名
        };
        let is_dir = false;
        if !crate::fs::should_show(name, is_dir) {
            continue;
        }
        if entry.metadata().map(|m| m.len()).unwrap_or(u64::MAX) > MAX_FILE_BYTES {
            continue;
        }
        files.push(entry.into_path());
    }
    files
}

/// 多线程并行搜索。
///
/// 用标准库的 `std::thread::scope`，不引 rayon：
/// rayon 不在 lockfile 里，引入就得多下依赖，
/// 而这里只需要「把文件列表切片分给几个线程」这一件事。
fn search_files_parallel(files: &[std::path::PathBuf], matcher: &Regex) -> Vec<SearchHit> {
    if files.is_empty() {
        return Vec::new();
    }
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1)
        .min(files.len())
        .max(1);

    let chunk_size = files.len().div_ceil(threads);
    let mut collected: Vec<SearchHit> = Vec::new();

    std::thread::scope(|scope| {
        let mut handles = Vec::new();
        for chunk in files.chunks(chunk_size) {
            handles.push(scope.spawn(move || {
                let mut local = Vec::new();
                for path in chunk {
                    if let Some(hits) = search_one_file(path, matcher) {
                        local.extend(hits);
                    }
                }
                local
            }));
        }
        for handle in handles {
            if let Ok(mut hits) = handle.join() {
                collected.append(&mut hits);
            }
        }
    });

    // 结果按「路径 → 行号」排一下，否则多线程出来的顺序是随机的，
    // 用户每次搜索看到的列表顺序都不一样
    collected.sort_by(|a, b| {
        a.path
            .cmp(&b.path)
            .then_with(|| a.line.cmp(&b.line))
            .then_with(|| a.column.cmp(&b.column))
    });
    collected
}

/// 搜一个文件；读不了（非 UTF-8 / 不是文件）就当没有命中
fn search_one_file(path: &Path, matcher: &Regex) -> Option<Vec<SearchHit>> {
    let content = std::fs::read(path).ok()?;
    let content = String::from_utf8(content).ok()?;
    let mut hits = Vec::new();
    for (index, line) in content.lines().enumerate() {
        let Some(m) = matcher.find(line) else {
            continue;
        };
        hits.push(SearchHit {
            path: path.to_string_lossy().into_owned(),
            line: (index + 1) as u32,
            // 字节偏移 → 字符列号。中日韩文字符占多个字节，
            // 直接用字节偏移会让列号偏得离谱
            column: line[..m.start()].chars().count() as u32 + 1,
            text: line.trim_end_matches('\r').to_string(),
            match_text: m.as_str().to_string(),
        });
        if hits.len() >= MAX_HITS {
            break;
        }
    }
    Some(hits)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    /// 在 Tauri 自带的异步运行时里跑一段 async 测试代码。
    ///
    /// 不用 `#[tokio::test]`：那要额外开 `macros` + `rt` 特性，
    /// 会带进 `tokio-macros` / `syn` / `quote` 几个依赖，
    /// 而 Tauri 自己已经带了一个运行时——**用它才是应用真正跑代码的那个**。
    fn block_on<F: std::future::Future<Output = ()>>(f: F) {
        tauri::async_runtime::block_on(f);
    }

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "inkstone-search-{tag}-{}-{nanos}",
            std::process::id()
        ))
    }

    fn write(dir: &Path, rel: &str, content: &str) {
        let path = dir.join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, content).unwrap();
    }

    #[test]
    fn 普通文本搜索是大小写不敏感的() {
        let m = build_matcher("Hello", false, false).unwrap();
        assert!(m.is_match("say hello"));
        assert!(m.is_match("HELLO"));
    }

    #[test]
    fn 区分大小写时只匹配合写法() {
        let m = build_matcher("Hello", false, true).unwrap();
        assert!(m.is_match("Hello"));
        assert!(!m.is_match("hello"));
    }

    #[test]
    fn 正则模式下元字符有效() {
        let m = build_matcher(r"^#\s+标题", true, false).unwrap();
        assert!(m.is_match("# 标题"));
        assert!(!m.is_match("正文 # 标题"));
    }

    #[test]
    fn 普通文本模式把元字符当字面量() {
        let m = build_matcher("a.c", false, false).unwrap();
        assert!(m.is_match("xa.cx"));
        assert!(!m.is_match("abc"));
    }

    #[test]
    fn 正则写错时报错而不是静默返回空() {
        // 静默返回空会让用户以为「文件里没有这个词」，
        // 而真相是「你写的正则我读不懂」
        let err = build_matcher("(unclosed", true, false).unwrap_err();
        assert!(err.contains("正则表达式无效"), "实际: {err}");
    }

    #[test]
    fn 搜到正确的行号和列号() {
        let dir = temp_dir("basic");
        write(&dir, "a.md", "第一行\n第二行 hello 世界\n第三行\n");
        let matcher = build_matcher("hello", false, false).unwrap();
        let hits = search_one_file(&dir.join("a.md"), &matcher).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].line, 2);
        // 「hello」前面是「第二行 」= 4 个字符，所以列号是 5
        assert_eq!(hits[0].column, 5);
        assert_eq!(hits[0].match_text, "hello");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn 中文按字符算列号而不是字节() {
        let dir = temp_dir("cjk");
        write(&dir, "a.md", "前面三个中文字\n命中\n");
        let matcher = build_matcher("命中", false, false).unwrap();
        let hits = search_one_file(&dir.join("a.md"), &matcher).unwrap();
        assert_eq!(hits[0].line, 2);
        assert_eq!(hits[0].column, 1);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn 只搜_markdown_文件且跳过隐藏目录() {
        let dir = temp_dir("filter");
        write(&dir, "笔记.md", "关键词");
        write(&dir, "图片.png", "关键词");
        write(&dir, ".隐藏/藏.md", "关键词");
        write(&dir, "子目录/深.md", "关键词");
        let files = collect_files(&dir.to_string_lossy());
        let names: Vec<String> = files
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert!(names.contains(&"笔记.md".to_string()));
        assert!(names.contains(&"深.md".to_string()));
        assert!(!names.contains(&"图片.png".to_string()));
        assert!(!names.contains(&"藏.md".to_string()));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn 搜不到的文件不报错() {
        let dir = temp_dir("missing");
        let matcher = build_matcher("x", false, false).unwrap();
        assert!(search_one_file(&dir.join("不存在.md"), &matcher).is_none());
    }

    #[test]
    fn 空查询返回空结果() {
        let dir = temp_dir("empty");
        std::fs::create_dir_all(&dir).unwrap();
        let result = search_blocking(
            &dir.to_string_lossy(),
            &build_matcher("x", false, false).unwrap(),
        )
        .unwrap();
        assert!(result.hits.is_empty());
        assert_eq!(result.scanned_files, 0);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn 结果按路径和行号排序() {
        let dir = temp_dir("sort");
        write(&dir, "b.md", "hit\nhit\n");
        write(&dir, "a.md", "hit\n");
        let matcher = build_matcher("hit", false, false).unwrap();
        let files = collect_files(&dir.to_string_lossy());
        let hits = search_files_parallel(&files, &matcher);
        assert_eq!(hits.len(), 3);
        assert!(hits[0].path.ends_with("a.md"));
        assert!(hits[1].path.ends_with("b.md"));
        assert_eq!(hits[1].line, 1);
        assert_eq!(hits[2].line, 2);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn 目录不存在时报错而不是返回空() {
        let err = search_blocking(
            "/根本不存在/inkstone",
            &build_matcher("x", false, false).unwrap(),
        )
        .unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn 列出全部文件且按文件名自然序() {
        block_on(async {
            let dir = temp_dir("all");
            write(&dir, "b.md", "x");
            write(&dir, "图 10.md", "x");
            write(&dir, "图 2.md", "x");
            write(&dir, "子/a.md", "x");
            write(&dir, "子/b.txt", "x");
            let files = list_all_files(dir.to_string_lossy().into_owned())
                .await
                .unwrap();
            let names: Vec<String> = files
                .iter()
                .map(|p| p.rsplit('/').next().unwrap().to_string())
                .collect();
            // 「图 2」要在「图 10」前面
            let i2 = names.iter().position(|n| n == "图 2.md").unwrap();
            let i10 = names.iter().position(|n| n == "图 10.md").unwrap();
            assert!(i2 < i10, "顺序不对: {names:?}");
            // 非 Markdown 不该出现
            assert!(!names.contains(&"b.txt".to_string()));
            // 递归子目录
            assert!(names.contains(&"a.md".to_string()));
            std::fs::remove_dir_all(&dir).ok();
        });
    }

    #[test]
    fn 列出全部文件时目录不存在要报错() {
        block_on(async {
            assert!(list_all_files("/根本不存在/inkstone".into()).await.is_err());
        });
    }

    /// 验收基准：`docs/plan.md` M3 要求「打开 1000 个文件的目录，搜索响应 < 200ms」。
    ///
    /// 默认**不跑**（`#[ignore]`）——它要真的造 1000 个文件、占磁盘、耗时间，
    /// 放进常规 CI 闸门不合适。需要时显式执行：
    ///
    /// ```sh
    /// cargo test --lib --offline -- --ignored --nocapture
    /// ```
    #[test]
    #[ignore = "性能基准：需显式执行"]
    fn 千个文件的搜索耗时() {
        let dir = temp_dir("bench");
        let content = (0..40)
            .map(|i| format!("第 {i} 行：一些普通的中文内容，用来把文件撑到像样"))
            .collect::<Vec<_>>()
            .join("\n");
        for i in 0..1000 {
            let sub = dir.join(format!("d{}", i / 50));
            std::fs::create_dir_all(&sub).unwrap();
            std::fs::write(sub.join(format!("f{i}.md")), &content).unwrap();
        }
        // 目标词出现在一个单独的文件里
        std::fs::write(dir.join("d0").join("hit.md"), "命中一次\n").unwrap();

        let matcher = build_matcher("命中", false, false).unwrap();
        let started = Instant::now();
        let result = search_blocking(&dir.to_string_lossy(), &matcher).unwrap();
        let elapsed = started.elapsed();

        println!(
            "扫了 {} 个文件，{} 条命中，耗时 {:.1} ms",
            result.scanned_files,
            result.hits.len(),
            elapsed.as_secs_f64() * 1000.0
        );
        assert!(
            elapsed.as_millis() < 200,
            "超过 200ms 预算：实际 {:.1} ms",
            elapsed.as_secs_f64() * 1000.0
        );
        std::fs::remove_dir_all(&dir).ok();
    }
}

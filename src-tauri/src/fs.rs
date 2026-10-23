//! 目录浏览：给侧边栏的文件树提供「列一层」的能力。
//!
//! ## 为什么只列**一层**，不递归
//!
//! 文件树是**按需展开**的：用户点开哪个目录才读哪个。
//! 递归的话，打开一个 1000 个文件的目录会一次性读完整棵树，
//! 既慢又把用户并不关心的内容全塞进内存。
//!
//! ## 过滤规则
//!
//! 这是个 Markdown 编辑器，文件树里只该出现**能打开的东西**：
//! 子目录 + `.md` / `.markdown`。
//!
//! 顺带被挡掉的还有：
//!   - 以 `.` 开头的项（`.git`、`.obsidian`、`.DS_Store`……）——
//!     它们不是笔记，出现在文件树里只会添乱
//!   - 非 UTF-8 的文件名——显示不出来就没法用
//!
//! 规则写在这里而不是散在调用方，是为了让它可测：`should_show` 是纯函数。

use serde::Serialize;
use std::cmp::Ordering;
use std::path::Path;
use tokio::fs;

/// 目录里的一个条目
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    /// 文件名（不含路径），用于显示
    pub name: String,
    /// 绝对路径，点击时直接打开
    pub path: String,
    /// 是不是目录（决定能否展开）
    pub is_dir: bool,
}

/// Markdown 扩展名（小写比较）
const MARKDOWN_EXTS: [&str; 2] = ["md", "markdown"];

/// 这个条目要不要出现在文件树里。
///
/// 纯函数：文件名 + 是否目录，规则全在这里，可直接测。
pub(crate) fn should_show(file_name: &str, is_dir: bool) -> bool {
    if file_name.is_empty() || file_name.starts_with('.') {
        return false;
    }
    // 目录一律要：编辑器不该替用户决定「这个文件夹里没有 .md 所以不给你看」
    if is_dir {
        return true;
    }
    // 取**最后一个**点之后的扩展名：`a.b.c.md` 的扩展名是 `md`
    match file_name.rsplit_once('.') {
        Some((_, ext)) => MARKDOWN_EXTS.contains(&ext.to_lowercase().as_str()),
        // 没有扩展名（如 `Makefile`）：不是 Markdown 文件
        None => false,
    }
}

/// 从迭代器头部取走一整段 ASCII 数字，返回**原始**字符串（保留前导零）。
fn take_digits(chars: &mut std::iter::Peekable<std::str::Chars<'_>>) -> String {
    std::iter::from_fn(|| chars.next_if(char::is_ascii_digit)).collect()
}

/// 去掉前导零，全是零或为空时给 `"0"`。
///
/// 去前导零而不是 `parse::<u128>()` 是有意的：
/// 一是位数再长也不会溢出（文件名叫 `9` 重复 500 位并不罕见于批量导出），
/// 二是结果还能拿去做字典序比较，等价于按数值比。
fn trim_zeros(digits: &str) -> &str {
    let trimmed = digits.trim_start_matches('0');
    if trimmed.is_empty() {
        "0"
    } else {
        trimmed
    }
}

/// 自然序比较（数字感知）：`图 2` 排在 `图 10` 前面。
///
/// 按字符串排会得到 `图 10` 在前——笔记多了之后这个错位很难受，
/// 而它恰好是最容易被用户察觉的那种「排序不对」。
///
/// 中文按 Unicode 码点比（不做拼音）：拼音表太大、维护成本高，
/// 而用户找文件主要靠文件名本身（`需求`、`会议`），码点序已足够稳定可预期。
fn natural_cmp(a: &str, b: &str) -> Ordering {
    let mut ai = a.chars().peekable();
    let mut bi = b.chars().peekable();
    loop {
        let (x, y) = match (ai.peek().copied(), bi.peek().copied()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(x), Some(y)) => (x, y),
        };

        if x.is_ascii_digit() && y.is_ascii_digit() {
            let da = take_digits(&mut ai);
            let db = take_digits(&mut bi);
            let ta = trim_zeros(&da);
            let tb = trim_zeros(&db);
            let by_value = ta.len().cmp(&tb.len()).then_with(|| ta.cmp(tb));
            if by_value != Ordering::Equal {
                return by_value;
            }
            // 数值相同但写法不同（`01` vs `1`）：按原始位数定先后。
            // 必须返回而不是继续——这一段已经能分出高下，
            // 而不分出高下的话排序会退化成「保持原序」，
            // 用户重命名一下文件位置就乱跳。
            if da.len() != db.len() {
                return da.len().cmp(&db.len());
            }
            // 两段写法完全一致（`a1b` vs `a1c`）：**继续往下比后面的字符**。
            // 这里返回是早期版本的 bug：会让 `a1b` 和 `a1c` 比成相等。
            continue;
        }

        match x.cmp(&y) {
            Ordering::Equal => {
                ai.next();
                bi.next();
            }
            other => return other,
        }
    }
}

/// 排完序再返回：目录在前，其余按自然序
fn sort_entries(mut entries: Vec<DirEntry>) -> Vec<DirEntry> {
    entries.sort_by(|a, b| {
        // `true` 排在 `false` 前，即目录在前
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| natural_cmp(&a.name, &b.name))
    });
    entries
}

/// 列出一个目录的内容。
///
/// 读不到目录时返回错误字符串——前端据此显示「打不开」而不是「空目录」，
/// 两者对用户的含义完全不同。
#[tauri::command]
pub async fn list_directory(path: String) -> Result<Vec<DirEntry>, String> {
    let mut dir = fs::read_dir(&path)
        .await
        .map_err(|e| format!("读取目录失败 ({path}): {e}"))?;

    let mut entries: Vec<DirEntry> = Vec::new();
    while let Some(item) = dir.next_entry().await.map_err(|e| e.to_string())? {
        let name = item.file_name();
        let Some(file_name) = name.to_str() else {
            // 非 UTF-8 文件名：显示不出来，也开不了，跳过
            continue;
        };
        // `file_type()` 对符号链接会失败或不走目标，这里按「取不到就算文件」处理，
        // 避免一个坏链接让整个目录列不出来。
        let is_dir = item.file_type().await.map(|t| t.is_dir()).unwrap_or(false);
        if !should_show(file_name, is_dir) {
            continue;
        }
        entries.push(DirEntry {
            name: file_name.to_string(),
            path: item.path().to_string_lossy().into_owned(),
            is_dir,
        });
    }

    Ok(sort_entries(entries))
}

/// 取一个文件所在的目录。
///
/// 前端用它把文件树的根设成「当前文档所在目录」——
/// 直接用字符串切 `/` 在 macOS 上会把路径弄坏（`/Users/...` 切出空串），
/// 而路径分隔规则属于系统，不该在前端重写一遍。
#[tauri::command]
pub fn parent_of(path: String) -> Option<String> {
    Path::new(&path)
        .parent()
        .map(|p| p.to_string_lossy().into_owned())
        .filter(|p| !p.is_empty())
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

    fn mk(name: &str, is_dir: bool) -> DirEntry {
        DirEntry {
            name: name.into(),
            path: format!("/x/{name}"),
            is_dir,
        }
    }

    /// 造一个当前进程专属的临时目录名
    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("inkstone-{tag}-{}-{nanos}", std::process::id()))
    }

    #[test]
    fn markdown_文件要显示() {
        assert!(should_show("笔记.md", false));
        assert!(should_show("笔记.markdown", false));
        assert!(should_show("NOTES.MD", false)); // 大小写不敏感
        assert!(should_show("笔记.MarkDown", false));
        assert!(should_show("a.b.c.md", false)); // 只看最后一段扩展名
    }

    #[test]
    fn 非_markdown_文件不显示() {
        assert!(!should_show("图.png", false));
        assert!(!should_show("a.txt", false));
        assert!(!should_show("Cargo.toml", false));
        assert!(!should_show("Makefile", false)); // 没有扩展名
        assert!(!should_show("md", false)); // 「md」本身不是扩展名
        assert!(!should_show(".md", false)); // 隐藏项优先
        assert!(!should_show("", false));
    }

    #[test]
    fn 隐藏项一律不显示() {
        assert!(!should_show(".DS_Store", false));
        assert!(!should_show(".gitignore", false));
        // 目录也一样——`.git` / `.obsidian` 出现在文件树里只会添乱
        assert!(!should_show(".git", true));
        assert!(!should_show(".obsidian", true));
        assert!(should_show("笔记", true));
    }

    #[test]
    fn 目录一律显示() {
        assert!(should_show("子目录", true));
        assert!(should_show("assets", true)); // 里面全是图片，但目录本身要看得到
    }

    #[test]
    fn 自然序把_2_排在_10_前面() {
        assert_eq!(natural_cmp("图 2", "图 10"), Ordering::Less);
        assert_eq!(natural_cmp("img9.png", "img10.png"), Ordering::Less);
        assert_eq!(natural_cmp("章节 9 节", "章节 10 节"), Ordering::Less);
        assert_eq!(natural_cmp("a", "a"), Ordering::Equal);
        assert_eq!(natural_cmp("a", "b"), Ordering::Less);
        assert_eq!(natural_cmp("b", "a"), Ordering::Greater);
    }

    #[test]
    fn 自然序数字两侧夹杂文本() {
        // 数字段之后还有普通字符，必须继续往下比，不能在数字处就收尾
        assert_eq!(natural_cmp("第2章.md", "第10章.md"), Ordering::Less);
        assert_eq!(natural_cmp("v2final", "v2final"), Ordering::Equal);
        assert_eq!(natural_cmp("a1b", "a1c"), Ordering::Less);
    }

    #[test]
    fn 自然序对超长数字也不会溢出() {
        // 500 位数字：任何 `parse::<u128>()` 都会溢出回退，
        // 那样 `999…9` 和 `999…8` 就会比成「相等」，排序彻底乱掉
        let a = "9".repeat(500);
        let b = format!("{}8", "9".repeat(499));
        assert_eq!(natural_cmp(&a, &b), Ordering::Greater);
        assert_eq!(natural_cmp(&b, &a), Ordering::Less);
        // 位数悬殊：位数优先于字典序，和数值一致
        assert_eq!(natural_cmp(&a, "1"), Ordering::Greater);
        // 数字段之后还有后缀，也要正确
        assert_eq!(
            natural_cmp(&format!("{a}x"), &format!("{b}x")),
            Ordering::Greater
        );
    }

    #[test]
    fn 自然序数值相同时仍给出确定次序() {
        // `01` 和 `1` 数值相同，但必须分出先后，
        // 否则排序会退化成「保持原序」，用户重命名后位置就乱跳
        assert_eq!(natural_cmp("a01", "a1"), Ordering::Greater);
        assert_eq!(natural_cmp("a1", "a01"), Ordering::Less);
        assert_eq!(natural_cmp("v001.md", "v0002.md"), Ordering::Less);
    }

    #[test]
    fn 自然序对中文按码点比且稳定() {
        let a = natural_cmp("阿", "波");
        let b = natural_cmp("波", "阿");
        assert_eq!(a, b.reverse());
        // 整批排序不能 panic，也不能出现互相「小于」
        let mut names = vec!["需求", "会议", "周报 10", "周报 2", "需求池"];
        names.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(names, vec!["会议", "周报 2", "周报 10", "需求", "需求池"]);
    }

    #[test]
    fn 排序时目录在前() {
        let sorted = sort_entries(vec![
            mk("b.md", false),
            mk("子目录", true),
            mk("a.md", false),
            mk("目录甲", true),
        ]);
        assert_eq!(
            sorted.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(),
            vec!["子目录", "目录甲", "a.md", "b.md"]
        );
    }

    #[test]
    fn 列出真实目录并按规则过滤() {
        block_on(async {
            let dir = temp_dir("fs");
            fs::create_dir_all(dir.join("子目录")).await.unwrap();
            fs::create_dir_all(dir.join(".隐藏目录")).await.unwrap();
            fs::write(dir.join("一.md"), "x").await.unwrap();
            fs::write(dir.join("二.markdown"), "x").await.unwrap();
            fs::write(dir.join("三.txt"), "x").await.unwrap();
            fs::write(dir.join(".隐藏.md"), "x").await.unwrap();
            fs::write(dir.join("无扩展名"), "x").await.unwrap();

            let entries = list_directory(dir.to_string_lossy().into_owned())
                .await
                .unwrap();
            let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();

            assert!(names.contains(&"一.md"));
            assert!(names.contains(&"二.markdown"));
            assert!(names.contains(&"子目录"));
            assert!(!names.contains(&"三.txt"));
            assert!(!names.contains(&".隐藏.md"));
            assert!(!names.contains(&".隐藏目录"));
            assert!(!names.contains(&"无扩展名"));

            // 目录在前，且子目录的 path 拼得对（前端要靠它展开）
            assert!(entries[0].is_dir);
            assert_eq!(entries[0].path, dir.join("子目录").to_string_lossy());

            fs::remove_dir_all(&dir).await.ok();
        });
    }

    #[test]
    fn 空目录返回空列表而不是错误() {
        block_on(async {
            // 空目录和打不开是两回事：前者是正常状态，要显示「空」
            let dir = temp_dir("empty");
            fs::create_dir_all(&dir).await.unwrap();
            let entries = list_directory(dir.to_string_lossy().into_owned())
                .await
                .unwrap();
            assert!(entries.is_empty());
            fs::remove_dir_all(&dir).await.ok();
        });
    }

    #[test]
    fn 目录不存在时给错误而不是空列表() {
        block_on(async {
            // 空列表会被前端显示成「这个文件夹是空的」，
            // 而实际情况是打不开——两者对用户的含义完全不同。
            let result = list_directory("/definitely/not/here/inkstone".into()).await;
            assert!(result.is_err());
            let msg = result.unwrap_err();
            assert!(
                msg.contains("/definitely/not/here/inkstone"),
                "错误信息要带上路径: {msg}"
            );
        });
    }

    #[test]
    fn 传文件路径时报错而不是列空() {
        block_on(async {
            let dir = temp_dir("file");
            fs::create_dir_all(&dir).await.unwrap();
            let file = dir.join("一.md");
            fs::write(&file, "x").await.unwrap();
            let result = list_directory(file.to_string_lossy().into_owned()).await;
            assert!(result.is_err());
            fs::remove_dir_all(&dir).await.ok();
        });
    }

    #[test]
    fn 取父目录() {
        assert_eq!(
            parent_of("/Users/me/笔记/a.md".into()),
            Some("/Users/me/笔记".to_string())
        );
        // 相对路径且不含目录部分：没有父目录
        assert_eq!(parent_of("a.md".into()), None);
        // 根目录确实是 `/a.md` 的父目录，这里如实返回 `/`。
        // 「拿根目录当文件树的根会不会太宽」是**前端该决定的事**，
        // 后端在这里撒谎（返回 None）只会让上层拿到一个假的目录。
        assert_eq!(parent_of("/a.md".into()), Some("/".to_string()));
    }
}

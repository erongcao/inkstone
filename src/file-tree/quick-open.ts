/**
 * 快速打开：按文件名模糊匹配整个笔记库。
 *
 * ## 为什么不能靠文件树
 *
 * 文件树是**按需展开**的，store 里只有展开过的目录，
 * 拿不到全量文件列表。所以这里单独走 `list_all_files` 拿一份扁平列表，
 * 并**缓存**起来——用户连续按 ⌘P 时不必每次都重扫磁盘。
 *
 * 缓存的失效时机：树根变了、或者用户手动刷新了树。
 */

import { listAllFiles } from "@/ipc/fs";
import { fuzzyScore } from "@/editor/commands";

export interface VaultFile {
  /** 绝对路径 */
  path: string;
  /** 文件名（不含目录） */
  name: string;
  /** 所在目录（用于在结果里显示位置） */
  dir: string;
}

interface CacheEntry {
  root: string;
  files: VaultFile[];
}

let cache: CacheEntry | null = null;
let pending: Promise<VaultFile[]> | null = null;

/** 清空缓存（树根变了 / 用户刷新了树时调用） */
export function invalidateVaultFiles(): void {
  cache = null;
  pending = null;
}

/**
 * 取笔记库的全部文件。
 *
 * 并发调用共享同一个请求：用户连按 ⌘P 三次，
 * 不该触发三次磁盘扫描。
 */
export async function loadVaultFiles(root: string): Promise<VaultFile[]> {
  if (cache && cache.root === root) return cache.files;
  if (pending) return pending;

  pending = (async () => {
    const paths = await listAllFiles(root);
    const files = paths.map((path) => {
      const slash = path.lastIndexOf("/");
      return {
        path,
        name: slash >= 0 ? path.slice(slash + 1) : path,
        dir: slash >= 0 ? path.slice(0, slash) : "",
      };
    });
    cache = { root, files };
    pending = null;
    return files;
  })();
  return pending;
}

export interface FileMatch {
  file: VaultFile;
  /** 命中字符在文件名里的下标，用于高亮 */
  matched: number[];
}

/**
 * 按文件名模糊匹配。
 *
 * 匹配**文件名**而不是完整路径：用户记的是「需求.md」，
 * 不是「01 进行中/需求.md」。路径只作为并列时的次级排序键。
 */
export function matchVaultFiles(
  files: readonly VaultFile[],
  query: string,
  limit = 50,
): FileMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return files.slice(0, limit).map((file) => ({ file, matched: [] }));
  }

  const scored: (FileMatch & { score: number })[] = [];
  for (const file of files) {
    const hit = fuzzyScore(file.name.toLowerCase(), q);
    if (hit) {
      scored.push({ file, matched: hit.matched, score: hit.score });
      continue;
    }
    // 文件名没命中时再拿目录试一遍：
    // 用户输入「归档」时，「02 归档/开篇.md」也该能被找到
    const dirHit = fuzzyScore(file.dir.toLowerCase(), q);
    if (dirHit) {
      scored.push({ file, matched: [], score: dirHit.score + 500 });
    }
  }

  scored.sort(
    (a, b) =>
      a.score - b.score ||
      a.file.name.length - b.file.name.length ||
      a.file.path.localeCompare(b.file.path),
  );
  return scored.slice(0, limit).map(({ file, matched }) => ({ file, matched }));
}

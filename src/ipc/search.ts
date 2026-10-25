/**
 * 全局搜索的 IPC 绑定。
 *
 * 真正的搜索在 Rust 侧（`src-tauri/src/search.rs`）——要读上千个文件，
 * 放前端会卡住渲染进程。这里只做类型声明和传输。
 *
 * 浏览器降级模式在样例库的内容里搜，行为与 Rust 侧一致
 * （同样的正则 / 大小写规则、同样的列号算法）。
 */

import { SAMPLE_CONTENTS, SAMPLE_ROOT } from "@/ipc/fs";
import { t } from "@/i18n";

/** 一处命中（与 Rust 侧 `SearchHit` 一一对应） */
export interface SearchHit {
  /** 文件绝对路径 */
  path: string;
  /** 行号，1 起 */
  line: number;
  /** 命中起始列，1 起（按字符算） */
  column: number;
  /** 命中的那一行 */
  text: string;
  /** 命中的那段文字 */
  matchText: string;
}

/** 一次搜索的完整结果 */
export interface SearchResult {
  hits: SearchHit[];
  /** 实际扫了多少个文件 */
  scannedFiles: number;
  /** 命中数被截断了吗 */
  truncated: boolean;
  /** 耗时（毫秒） */
  elapsedMs: number;
}

export interface SearchOptions {
  /** 按正则解释查询词 */
  regex?: boolean;
  /** 区分大小写（默认不区分） */
  caseSensitive?: boolean;
}

type Backend = {
  search(root: string, query: string, options: SearchOptions): Promise<SearchResult>;
};

const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/* ── 浏览器降级：在样例库的内容里搜 ── */

/** 样例库里属于 root 的文件（按路径前缀判断） */
function sampleFilesUnder(root: string): [string, string][] {
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return Object.entries(SAMPLE_CONTENTS)
    .filter(([path]) => path.startsWith(prefix))
    .map(([path, content]) => [path, content]);
}

/**
 * 把查询编成匹配器。
 *
 * 和 Rust 侧一样：普通文本当**字面量**（要转义），
 * 否则用户搜 `a.c` 会意外命中 `abc`。
 */
function buildMatcher(
  query: string,
  regex: boolean,
  caseSensitive: boolean,
): RegExp | null {
  const pattern = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    return new RegExp(pattern, caseSensitive ? "g" : "gi");
  } catch {
    // 正则写错：返回 null，调用方负责给出错误提示
    return null;
  }
}

const browserBackend: Backend = {
  async search(root, query, options) {
    const started = Date.now();
    const matcher = buildMatcher(
      query,
      options.regex ?? false,
      options.caseSensitive ?? false,
    );
    if (!matcher) {
      throw new Error(t("正则表达式无效"));
    }
    const files = sampleFilesUnder(root);
    const hits: SearchHit[] = [];
    for (const [path, content] of files) {
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // 每次匹配都要重置 lastIndex（正则带 g 标志）
        matcher.lastIndex = 0;
        const m = matcher.exec(line);
        if (!m) continue;
        hits.push({
          path,
          line: i + 1,
          // 列号按**字符**算：中文一个字占一个列，不能用字节/UTF-16 长度
          column: Array.from(line.slice(0, m.index)).length + 1,
          text: line,
          matchText: m[0],
        });
      }
    }
    // 排序必须和 Rust 侧 `search_files_parallel` 一致：
    // 那里是 `path.cmp()`（字节序 = 码点序），不是本地化排序。
    // 用 `localeCompare` 会把「01 进行中」「02 归档」按本地化规则重排，
    // 于是浏览器里看到的顺序和真实后端不一样——
    // 而浏览器是拿来看真实行为的，顺序对不上就失去意义了。
    hits.sort((a, b) => {
      if (a.path !== b.path) return a.path < b.path ? -1 : 1;
      return a.line - b.line || a.column - b.column;
    });
    return {
      hits: hits.slice(0, 500),
      scannedFiles: files.length,
      truncated: hits.length >= 500,
      elapsedMs: Date.now() - started,
    };
  },
};

const tauriBackend: Backend = {
  async search(root, query, options) {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<SearchResult>("search_files", {
      root,
      query,
      regex: options.regex ?? false,
      caseSensitive: options.caseSensitive ?? false,
    });
  },
};

function getBackend(): Backend {
  return isTauri() ? tauriBackend : browserBackend;
}

/**
 * 在 `root` 下递归搜索。
 *
 * 查询词为空时**不搜索**（返回空结果）——那是用户还没输完，
 * 不是「搜全部」。
 */
export function searchFiles(
  root: string,
  query: string,
  options: SearchOptions = {},
): Promise<SearchResult> {
  if (!query.trim()) {
    return Promise.resolve({ hits: [], scannedFiles: 0, truncated: false, elapsedMs: 0 });
  }
  return getBackend().search(root, query, options);
}

/** 浏览器降级模式下的搜索根 */
export const SAMPLE_SEARCH_ROOT = SAMPLE_ROOT;

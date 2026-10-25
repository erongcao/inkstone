/**
 * 目录浏览的 IPC 绑定。
 *
 * 后端命令在 `src-tauri/src/fs.rs`，那边才是路径与过滤 / 排序规则的真相源——
 * 这里只做类型声明和传输，**不重新实现任何规则**。
 *
 * ## 为什么要一份浏览器降级实现
 *
 * 大部分 UI 都要能在 `pnpm dev`（纯浏览器）里调，而浏览器没有文件系统。
 * 但文件树如果只有一句 `return []`，就没法在浏览器里点开、展开、看排版。
 * 所以这里内置一份**内存样例库**：内容是写死的开发夹具，
 * 展开/折叠/空目录/打不开的错误态都按真实规则走，
 * 这样浏览器里看到的行为和 Tauri 下一致。
 */

import { t } from "@/i18n";

/** 目录里的一个条目（与 Rust 侧 `DirEntry` 一一对应） */
export interface DirEntry {
  /** 文件名，不含路径 */
  name: string;
  /** 绝对路径 */
  path: string;
  /** 是不是目录 */
  isDir: boolean;
}

type Backend = {
  listDirectory(path: string): Promise<DirEntry[]>;
  listAllFiles(root: string): Promise<string[]>;
  parentOf(path: string): Promise<string | null>;
  pickFolder(): Promise<string | null>;
};

const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/* ── 浏览器降级：内存样例库 ── */

/** 开发夹具的虚拟根路径 */
export const SAMPLE_ROOT = "/样例笔记库";

const file = (path: string): DirEntry => ({
  name: path.slice(path.lastIndexOf("/") + 1),
  path,
  isDir: false,
});

const sub = (name: string): DirEntry => ({
  name,
  path: `${SAMPLE_ROOT}/${name}`,
  isDir: true,
});

/**
 * 目录路径 → 它的直接子项。
 *
 * 刻意收录几种真实笔记库里常见的形态，好在浏览器里肉眼验收排版与交互：
 * 数字编号（自然序 `周报 2` 应排在 `周报 10` 前）、中文名、空目录、
 * 大写扩展名（`.MARKDOWN` 要能打开）。
 *
 * 注意这里**不**放非 Markdown 文件——过滤发生在 Rust 侧，
 * 真实运行时它们根本不会出现在列表里，样例库不该造出后端不可能返回的结果。
 *
 * 顺序必须与 Rust 侧 `sort_entries` 一致（目录在前 + 自然序）：
 * 样例库是真实后端的替身，顺序对不上会让浏览器里的验收结论失真。
 */
const SAMPLE_DIRS: Record<string, DirEntry[]> = {
  [SAMPLE_ROOT]: [
    sub("01 进行中"),
    sub("02 归档"),
    sub("99 空目录"),
    file(`${SAMPLE_ROOT}/README.md`),
    file(`${SAMPLE_ROOT}/随手记.MARKDOWN`),
  ],
  [`${SAMPLE_ROOT}/01 进行中`]: [
    file(`${SAMPLE_ROOT}/01 进行中/周报 2.md`),
    file(`${SAMPLE_ROOT}/01 进行中/周报 10.md`),
    file(`${SAMPLE_ROOT}/01 进行中/需求池.md`),
    file(`${SAMPLE_ROOT}/01 进行中/需求.md`),
  ],
  [`${SAMPLE_ROOT}/02 归档`]: [
    file(`${SAMPLE_ROOT}/02 归档/2026-01-05 开篇.md`),
    file(`${SAMPLE_ROOT}/02 归档/2026-10-31 收束.md`),
  ],
  [`${SAMPLE_ROOT}/99 空目录`]: [],
};

/**
 * 样例文件的内容。
 *
 * 没有内容就没法在浏览器里验收搜索——搜索面板要显示行号、列号和高亮片段，
 * 光有文件名是不够的。
 */
export const SAMPLE_CONTENTS: Record<string, string> = {
  [`${SAMPLE_ROOT}/README.md`]: [
    "# 样例笔记库",
    "",
    "这是浏览器降级模式用的样例内容。",
    "搜索「样例」应该能命中这一行。",
    "",
    "TODO: later finish the README polish",
  ].join("\n"),
  [`${SAMPLE_ROOT}/随手记.MARKDOWN`]: [
    "# 随手记",
    "",
    "随手记一行。",
    "再记一行：需求 待确认。",
  ].join("\n"),
  [`${SAMPLE_ROOT}/01 进行中/周报 2.md`]: [
    "# 第 2 周周报",
    "",
    "## 进展",
    "- 完成了搜索面板",
    "- 需求梳理",
  ].join("\n"),
  [`${SAMPLE_ROOT}/01 进行中/周报 10.md`]: [
    "# 第 10 周周报",
    "",
    "## 进展",
    "- 需求评审通过",
  ].join("\n"),
  [`${SAMPLE_ROOT}/01 进行中/需求池.md`]: ["# 需求池", "", "待整理的需求列表。"].join(
    "\n",
  ),
  [`${SAMPLE_ROOT}/01 进行中/需求.md`]: [
    "# 需求",
    "",
    "需求描述在这里。",
    "验收标准：搜索能跳到命中的行。",
  ].join("\n"),
  [`${SAMPLE_ROOT}/02 归档/2026-01-05 开篇.md`]: ["# 开篇", "", "第一篇文章。"].join(
    "\n",
  ),
  [`${SAMPLE_ROOT}/02 归档/2026-10-31 收束.md`]: ["# 收束", "", "最后一篇文章。"].join(
    "\n",
  ),
};

const browserBackend: Backend = {
  async listDirectory(path) {
    const entries = SAMPLE_DIRS[path];
    if (!entries) {
      // 与后端一致：读不到要给错误，不能返回空数组
      throw new Error(t("读取目录失败 ({path}): 样例库里没有这个目录", { path }));
    }
    return entries;
  },
  async listAllFiles(root) {
    const prefix = root.endsWith("/") ? root : `${root}/`;
    return (
      Object.keys(SAMPLE_DIRS)
        .flatMap((dir) => SAMPLE_DIRS[dir])
        // 只要文件，**不要目录**——Rust 侧 `collect_files` 也只收文件，
        // 两边不一致的话，快速打开里会冒出「01 进行中」这种目录项
        .filter((entry) => !entry.isDir)
        .map((entry) => entry.path)
        .filter((path) => path.startsWith(prefix))
        .sort()
    );
  },
  async parentOf(path) {
    const index = path.lastIndexOf("/");
    return index > 0 ? path.slice(0, index) : null;
  },
  async pickFolder() {
    // 浏览器没有文件系统，「打开」直接选样例库。
    // 返回 null 的话这个按钮在浏览器里就是个死按钮，
    // 文件树也就永远没法在浏览器里验收。
    return SAMPLE_ROOT;
  },
};

const tauriBackend: Backend = {
  async listDirectory(path) {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<DirEntry[]>("list_directory", { path });
  },
  async listAllFiles(root) {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string[]>("list_all_files", { root });
  },
  async parentOf(path) {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string | null>("parent_of", { path });
  },
  async pickFolder() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({
      directory: true,
      multiple: false,
      title: t("选择笔记库"),
    });
    return typeof picked === "string" ? picked : null;
  },
};

function getBackend(): Backend {
  return isTauri() ? tauriBackend : browserBackend;
}

/** 列出一个目录的内容。读不到时 reject，**不返回空数组**。 */
export function listDirectory(path: string): Promise<DirEntry[]> {
  return getBackend().listDirectory(path);
}

/** 列出 root 下的全部笔记文件（扁平路径列表），给「快速打开」用 */
export function listAllFiles(root: string): Promise<string[]> {
  return getBackend().listAllFiles(root);
}

/** 取一个文件所在的目录；没有则 null */
export function parentOf(path: string): Promise<string | null> {
  return getBackend().parentOf(path);
}

/** 弹系统目录选择框；用户取消时返回 null */
export function pickFolder(): Promise<string | null> {
  return getBackend().pickFolder();
}

/** 路径是否在 `root` 之内（含 root 本身） */
export function isUnder(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

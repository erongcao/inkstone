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
 */
const SAMPLE_DIRS: Record<string, DirEntry[]> = {
  [SAMPLE_ROOT]: [
    sub("02 归档"),
    sub("01 进行中"),
    sub("99 空目录"),
    file(`${SAMPLE_ROOT}/README.md`),
    file(`${SAMPLE_ROOT}/随手记.MARKDOWN`),
  ],
  [`${SAMPLE_ROOT}/02 归档`]: [
    file(`${SAMPLE_ROOT}/02 归档/2026-01-05 开篇.md`),
    file(`${SAMPLE_ROOT}/02 归档/2026-10-31 收束.md`),
  ],
  [`${SAMPLE_ROOT}/01 进行中`]: [
    file(`${SAMPLE_ROOT}/01 进行中/周报 10.md`),
    file(`${SAMPLE_ROOT}/01 进行中/周报 2.md`),
    file(`${SAMPLE_ROOT}/01 进行中/需求池.md`),
    file(`${SAMPLE_ROOT}/01 进行中/需求.md`),
  ],
  [`${SAMPLE_ROOT}/99 空目录`]: [],
};

const browserBackend: Backend = {
  async listDirectory(path) {
    const entries = SAMPLE_DIRS[path];
    if (!entries) {
      // 与后端一致：读不到要给错误，不能返回空数组
      throw new Error(`读取目录失败 (${path}): 样例库里没有这个目录`);
    }
    return entries;
  },
  async parentOf(path) {
    const index = path.lastIndexOf("/");
    return index > 0 ? path.slice(0, index) : null;
  },
  async pickFolder() {
    return null;
  },
};

const tauriBackend: Backend = {
  async listDirectory(path) {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<DirEntry[]>("list_directory", { path });
  },
  async parentOf(path) {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string | null>("parent_of", { path });
  },
  async pickFolder() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ directory: true, multiple: false, title: "选择笔记库" });
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

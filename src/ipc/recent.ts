/**
 * 最近文件（M3 的「文件 → 最近文件」菜单与文件树会用到）。
 *
 * Rust 侧把最近打开的路径写在应用配置目录下的 recent-files.txt，
 * 最新的在最前面。这里只做读取/清空的绑定。
 */

type Backend = {
  list(): Promise<string[]>;
  clear(): Promise<void>;
};

const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const browserBackend: Backend = {
  async list() {
    // 浏览器模式没有「最近打开」的概念，
    // 但返回空数组的话快速打开就只剩一个空列表可看。
    // 给样例库里的几个文件，行为和真实后端一致。
    const { SAMPLE_ROOT } = await import("@/ipc/fs");
    return [`${SAMPLE_ROOT}/README.md`, `${SAMPLE_ROOT}/01 进行中/需求.md`];
  },
  async clear() {
    /* 浏览器降级模式无持久化 */
  },
};

const tauriBackend: Backend = {
  async list() {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string[]>("list_recent_files");
  },
  async clear() {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("clear_recent_files");
  },
};

function getBackend(): Backend {
  return isTauri() ? tauriBackend : browserBackend;
}

/** 读取最近文件列表（新的在前） */
export async function listRecentFiles(): Promise<string[]> {
  return getBackend().list();
}

/** 清空最近文件列表 */
export async function clearRecentFiles(): Promise<void> {
  return getBackend().clear();
}

/** 从完整路径取出展示用文件名 */
export function recentFileName(path: string): string {
  const name = path.split("/").pop() ?? path;
  return name.replace(/\.(md|markdown|mdown|mkd|txt)$/i, "");
}

/**
 * 文件监听的 IPC 桥。
 *
 * 后端是**轮询**（见 `src-tauri/src/watch.rs`）：每秒 stat 一次当前文档，
 * 发现指纹（mtime + 字节数）变了就发一个 `document://changed` 事件。
 *
 * 之所以是轮询而不是原生 watcher，理由记在 Rust 那边的注释里，
 * 一句话版本：**保存是原子替换（换 inode），原生 watcher 分不清「自己存的」
 * 和「别人改的」，而轮询比的是内容，自己存的内容天然不会算成冲突。**
 */

type Backend = {
  watchDocument(path: string): Promise<void>;
  unwatchDocument(): Promise<void>;
  /** 订阅「文件在外部被修改」；返回取消订阅函数 */
  onChanged(handler: (path: string) => void): () => void;
};

/** Rust 侧发出的事件名 */
const CHANGED_EVENT = "document://changed";

const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** 浏览器降级：没有真文件系统，谈不上外部修改 */
const browserBackend: Backend = {
  async watchDocument() {
    /* 浏览器降级模式没有可监听的真文件 */
  },
  async unwatchDocument() {
    /* 同上 */
  },
  onChanged() {
    return () => {};
  },
};

const tauriBackend: Backend = {
  async watchDocument(path) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("watch_document", { path });
  },
  async unwatchDocument() {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("unwatch_document");
  },
  onChanged(handler) {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen<string>(CHANGED_EVENT, (event) => handler(event.payload)).then((fn) => {
        // 订阅期间组件可能已经卸载了——那种情况要立刻退订，
        // 否则事件会一直往一个已经不存在的处理器上派发
        if (disposed) fn();
        else unlisten = fn;
      }),
    );
    return () => {
      disposed = true;
      unlisten?.();
    };
  },
};

function getBackend(): Backend {
  return isTauri() ? tauriBackend : browserBackend;
}

/** 开始监听指定文件 */
export function watchDocument(path: string): Promise<void> {
  return getBackend().watchDocument(path);
}

/** 停止监听 */
export function unwatchDocument(): Promise<void> {
  return getBackend().unwatchDocument();
}

/** 订阅「文件在外部被修改」；返回取消订阅函数 */
export function onDocumentChanged(handler: (path: string) => void): () => void {
  return getBackend().onChanged(handler);
}

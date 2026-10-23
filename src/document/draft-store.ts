/**
 * 崩溃恢复快照的持久层。
 *
 * ## 这层存的是什么
 *
 * 一份「当前正在编辑、但可能还没落盘」的文本快照。机器崩了 / 电断了之后，
 * 靠它把用户最后敲的字捞回来。
 *
 * ## 为什么不是「每次改动都存一份」
 *
 * 只存**一份**——当前正在编辑的那一份。理由：
 * - 崩溃恢复要回答的是「我刚才敲的东西还在吗」，不是「我最近编辑过哪些文件」
 * - 多份快照要处理「哪一份是最新的」「打开另一个文件后旧快照怎么办」这类问题，
 *   而这些问题的正确答案永远是「当前这一份」
 *
 * ## 为什么用 localStorage
 *
 * - 浏览器开发模式（pnpm dev）里也能用，不用起 Rust 侧就能验收
 * - Tauri 的 WKWebView 用的是默认持久化数据存储，localStorage 会跟着应用容器一起留下
 *
 * 代价是它跟着「WebView 数据」而不是「用户数据目录」，清应用数据会一起清掉。
 * 真要做到「崩溃恢复文件用户自己能看到、能从 Finder 找到」，
 * 应该改成写到应用数据目录下的 `drafts/`——那是后端的事，接口不变。
 */

/** 存储键；带版本号是为了以后改结构时能平滑迁移 */
const DRAFT_KEY = "inkstone.draft.v1";

/** 一份草稿快照 */
export interface DraftSnapshot {
  /** 文档绝对路径；null = 未命名草稿 */
  path: string | null;
  /** 文本内容 */
  content: string;
  /** 展示用标题 */
  title: string;
  /** 写入时刻（毫秒时间戳） */
  savedAt: number;
}

/**
 * localStorage 的可用性探测。
 *
 * 隐私模式 / 配额耗尽时 `setItem` 会抛异常，而 `localStorage` 这个属性本身
 * 在某些环境里直接访问就会抛（安全策略）。
 */
function storage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    // 探一下真能写：有些环境能读不能写
    const probe = "__inkstone_probe__";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * 写一份快照。
 *
 * 返回 null = 成功；返回字符串 = 失败原因（要如实告诉用户，
 * 「以为有崩溃恢复其实没有」比「没有崩溃恢复」危险得多）。
 */
export function writeDraft(draft: DraftSnapshot): string | null {
  const store = storage();
  if (!store) return "本机存储不可用";
  try {
    store.setItem(DRAFT_KEY, JSON.stringify(draft));
    return null;
  } catch (error) {
    // 配额满了最常见——大文档 + localStorage 5MB 上限
    return error instanceof Error ? error.message : String(error);
  }
}

/** 读一份快照；没有、坏了、格式不对都当成「没有」 */
export function readDraft(): DraftSnapshot | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DraftSnapshot>;
    if (typeof parsed.content !== "string") return null;
    if (parsed.path !== null && typeof parsed.path !== "string") return null;
    return {
      path: parsed.path ?? null,
      content: parsed.content,
      title: typeof parsed.title === "string" ? parsed.title : "未命名",
      savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : 0,
    };
  } catch {
    // 快照坏了就当没有：不能因为一次解析失败让应用起不来
    return null;
  }
}

/** 删掉快照（内容已经落盘、或用户明确丢弃） */
export function clearDraft(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(DRAFT_KEY);
  } catch {
    // 删不掉就算了，下次启动时会被「内容与磁盘相同」的判断自动清掉
  }
}

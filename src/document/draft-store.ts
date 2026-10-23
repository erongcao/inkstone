/**
 * 崩溃恢复快照的持久层。
 *
 * ## 这层存的是什么
 *
 * 一次**会话**的快照：所有标签页 + 当前激活的是哪一页 + 各自的文本内容。
 *
 * 为什么存整个会话而不是一份文本：崩溃恢复要回答的是「我刚才敲的东西还在吗」，
 * 而用户开了五个标签页时，答案是「五个都在」。
 * 只存当前那一页的话，另外四页的未保存内容就凭空消失了——
 * 那不是恢复，是部分恢复。
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

/** 一个标签页的快照 */
export interface TabSnapshot {
  id: string;
  /** 文件绝对路径；null = 未命名草稿 */
  path: string | null;
  title: string;
  content: string;
  /** 我们相信磁盘上此刻的内容 */
  savedContent: string;
}

/** 整个会话的快照 */
export interface SessionSnapshot {
  tabs: TabSnapshot[];
  /** 崩溃前激活的是哪一页 */
  activeId: string;
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
export function writeDraft(snapshot: SessionSnapshot): string | null {
  const store = storage();
  if (!store) return "本机存储不可用";
  try {
    store.setItem(DRAFT_KEY, JSON.stringify(snapshot));
    return null;
  } catch (error) {
    // 配额满了最常见——大文档 + localStorage 5MB 上限
    return error instanceof Error ? error.message : String(error);
  }
}

/** 读一份快照；没有、坏了、格式不对都当成「没有」 */
export function readDraft(): SessionSnapshot | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionSnapshot>;
    if (!Array.isArray(parsed.tabs)) return null;
    const tabs = parsed.tabs.filter(
      (tab): tab is TabSnapshot =>
        !!tab && typeof tab.content === "string" && typeof tab.id === "string",
    );
    if (tabs.length === 0) return null;
    return {
      tabs,
      activeId: typeof parsed.activeId === "string" ? parsed.activeId : tabs[0].id,
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

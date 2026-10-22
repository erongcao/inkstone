/**
 * Emoji 自动补全：输入 `:smile` 之类的前缀时弹出候选。
 *
 * ## 为什么数据是动态加载的
 *
 * `emoji-data.ts` 有 1900+ 条、155 KB raw（≈50 KB gzip）。
 * 直接静态 import 会让它进主 chunk，拖慢冷启动——
 * 而绝大多数人根本不会用 emoji。所以走 `import()`，
 * 第一次真的打出 `:` 时才拉那个 chunk，之后走浏览器缓存。
 *
 * ## 为什么前缀必须以非单词字符开头
 *
 * `https://a.com` 里的 `://`、代码里的 `a::b` 都不该触发补全——
 * 用户在写 URL 或代码，不是在找表情。判据是 `:` 前一个字符
 * 必须是行首、空白，或者标点。
 *
 * ## 检索规则
 *
 * **前缀匹配**而不是子串匹配：`:smi` 应该只出 `smile` 一类，
 * 出 200 条包含 "smile" 的结果反而难用。中文别名同样按前缀。
 */

import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import type { EmojiRow } from "./emoji-data";

/** 触发前缀 */
const TRIGGER = ":";

/** 前缀最多几个字符（再长基本都不是表情了） */
const MAX_QUERY = 24;

/** 最多给多少个候选 */
const MAX_OPTIONS = 40;

/** 「:` 后面允许的字符：字母 / 数字 / 下划线 / 连字符 / 加号 */
const QUERY_BODY = /^[\p{L}\p{N}_+-]*$/u;

/**
 * `:` 之前**允许**出现的字符。
 *
 * 只有空白与标点能起补全：字母数字/下划线意味着这是 URL 或标识符的一部分
 * （`https://`、`a::b`、`ns::foo`）。中文标点也算进来——这是个中文向的编辑器，
 * 用户在引号/书名号后打 `:笑` 是很自然的。
 */
const TRIGGER_PRECEDING = /[\s([{<"'`\u201c\u201d\u300c\u300d\u300e\u300f\u3010\u3011]/u;

type Table = readonly EmojiRow[];

let tablePromise: Promise<Table> | null = null;

/** 已经拿到手的表；补全源靠它走**同步**路径 */
let cachedTable: Table | null = null;

/**
 * 加载数据（并缓存）。
 *
 * 失败时把两个缓存都清掉，下次重新尝试——
 * 一次性资源加载失败就永久摆烂是最难受的一种状态。
 */
function loadTable(): Promise<Table> {
  if (cachedTable) return Promise.resolve(cachedTable);
  if (!tablePromise) {
    tablePromise = import("./emoji-data")
      .then((mod) => {
        cachedTable = mod.EMOJI_TABLE;
        return cachedTable;
      })
      .catch((error) => {
        tablePromise = null;
        cachedTable = null;
        throw error;
      });
  }
  return tablePromise;
}

/**
 * 后台预热数据表。
 *
 * 编辑器创建时调一次：155 KB 的 chunk 在用户敲第一个 `:` 之前下载完，
 * 补全源就永远走同步路径。
 *
 * ## 为什么补全源要保持**同步**
 *
 * CM6 的 `CompletionSource` 允许返回 Promise，但它与「查询发起时的状态」绑定：
 * 异步期间文档若有任何事务，那个结果会被判定为过期并丢弃，
 * 实测下来就是「源明明返回了 35 条，弹层却始终不出现」。
 * 同步返回没有这个竞态，行为可预测。
 *
 * 数据没到就返回 null（不弹），用户再敲一个字符即可——那时通常已经就绪。
 *
 * 返回 Promise 只是为了让调用方能「想等的时候等」（测试就是这么用的）；
 * 生产里直接 `void` 掉即可。
 */
export function preloadEmojiData(): Promise<Table> {
  return loadTable().catch(() => {
    /* 预热失败无所谓：真正需要时会重试 */
    return EMPTY_TABLE;
  });
}

const EMPTY_TABLE: Table = [];

/** 一条候选 */
interface Hit {
  glyph: string;
  /** 命中的那个关键字（显示在标签位） */
  keyword: string;
  /** 全部关键字（显示在次要位，方便分辨同名） */
  keywords: string[];
}

/** `: 前面的那个字符是不是可以起补全的 */
function canStartThere(textBefore: string): boolean {
  if (textBefore.length === 0) return true;
  const prev = textBefore[textBefore.length - 1];
  // 空白、换行、开头都行；字母数字/下划线不行（那是 URL 或标识符的一部分）
  return TRIGGER_PRECEDING.test(prev);
}

/**
 * Emoji 补全源。
 *
 * 单独导出是为了能直接测——jsdom 里驱动真实补全弹窗很别扭，
 * 而「前缀识别」和「检索排序」这两段才是真正需要守住的部分。
 */
export function findEmojiTrigger(
  context: CompletionContext,
): { from: number; query: string } | null {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);

  const colon = before.lastIndexOf(TRIGGER);
  if (colon === -1) return null;
  const query = before.slice(colon + 1);
  if (query.length > MAX_QUERY) return null;
  if (!QUERY_BODY.test(query)) return null;
  if (!canStartThere(before.slice(0, colon))) return null;

  return { from: context.pos - query.length - 1, query: query.toLowerCase() };
}

/**
 * 关键字切分结果缓存。
 *
 * 检索要对全表 1900+ 行逐行比对，而数据是**空格分隔的一整串**——
 * 每行现切一次就是每击键 1900+ 次 `split` 分配。
 *
 * 切分结果只跟那一行字符串有关，是纯粹的重复计算，缓存住最划算。
 * 上限就是表长（1914），不会无界增长。
 */
const keywordCache = new Map<string, string[]>();

function keywordsOf(keywordString: string): string[] {
  let cached = keywordCache.get(keywordString);
  if (!cached) {
    cached = keywordString.split(" ");
    keywordCache.set(keywordString, cached);
  }
  return cached;
}

/** 在数据表里检索（可单测的纯函数） */
export function searchEmoji(table: Table, query: string, limit = MAX_OPTIONS): Hit[] {
  const q = query.toLowerCase();
  const hits: Hit[] = [];
  for (const [glyph, keywordString] of table) {
    const keywords = keywordsOf(keywordString);
    let matched = -1;
    for (let i = 0; i < keywords.length; i++) {
      if (keywords[i].startsWith(q)) {
        // 完全相等 > 前缀命中：`:smile` 应该把 smile 排在 smilemoodier 前面
        if (keywords[i] === q) {
          matched = i;
          break;
        }
        if (matched === -1) matched = i;
      }
    }
    if (matched === -1) continue;
    hits.push({ glyph, keyword: keywords[matched], keywords });
  }

  /*
   * 排序：**精确匹配 > 关键字短 > 字形码点**。
   *
   * 三级键必须是字形码点，不能是别的东西——它是唯一确定性可复现的键，
   * 重复检索同一查询永远给同一个顺序（用户连按 ↓ 时不会跳动）。
   *
   * ## 已知局限（实测，别指望它是完美的）
   *
   * CLDR 的同义词是长尾的：🍏 带 `smith`、🤦 带 `smh`、😤 带 `smug`。
   * 所以 `:sm` 和 `:smi` 这种**太短的前缀**，首位常常不是用户想要的那个
   * （`:smi` → 🤗、`:sm` → 😤）。再打一两个字母就正常了（`:smil` → 😀）。
   *
   * 试过用「命中关键字在表里的位置」当二级键，**更糟**：`:sm` 会把 🤦(smh，排第 10)
   * 和 😤(smug，排第 12) 顶到最前面。CLDR 没有给出任何能区分
   * 「这是本名」还是「这是同义词」的信号，位置只是数据集的排列习惯，不是语义。
   * 要真解决得靠人工策展的常用别名表，那是另一件事，不在这里猜。
   */
  hits.sort((a, b) => {
    if (a.keyword.length !== b.keyword.length) return a.keyword.length - b.keyword.length;
    return a.glyph < b.glyph ? -1 : 1;
  });
  return hits.slice(0, limit);
}

/** 候选项的 CSS class 标记（配合 live-preview.css 里的样式） */
const OPTION_CLASS = "ink-emoji-option";

/**
 * 命中结果 → CM6 的候选项。
 *
 * **label 放字形、detail 放关键字**，是刻意的：CM6 6.20 的补全弹层
 * 没有 `renderOption` 钩子（只有 `optionClass`），
 * 而它的 label 位默认就是主体位——表情的主体显然是那个字。
 * 字号用 `.ink-emoji-option .cm-completionLabel` 在 CSS 里放大。
 */
function toOptions(hits: Hit[]): Completion[] {
  return hits.map((hit) => ({
    label: hit.glyph,
    // 次要位给命中的关键字 + 一两个近义，帮助分辨「都叫 happy 的那几个」
    detail: [
      hit.keyword,
      ...hit.keywords.filter((k) => k !== hit.keyword).slice(0, 2),
    ].join(" · "),
    apply: hit.glyph,
    type: "emoji",
    // 关键字越短越可能是用户想要的（`:smile` 优先于 `:smiling_face_with_smiling_eyes`）
    boost: hit.keyword.length,
  }));
}

/** 补全源（CM6 的 CompletionSource）——**同步**返回，见 `preloadEmojiData` 的说明 */
export function emojiCompletion(context: CompletionContext): CompletionResult | null {
  // 显式触发（Ctrl-Space）也要求有 `:` 前缀：
  // 没有前缀时弹一屏表情毫无意义，用户要的是「`:` 之后选一个」
  const trigger = findEmojiTrigger(context);
  if (!trigger) return null;
  if (!cachedTable) return null;

  const options = toOptions(searchEmoji(cachedTable, trigger.query));
  if (options.length === 0) return null;
  return {
    from: trigger.from,
    to: context.pos,
    options,
    /**
     * **`filter: false` 是必须的，不是优化。**
     *
     * CM6 在 `sortOptions`（autocomplete 6.20 `index.js:793`）里，
     * 只要没关掉 `filter`，就会拿 `state.sliceDoc(from, to)` 当模式串
     * 去**模糊匹配 `option.label`**。这里的文档文本是 `:smi`（`from` 含冒号），
     * 而 label 是字形 `😄`——两者不可能匹配上，于是 `options.length === 0`，
     * `CompletionDialog.build` 直接返回 `null`，弹层永远不出现。
     *
     * 检索和排序本来就在 `searchEmoji` 里自己做完了（前缀匹配 + 关键字短的在前），
     * 关掉 CM6 的二次过滤正好顺带保住那个顺序：
     * `sortOptions` 在 `filter === false` 时按 `1e9 - i` 递减打分，**原序即序**。
     */
    filter: false,
  };
}

/**
 * Emoji 补全扩展。
 *
 * 用 `override` 而不是直接 `emojiCompletion`：CM6 自带的补全源
 * （语言数据、路径、变量名）在 Markdown 里会弹出没用的东西。
 *
 * 注意 `override` 必须给**数组**：`null` 是「不覆盖」的意思，
 * 会退回 `state.languageDataAt("autocomplete", …)`，而 Markdown 没有语言级补全数据，
 * 那条路拿到的是空数组，等于把唯一能用的源也关掉了。
 */
export function emojiAutocomplete(): Extension {
  return autocompletion({
    override: [emojiCompletion],
    activateOnTyping: true,
    optionClass: (option) => (option.type === "emoji" ? OPTION_CLASS : ""),
    // 一次只可能有一个来源（就是 emoji 本身），限制渲染条数省掉无谓的 DOM
    maxRenderedOptions: MAX_OPTIONS,
    /**
     * 设为 0：默认 100 ms。
     *
     * 因为用了 `filter: false`（也就没有 `validFor`），CM6 每敲一个字符都会
     * 把上一个结果打回 Pending、重新查一遍源；这期间弹层是 `disabled`（发灰）的。
     * 源本身是同步的，1 ms 内就有结果，没必要为此发灰 100 ms。
     */
    activateOnTypingDelay: 0,
  });
}

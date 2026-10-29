/**
 * 问答模式的检索层：把 Markdown 文档切成可检索的块，再用 BM25 排序。
 *
 * ## 检索块 = 一节
 *
 * 切块以 **ATX 标题**为界：一个标题下的正文就是一个检索块
 * （超长时再按段落边界切开，碎块只在**同一节内**并回前一块）。
 * 之所以把「节」当最小单位，是因为检索块同时是**引用溯源**的单位：
 * 面板上列出来的每个来源都要能说清「出自哪一节」，点一下能跳回原文那一段。
 * 跨节合并会把这件事变成「大概在这一带」，溯源就废了。
 *
 * ## 标题里的词也要能检索到
 *
 * 正文不一定重复标题里的词（「# 安装」下面的正文写「打开终端…」）。
 * 只索引正文的话，用户问「安装怎么操作」会一个词都对不上，
 * 被判成「文档里没有相关内容」——那是**假阴性**。
 * 所以索引用的是 `searchText`（标题路径 + 正文），
 * 而给人看的 `text` 仍然是纯正文。
 *
 * ## 标题边界为什么来自 mdast（架构约束 C）
 *
 * 「什么算一个标题」是**语义**判断，必须和渲染 / 导出 / 大纲认同一套规则。
 * 自己扫行找 `#` 会立刻踩三个坑：
 *   - 代码围栏里的 `# 注释` 不是标题
 *   - 引用块里的 `> # 标题` 不是文档章节
 *   - 缩进代码块里的 `# xxx` 是代码
 * 这三种都会让「编辑器认一套、检索认另一套」，所以这里走 mdast
 * （与 `src/ai/context.ts` 的切片、`src/editor/document-index.ts` 的大纲同源）。
 *
 * 只认 **ATX 标题**（`#`…`######`）：规格如此，且 ATX 是编辑器里最常见的写法。
 * Setext 标题（`标题` 下面画 `===`）不切块——它在本仓库里是少数派，
 * 统一按「非标题」处理，避免两套规则并存。
 *
 * ## 解析器没加载完时怎么办
 *
 * remark 管线是**懒加载**的（132 KB，见 `parser/markdown-loader.ts` 的文件头），
 * 没就绪时 `parseMarkdownSync` 返回 null。此时本模块返回**空数组**，
 * 而不是退回自研正则——那会破红线 C。
 * 调用方（问答面板）应当先 `await ensureMarkdownParser()`，
 * 或至少先调一次本函数把懒加载触发掉（下面已经调了 `primeMarkdownParser()`）。
 *
 * ## 中文分词为什么用「字符 bigram」
 *
 * 语料是中文，仓库里**没有中文分词库**（加依赖要过许可证白名单，
 * 而且纯 JS 分词器动辄几百 KB）。可选的三条路：
 *   1. 不分词，整段当一个 token → 检索基本失效
 *   2. 引入 jieba / nodejieba 一类的分词器 → 要加依赖，且有词典体积与维护成本
 *   3. **字符 bigram**：相邻两字一个 token（「实现」→「实现」「现一」「一行」）
 *
 * 选 3：零依赖、零词典、对中文检索的召回明显好于 1，
 * 代价是「实现」和「行进」这类词会互相干扰（bigram 天然不管词边界）。
 * 这是**有意识的取舍**：检索层只要能把相关段落捞出来交给模型，
 * 精确的分词交给模型自己去做。
 *
 * 停用词表同理：只带一份**小**的中英文停用词表（中英文各几十个），
 * 不引入完整词表——完整词表对 bigram 分词的收益很低，
 * 却会让「的」「了」这类字在单字粒度上被砍掉、bigram 里又留不住，
 * 两头不讨好。
 */

import type { Node, Parent, Root } from "mdast";
import { parseMarkdownSync, primeMarkdownParser } from "@/parser/markdown-loader";

/** 一个检索块：文档被切出来的一段内容 */
export interface DocumentChunk {
  /** 稳定 id（形如 "chunk-3"） */
  id: string;
  /** 该块所属标题（最近的祖先标题文本），无标题则为空串 */
  title: string;
  /** 从文档根到该块标题的路径，如 ["第一章", "1.1 节"] */
  headingPath: string[];
  /** 该块正文（不含标题行本身） */
  text: string;
  /**
   * **进检索索引的文本** = 标题路径 + 正文。
   *
   * 为什么要把标题也算进去：正文不一定重复标题里的词。
   * 「# 安装」这一节正文写「打开终端，输入下面的命令」，
   * 用户问「安装怎么操作」——如果只索引正文，一个词都对不上，
   * 检索会判成「文档里没有相关内容」。这是**假阴性**，
   * 比漏召回严重得多（用户看到的是「没找到」，而不是「没排第一」）。
   *
   * 注意它只影响**检索**：`text` 仍然是给人看的正文，
   * 发给模型时正文与标题路径是分开写的（见 `qa.ts`）。
   */
  searchText: string;
  /** 该块在**原文**中的起始偏移 */
  from: number;
  /** 该块在**原文**中的结束偏移 */
  to: number;
}

/** 切块过程中的中间产物：还没编号，也还没算检索文本 */
type RawChunk = Omit<DocumentChunk, "id" | "searchText">;

/** 切块参数 */
export interface ChunkOptions {
  /** 最小块长度（字符数）。比它短的块与相邻块合并。默认 200 */
  minChars?: number;
  /** 最大块长度（字符数）。超了按段落边界切开。默认 2000 */
  maxChars?: number;
}

const DEFAULT_MIN_CHARS = 200;
const DEFAULT_MAX_CHARS = 2000;

/** ATX 标题行：最多 3 个前导空格 + 1~6 个 `#` + 空格或行尾 */
const ATX_HEADING_RE = /^[ \t]{0,3}#{1,6}(?:[ \t]+|$)/;

/** 围栏代码块的开始标记（``` 或 ~~~，CommonMark 两种都合法） */
const FENCE_OPEN_RE = /^[ \t]{0,3}(`{3,}|~{3,})/;

/* ────────────────────────── 切块 ────────────────────────── */

/** 一个标题（及其祖先路径） */
interface HeadingInfo {
  /** 层级 1–6 */
  depth: number;
  /** 标题正文（已剥掉 `#` 与行内标记） */
  text: string;
  /** 标题行在原文中的起始偏移 */
  from: number;
  /** 标题行在原文中的结束偏移（不含换行） */
  to: number;
  /** 从最外层到该标题的路径 */
  path: string[];
}

/** 取一个 mdast 节点的纯文本（递归收集 text / inlineCode 的值） */
function plainText(node: Node): string {
  const parent = node as Parent;
  if (Array.isArray(parent.children)) {
    return parent.children.map((child) => plainText(child)).join("");
  }
  const value = (node as { value?: string }).value;
  return value ?? "";
}

/**
 * 判断某个标题是不是 **ATX** 写法。
 *
 * mdast 里 ATX 与 Setext 都是 `heading` 节点，只能靠源码行的形状区分：
 * Setext 的位置起点落在**正文**上（`标题` 的「标」字），ATX 落在 `#` 上。
 */
function isAtxHeading(source: string, offset: number): boolean {
  const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
  const lineEnd = source.indexOf("\n", offset);
  const line = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd);
  return ATX_HEADING_RE.test(line);
}

/**
 * 收集顶层标题，并算出每个标题的祖先路径。
 *
 * 只看**顶层**子节点：引用块 / 列表项里的标题不是文档章节（和 `document-index.ts`
 * 的大纲口径一致）。路径用栈维护——遇到更浅的标题就把更深的弹掉。
 */
function collectHeadings(root: Root, source: string): HeadingInfo[] {
  const headings: HeadingInfo[] = [];
  /** 栈里存「当前还开着的各级标题」 */
  const stack: Array<{ depth: number; text: string }> = [];

  for (const child of root.children) {
    if (child.type !== "heading" || !child.position) continue;
    const from = child.position.start.offset;
    const to = child.position.end.offset;
    if (from === undefined || to === undefined) continue;
    if (!isAtxHeading(source, from)) continue;

    const text = plainText(child).trim();
    while (stack.length > 0 && stack[stack.length - 1].depth >= child.depth) {
      stack.pop();
    }
    stack.push({ depth: child.depth, text });
    headings.push({ depth: child.depth, text, from, to, path: stack.map((s) => s.text) });
  }
  return headings;
}

/** 一段连续区间 */
interface Span {
  from: number;
  to: number;
}

/**
 * 把一段正文按**空行**切成段落组。
 *
 * 围栏代码块内部**不切**：代码块里的空行不是段落分隔，
 * 在里面切开就等于把一个代码块劈成两半（违反「宁可不对齐也不要切开段落内部」）。
 */
function splitParagraphs(source: string, from: number, to: number): Span[] {
  const groups: Span[] = [];
  let groupStart = -1;
  let groupEnd = -1;
  /** 当前围栏标记（``` / ~~~），null = 不在围栏里 */
  let fence: string | null = null;
  let pos = from;

  while (pos < to) {
    let lineEnd = source.indexOf("\n", pos);
    if (lineEnd === -1 || lineEnd > to) lineEnd = to;
    const line = source.slice(pos, lineEnd);

    // 围栏状态机：进入围栏 / 离开围栏
    const fenceMatch = FENCE_OPEN_RE.exec(line);
    if (fence === null) {
      if (fenceMatch) fence = fenceMatch[1];
    } else {
      const closeRe = new RegExp(`^[ \\t]{0,3}\\${fence[0]}{${fence.length},}[ \\t]*$`);
      if (closeRe.test(line)) fence = null;
    }

    // 空行只有在围栏外面才算段落分隔
    const isBlank = fence === null && line.trim() === "";
    if (isBlank) {
      if (groupStart >= 0) {
        groups.push({ from: groupStart, to: groupEnd });
        groupStart = -1;
      }
    } else {
      if (groupStart < 0) groupStart = pos;
      groupEnd = lineEnd;
    }
    pos = lineEnd + 1;
  }
  if (groupStart >= 0) groups.push({ from: groupStart, to: groupEnd });

  // 收尾时把每组末尾的空白收掉：块区域不该拖着一串换行
  return groups.map((group) => {
    let end = group.to;
    while (end > group.from && /\s/.test(source[end - 1])) end--;
    return { from: group.from, to: end };
  });
}

/** 把两段正文接起来（中间空一行） */
function joinText(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return `${a}\n\n${b}`;
}

/**
 * 把文档切成检索块。
 *
 * 流程固定为三步（顺序不能换）：
 *   1. 按 ATX 标题分段——**标题行本身不算进 `text`**，但块的 `from`/`to`
 *      覆盖到标题区域，UI 可以直接 `source.slice(from, to)` 去选中 / 滚动
 *   2. 超长块按段落边界切开（尽量靠近 `maxChars`，绝不切开段落内部）
 *   3. 过短的碎块并回**同一节**的前一块（跨节不合并——理由见下）
 *
 * ## 为什么合并只发生在同一节内
 *
 * 检索块是「引用溯源」的最小单位：面板上点一个来源，
 * 要能说清「这句话出自哪一节」。跨节合并之后，
 * 一个块可能同时覆盖「墨水」和「砚台」两节，却只能挂一个标题路径——
 * 溯源就退化成「大概在这一带」，而用户恰恰要靠它去核对原文。
 *
 * 短节怎么办？**它自己就是一个块**。检索层要的不是块大，
 * 而是「块与问题的相关性」——一个 20 字的节照样能被 BM25 排到前面。
 * 门槛 `minChars` 只用来收拾**同一节内**被 `maxChars` 切碎的尾巴。
 *
 * @param source 文档全文（Markdown 源码）
 * @param options 切块参数；不传用默认值（最短 200 字、最长 2000 字）
 * @returns 检索块；文档为空、或 remark 解析器尚未加载完成时返回空数组
 */
export function splitDocumentChunks(
  source: string,
  options?: ChunkOptions,
): DocumentChunk[] {
  const minChars = options?.minChars ?? DEFAULT_MIN_CHARS;
  const maxChars = options?.maxChars ?? DEFAULT_MAX_CHARS;

  if (!source.trim()) return [];

  // 先把懒加载触发掉：解析器没就绪时 `parseMarkdownSync` 返回 null，
  // 这一次切分会返回空数组，但下一次就好了（与 `document-index.ts` 同一套路）
  primeMarkdownParser();
  const root = parseMarkdownSync(source);
  // 解析器没就绪 → 放弃这次切分，**不**退回自研正则（那会破红线 C）
  if (!root) return [];

  const headings = collectHeadings(root, source);

  // 分段：第一个标题之前算一段，之后每个标题开一段
  const segments: Array<{ heading: HeadingInfo | null; from: number; to: number }> = [];
  if (headings.length === 0) {
    segments.push({ heading: null, from: 0, to: source.length });
  } else {
    if (headings[0].from > 0) {
      segments.push({ heading: null, from: 0, to: headings[0].from });
    }
    for (let i = 0; i < headings.length; i++) {
      segments.push({
        heading: headings[i],
        from: headings[i].from,
        to: i + 1 < headings.length ? headings[i + 1].from : source.length,
      });
    }
  }

  // 每段再按段落边界切开。
  // **按段分组存**：合并只允许发生在同一段（同一节）内部，见上面的说明。
  const rawBySegment: RawChunk[][] = [];
  for (const segment of segments) {
    const heading = segment.heading;
    const bodyStart = heading ? heading.to : segment.from;
    const path = heading ? heading.path : [];
    const title = heading ? heading.text : "";
    const groups = splitParagraphs(source, bodyStart, segment.to);

    const raw: RawChunk[] = [];
    if (groups.length === 0) {
      // 这一段只有标题、没有正文：仍然产出一个块
      // （这一节在文档里确实存在，检索到它时用户能看见「这一节是空的」）
      raw.push({
        title,
        headingPath: path,
        text: "",
        from: segment.from,
        to: segment.to,
      });
      rawBySegment.push(raw);
      continue;
    }

    // 贪心合并段落，尽量靠近 maxChars——但绝不切开段落内部
    let current: { span: Span; len: number } | null = null;
    /** 本段已经产出几个块：只有**第一个**块要覆盖到标题区域 */
    let produced = 0;

    const push = (span: Span): void => {
      const isFirst = produced === 0;
      produced++;
      raw.push({
        title,
        headingPath: path,
        // 首块的正文从标题**之后**开始——标题行本身不算进正文
        text: source.slice(isFirst ? bodyStart : span.from, span.to).trim(),
        from: isFirst ? segment.from : span.from,
        to: span.to,
      });
    };

    for (const group of groups) {
      const len = group.to - group.from;
      if (current === null) {
        current = { span: group, len };
        continue;
      }
      if (current.len + len <= maxChars) {
        current.span = { from: current.span.from, to: group.to };
        current.len += len;
      } else {
        push(current.span);
        current = { span: group, len };
      }
    }
    if (current) push(current.span);
    rawBySegment.push(raw);
  }

  // 合并过短块：**逐节**做，节与节之间不合并
  const merged = rawBySegment.flatMap((section) => mergeShortChunks(section, minChars));

  // 编号放在最后：合并会改变块的个数，先编号会留下空洞。
  // 检索文本也在最后算——合并会改 `text`，标题路径在合并后才是最终值。
  return merged.map((chunk, index) => ({
    ...chunk,
    id: `chunk-${index + 1}`,
    searchText: buildSearchText(chunk.headingPath, chunk.text),
  }));
}

/**
 * 算出进检索索引的文本：标题路径 + 正文。
 *
 * 标题路径也要进索引，原因见 `DocumentChunk.searchText` 的注释。
 */
function buildSearchText(headingPath: string[], text: string): string {
  const path = headingPath.join(" ");
  return path ? `${path} ${text}` : text;
}

/**
 * 把过短的碎块并进相邻块（**只在一节内部**做）。
 *
 * 规则（规格）：
 *   - 短于 `minChars` 的块与**前一块**合并
 *   - 没有前一块（就是第一块）时与**后一块**合并
 *   - 合并后 `from`/`to` 仍是原文的一段**连续**切片
 *
 * 合并后保留的是**被并入的那一块之外**的标题信息：
 *   - 并进前一块 → 保留前一块的标题路径（块起点所在的那一节）
 *   - 并进后一块 → 保留后一块的标题路径（那一节才有标题信息）
 *
 * 同一节里的碎块标题路径本来就一样，所以这条规则在这里
 * 只是在描述「块起点落在哪」，不会跨节。
 */
function mergeShortChunks(chunks: RawChunk[], minChars: number): RawChunk[] {
  const result: RawChunk[] = [];
  /**
   * 攒着的短块。
   *
   * 用数组而不是「一个可空变量」：第一块太短时要先攒着，
   * 等后面出现一块够长的再并进去——攒着的可能不止一块。
   * （写成 `let pending: X | null` 的话，TS 在循环里的控制流分析
   *   会把那个分支的 `pending` 窄化成 `never`，`{...pending}` 直接编译不过。）
   */
  const pending: RawChunk[] = [];

  for (const chunk of chunks) {
    if (chunk.text.length >= minChars) {
      if (pending.length > 0) {
        // 第一块太短 → 并进这一块（保留这一块的标题信息，区域从攒着的那块起点开始）
        const head = pending[0];
        result.push({
          ...chunk,
          from: head.from,
          text: joinText(pending.map((p) => p.text).join("\n\n"), chunk.text),
        });
        pending.length = 0;
      } else {
        result.push(chunk);
      }
      continue;
    }

    // 太短的块
    if (result.length > 0) {
      // 并进前一块：前一块的标题信息不变，区域向后延长
      const prev = result[result.length - 1];
      result[result.length - 1] = {
        ...prev,
        to: chunk.to,
        text: joinText(prev.text, chunk.text),
      };
    } else {
      pending.push(chunk);
    }
  }

  // 整篇都太短：合成一块（区域取攒下来的那一段）
  if (pending.length > 0) {
    const head = pending[0];
    const tail = pending[pending.length - 1];
    result.push({
      ...head,
      to: tail.to,
      text: pending.map((p) => p.text).join("\n\n"),
    });
  }
  return result;
}

/* ────────────────────────── 分词 ────────────────────────── */

/**
 * 停用词表（小而够用）。
 *
 * 只收**高频虚词**：这些词在任何一篇文档里都出现无数遍，
 * 留在索引里只会稀释 BM25 的区分度。
 * 中文侧注意：停用词只在**单字**粒度生效——bigram 里含停用字的二元组
 * （如「的时」）仍会保留，这是 bigram 分词的固有代价，
 * 换来的是不需要词典、也不会把「的确」这类真词误砍。
 */
const STOP_WORDS = new Set([
  // 英文
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "being",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "each",
  "for",
  "from",
  "had",
  "has",
  "have",
  "he",
  "her",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "just",
  "may",
  "might",
  "more",
  "most",
  "must",
  "my",
  "no",
  "not",
  "now",
  "of",
  "on",
  "only",
  "or",
  "other",
  "our",
  "out",
  "over",
  "own",
  "same",
  "she",
  "should",
  "so",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "to",
  "too",
  "up",
  "us",
  "very",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
  // 中文
  "的",
  "了",
  "是",
  "在",
  "和",
  "与",
  "及",
  "或",
  "也",
  "都",
  "就",
  "而",
  "但",
  "却",
  "又",
  "还",
  "很",
  "更",
  "最",
  "把",
  "被",
  "给",
  "让",
  "对",
  "从",
  "到",
  "向",
  "由",
  "为",
  "以",
  "于",
  "之",
  "其",
  "你",
  "我",
  "他",
  "她",
  "它",
  "们",
  "这",
  "那",
  "有",
  "无",
  "不",
  "没",
  "别",
  "吗",
  "呢",
  "吧",
  "啊",
  "呀",
  "哦",
  "嗯",
  "个",
  "些",
  "什么",
  "怎么",
  "这样",
  "那样",
  "因为",
  "所以",
  "如果",
  "虽然",
  "但是",
  "然后",
  "现在",
  "已经",
  "可以",
  "需要",
  "以及",
  "或者",
  "并且",
  "通过",
  "关于",
  "对于",
  "由于",
  "为了",
  "一个",
  "这些",
  "那些",
  "我们",
  "你们",
  "他们",
]);

/**
 * 拉丁字母数字串 / 汉字串。
 *
 * 汉字用 `\p{Script=Han}`（含扩展区）而不是手写码点区间，
 * 免得漏掉 Extension B 之后的字符。
 * 假名与谚文**不**参与分词：本仓库的语料是中文，
 * 把谚文按字符 bigram 切开只会得到一堆无意义的碎片。
 */
const TOKEN_RUN_RE = /[\p{Script=Han}]+|[0-9A-Za-z]+/gu;

/** 丢掉停用词 */
function pushToken(tokens: string[], token: string): void {
  if (!token) return;
  if (STOP_WORDS.has(token)) return;
  tokens.push(token);
}

/**
 * 把文本切成检索用的 token。
 *
 * - 拉丁字母 / 数字：转小写，按非字母数字切分（`snake_case` → `snake`、`case`）
 * - 汉字：字符 bigram（相邻两字一个 token）；只有一个字时用该单字
 * - 停用词在这里被过滤掉
 *
 * @param text 任意文本
 * @returns token 列表（已小写、已去停用词）
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  if (!text) return tokens;

  for (const match of text.matchAll(TOKEN_RUN_RE)) {
    const run = match[0];
    // 汉字串：按**码点**计数（扩展区汉字在 UTF-16 里是代理对）
    const chars = Array.from(run);
    if (/[\p{Script=Han}]/u.test(chars[0])) {
      if (chars.length === 1) {
        pushToken(tokens, chars[0]);
      } else {
        for (let i = 0; i + 1 < chars.length; i++) {
          pushToken(tokens, chars[i] + chars[i + 1]);
        }
      }
    } else {
      pushToken(tokens, run.toLowerCase());
    }
  }
  return tokens;
}

/* ────────────────────────── BM25 ────────────────────────── */

/** 一条检索命中 */
export interface SearchHit {
  chunk: DocumentChunk;
  score: number;
}

/** 检索参数 */
export interface SearchOptions {
  /** 取前几条。默认 5 */
  topK?: number;
  /** BM25 的 k1。默认 1.5 */
  k1?: number;
  /** BM25 的 b。默认 0.75 */
  b?: number;
}

const DEFAULT_TOP_K = 5;
const DEFAULT_K1 = 1.5;
const DEFAULT_B = 0.75;

/**
 * BM25 关键词检索。
 *
 * 分数非负（IDF 用 `ln(1 + (N - df + 0.5) / (df + 0.5))`），
 * 没有词命中的块**不进结果**——把一堆零分块塞给模型只会稀释上下文。
 *
 * 排序是确定的：先按分数降序，同分按块在数组里的先后（靠前的先）。
 *
 * @param query 用户问题
 * @param chunks 候选块
 * @param options 检索参数
 * @returns 命中列表（最多 topK 条）
 */
export function bm25Search(
  query: string,
  chunks: DocumentChunk[],
  options?: SearchOptions,
): SearchHit[] {
  const topK = options?.topK ?? DEFAULT_TOP_K;
  const k1 = options?.k1 ?? DEFAULT_K1;
  const b = options?.b ?? DEFAULT_B;

  // 查询词去重：同一个词在查询里出现两次不该被算两遍
  const terms = Array.from(new Set(tokenize(query)));
  if (terms.length === 0 || chunks.length === 0) return [];

  // 索引用的是 `searchText`（标题路径 + 正文）而不是 `text`（只有正文）：
  // 正文不重复标题词时，只索引正文会直接召回不到——那是**假阴性**。
  const chunkTokens = chunks.map((chunk) => tokenize(chunk.searchText));
  const lengths = chunkTokens.map((tokens) => tokens.length);
  const total = lengths.reduce((sum, len) => sum + len, 0);
  // 全空文档时 avgdl 会是 0，除法会出 NaN——兜底成 1
  const avgdl = chunks.length > 0 ? total / chunks.length : 1;

  // 文档频率：多少个块出现过这个词
  const df = new Map<string, number>();
  for (const term of terms) {
    let count = 0;
    for (const tokens of chunkTokens) {
      if (tokens.includes(term)) count++;
    }
    df.set(term, count);
  }

  const scored: Array<{ hit: SearchHit; index: number }> = [];
  for (let i = 0; i < chunks.length; i++) {
    const freq = new Map<string, number>();
    for (const token of chunkTokens[i]) {
      freq.set(token, (freq.get(token) ?? 0) + 1);
    }

    let score = 0;
    for (const term of terms) {
      const f = freq.get(term) ?? 0;
      if (f === 0) continue;
      const n = df.get(term) ?? 0;
      const idf = Math.log(1 + (chunks.length - n + 0.5) / (n + 0.5));
      const norm = 1 - b + (b * lengths[i]) / avgdl;
      score += (idf * (f * (k1 + 1))) / (f + k1 * norm);
    }
    if (score <= 0) continue;
    scored.push({ hit: { chunk: chunks[i], score }, index: i });
  }

  // 同分按原顺序：显式带上原下标，不依赖 sort 的稳定性
  scored.sort((a, b) => b.hit.score - a.hit.score || a.index - b.index);
  return scored.slice(0, topK).map((entry) => entry.hit);
}

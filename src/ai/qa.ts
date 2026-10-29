/**
 * 问答模式的请求构造与引用解析。
 *
 * 两件事：
 *   1. 把「问题 + 检索到的来源」拼成一次对话请求
 *   2. 把模型答案里的 `[1]`、`[1,2]`、`[1-3]` 解析回来源序号
 *
 * ## 为什么编号来源要写进 user 消息而不是 system
 *
 * `system` 是用户自己在设置里改的那段提示词（见 `settings/schema.ts`），
 * 我们不往里塞东西——用户改完就以用户的为准。
 * 所以「用 `[n]` 标注来源」这条指令只能放进 user 消息。
 *
 * ## 为什么引用解析要跟踪代码围栏
 *
 * 模型经常在答案里贴代码块，代码里出现 `[1]` 是**字面量**（数组下标、
 * 正则、Python 切片），不是引用。解析时必须跟踪 ``` 围栏的状态，
 * 否则用户会看到「引用了 3 个来源」，其中一个其实是 `arr[1]`。
 */

import type { ChatRequest } from "./provider";
import type { SearchHit } from "./retrieval";

/** 一个引用（指向某个来源序号） */
export interface QaCitation {
  /** 1 起的来源序号 */
  index: number;
  /** 该序号对应的检索命中；序号越界时为 undefined */
  hit?: SearchHit;
}

/** 引用标记：`[1]`、`[1,2]`、`[1, 2]`、`[1-3]`、`[1, 3-5]` */
const CITATION_RE = /\[(\d+(?:\s*[,，-]\s*\d+)*)\](?!\()/g;

/** 围栏代码块的开始标记 */
const FENCE_OPEN_RE = /^[ \t]{0,3}(`{3,}|~{3,})/;

/** 一个区间最多展开多少个序号——防 `[1-999999]` 把进程拖死 */
const MAX_RANGE_SPAN = 100;

/** 没有检索到来源时的占位说明 */
const NO_SOURCES = "（没有检索到任何来源）";

/**
 * 构造一次问答请求。
 *
 * 消息体形如：
 * ```
 * 问题：这里讲了什么？
 *
 * 请只根据下面的来源回答，并在结论后用 [n] 标注来源编号。
 * 来源里没有答案时，直接回答「根据文档无法回答」。
 *
 * [1] 标题路径：第一章 > 1.1 节
 * <该块正文>
 *
 * [2] 标题路径：第二章
 * <该块正文>
 * ```
 *
 * **不设** `maxTokens` / `temperature`：那两项由调用方按 provider 的能力位补上
 * （模型不支持 temperature 时传了会直接报错）。
 *
 * @param question 用户的问题
 * @param hits 检索命中（序号 = 数组下标 + 1）
 * @param systemPrompt 系统提示词，原样透传
 * @returns 协议无关的对话请求
 */
export function buildQaRequest(
  question: string,
  hits: SearchHit[],
  systemPrompt: string,
): ChatRequest {
  const sources =
    hits.length === 0
      ? NO_SOURCES
      : hits
          .map((hit, index) => {
            const path =
              hit.chunk.headingPath.length > 0
                ? hit.chunk.headingPath.join(" > ")
                : "（无标题）";
            return `[${index + 1}] 标题路径：${path}\n${hit.chunk.text}`;
          })
          .join("\n\n");

  const content = [
    `问题：${question}`,
    "",
    "请只根据下面的来源回答，并在结论后用 [n] 标注来源编号。",
    "来源里没有答案时，直接回答「根据文档无法回答」。",
    "",
    sources,
  ].join("\n");

  return {
    system: systemPrompt,
    messages: [{ role: "user", content }],
  };
}

/** 解析一个引用块的内部内容（`1`、`1,2`、`1-3`） */
function parseCitationBody(body: string): number[] {
  const numbers: number[] = [];
  for (const part of body.split(/[,，]/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const range = /^(\d+)\s*-\s*(\d+)$/.exec(trimmed);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      // 倒序区间（`[3-1]`）没有意义，直接忽略
      if (start > end) continue;
      const span = Math.min(end - start + 1, MAX_RANGE_SPAN);
      for (let n = start; n < start + span; n++) numbers.push(n);
      continue;
    }

    if (/^\d+$/.test(trimmed)) numbers.push(Number(trimmed));
  }
  return numbers;
}

/**
 * 解析答案里的引用标记。
 *
 * - 支持 `[1]`、`[1,2]`、`[1, 2]`、`[1-3]`（区间）
 * - 结果**排序 + 去重**
 * - `[0]` 非法（序号从 1 开始），整个忽略
 * - **代码围栏**里的标记不解析（那是字面量，不是引用）
 * - 序号越界时仍然返回该序号，但 `hit` 为 `undefined`
 *
 * @param text 模型返回的文本
 * @param hits 来源列表；给了才能把序号映射回 `SearchHit`
 *   （契约里的签名是 `parseCitations(text)`——多出来的这个可选参数
 *   只影响 `hit` 字段，不传时 `hit` 恒为 `undefined`，`index` 照常可用）
 * @returns 引用列表，按序号升序
 */
export function parseCitations(text: string, hits?: SearchHit[]): QaCitation[] {
  if (!text) return [];

  const found = new Set<number>();
  /** 当前围栏标记，null = 不在围栏里 */
  let fence: string | null = null;
  let pos = 0;

  while (pos < text.length) {
    let lineEnd = text.indexOf("\n", pos);
    if (lineEnd === -1) lineEnd = text.length;
    const line = text.slice(pos, lineEnd);

    // 围栏状态机：进入围栏 / 离开围栏
    const fenceMatch = FENCE_OPEN_RE.exec(line);
    let inFence = false;
    if (fence === null) {
      if (fenceMatch) {
        fence = fenceMatch[1];
        inFence = true;
      }
    } else {
      inFence = true;
      const closeRe = new RegExp(`^[ \\t]{0,3}\\${fence[0]}{${fence.length},}[ \\t]*$`);
      if (closeRe.test(line)) fence = null;
    }

    // 围栏内不解析标记（围栏的开头行本身也算代码内容）
    if (!inFence) {
      for (const match of line.matchAll(CITATION_RE)) {
        for (const number of parseCitationBody(match[1])) {
          // 序号从 1 开始：[0] 直接忽略
          if (number >= 1) found.add(number);
        }
      }
    }

    pos = lineEnd + 1;
  }

  return Array.from(found)
    .sort((a, b) => a - b)
    .map((index) => ({
      index,
      hit: hits && index >= 1 && index <= hits.length ? hits[index - 1] : undefined,
    }));
}

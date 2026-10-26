/**
 * GitHub 风格提示块（`> [!NOTE]`）。
 *
 * ## 规则只有一份
 *
 * 什么算一个 alert，判定规则必须**编辑器与导出完全一致**
 * ——否则屏幕上是个彩色提示块、复制出去却是个普通引用，
 * 或者反过来（架构约束 C）。
 *
 * 规则本身来自上游 `remark-github-blockquote-alert`：
 * 遍历引用块的子节点，对**每个段落**检查一次（只要还没匹配上），
 * 看这个段落的**第一个子节点**是不是 text 节点、且以 `[!TYPE]` 开头。
 *
 * 换句话说，是「**第一个匹配上的段落**」，不是「第一个段落」——
 * `> 引用\n>\n> [!NOTE]` 上游会认成 alert。
 *
 * 这里把规则抄成一份纯函数，供编辑器侧使用——
 * `tests/alerts.test.ts` 里有对拍断言，确保两边不会漂。
 *
 * ## 为什么 alert 变换放在**导出期**，不放在解析层
 *
 * 上游那个插件是**破坏性**的：它把 `[!NOTE]` 从正文里删掉，
 * 再往引用块里插一个「图标 + 标题」段落。
 *
 * 放进解析层的话，往返（mdast → Markdown → mdast）就**丢了标记**——
 * 而 Inkstone 对往返的要求是「再次解析后结构等价」
 * （见 `markdown.ts` 的 `isEquivalent`）。
 *
 * 所以这里把它当**表现层变换**用：解析层出来的 mdast 干干净净
 * （引用块就是引用块），导出时再套一层 alert 变换。
 * 这与公式的 `rehypeMath` 是同一个位置——
 * 都在「mdast → HTML」这条链路上，而不是在语义层。
 *
 * 代价：mdast 本身不知道这是个 alert。
 * 这是有意的——**语义层不该被表现层的变换弄脏**。
 */

import { remarkAlert } from "remark-github-blockquote-alert";
import type { Root } from "mdast";

/** GitHub 支持的五种提示类型 */
export const ALERT_TYPES = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"] as const;

export type AlertType = (typeof ALERT_TYPES)[number];

/**
 * 上游插件用的正则。
 *
 * 抄一份而不是 import——上游没有导出它。
 * `tests/alerts.test.ts` 里有对拍断言：同一个输入，
 * 我们的判定与上游插件的判定必须一致。
 */
const ALERT_PATTERN = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i;

/** 一次 alert 匹配的结果 */
export interface AlertMatch {
  /** 提示类型（大写） */
  type: AlertType;
  /** 标记 `[!NOTE]` 的长度（含方括号与叹号） */
  length: number;
}

/**
 * 判断一段文本是不是 alert 标记。
 *
 * @param text 引用块第一个段落的第一个文本节点的内容
 */
export function matchAlert(text: string): AlertMatch | null {
  const m = ALERT_PATTERN.exec(text);
  if (!m) return null;
  return { type: m[1].toUpperCase() as AlertType, length: m[0].length };
}

/**
 * 上游 transformer 的真实签名。
 *
 * 上游把 `remarkAlert` 标成 `Plugin`（`this: Processor`），
 * 意思是它**应该**被 `.use()` 装进 unified 流水线。
 * 但它运行时返回的其实是一个纯 transformer——
 * 源码里就是 `return (tree) => { visit(tree, 'blockquote', …) }`，
 * 既不碰 `this`，也不碰 file。
 *
 * 这里显式转换一次，而不是为了迁就类型把导出链路改成
 * 「建一个 unified 流水线再 runSync」——那会把同步导出变成异步，
 * 收益只是消掉一个类型断言。
 */
type AlertTransformer = (tree: Root) => void;

/**
 * 给 mdast 套上 alert 变换（上游插件）。
 *
 * **就地修改**传入的树——所以调用方要保证这棵树是一次性的
 * （例如刚从 `parseMarkdown` 出来的那一棵）。
 */
export function applyAlerts(tree: Root): Root {
  const transform = (remarkAlert as unknown as () => AlertTransformer)();
  transform(tree);
  return tree;
}

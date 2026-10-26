/**
 * 编辑器侧的 GitHub 提示块检测。
 *
 * ## 为什么自己扫，不用 lezer 的节点
 *
 * lezer **不认识** alert：`> [!NOTE]` 在它眼里是一个普通引用块，
 * 而 `[!NOTE]` 本身被当成一个 **Link** 节点
 * （和脚注的 `[^1]` 一样——`markdown-language.ts` 的文件头记着这个现象）。
 *
 * 所以这里按「引用块 + 段落」扫一遍。
 *
 * ## 判定规则与导出侧对齐
 *
 * 导出侧用的是上游 `remark-github-blockquote-alert`。
 * 它的规则（读源码读出来的，不是猜的）：
 *
 *   遍历引用块的子节点，**对每个段落**检查一次
 *   ——只要还没匹配上，就继续看下一个段落。
 *   检查的内容是「这个段落的**第一个子节点**是不是 text 节点，
 *   且它的内容以 `[!TYPE]` 开头」。
 *
 * 所以准确的说法是「**第一个匹配上的段落**」，
 * 而不是「第一个段落」——
 * `> 引用\n>\n> [!NOTE]` 这种写法，上游会认成 alert（第二个段落匹配上了），
 * 我们也得认。
 *
 * 我们这边用**原文**判定（段落的原始文本以 `[!TYPE]` 开头），
 * 与上游的差别只在「第一个子节点是不是 text 节点」这一处：
 * 上游要求第一个子节点是纯文本，而原文扫描只要求**开头**是 `[!TYPE]`。
 * 两种写法在真实文档里结论一致（`**[!NOTE]**` 两边都不认），
 * `tests/alerts.test.ts` 里有逐条对拍断言钉住这个结论。
 *
 * **已知的一处分歧**：如果文档里恰好有 `[!NOTE]: https://…` 这样的
 * 链接定义，mdast 会把 `[!NOTE]` 解析成 linkReference 节点
 * （不是文本），上游插件于是**不认**它；我们这边仍会认。
 * 这个组合在真实文档里几乎不会出现，先记在这里。
 */

import type { Tree, SyntaxNode } from "@lezer/common";
import { matchAlert, type AlertType } from "@/parser/alerts";

/** 一个提示块 */
export interface AlertBlock {
  /** 整个引用块的起点 */
  from: number;
  /** 整个引用块的终点（不含） */
  to: number;
  /** `[!NOTE]` 标记的起点 */
  markerFrom: number;
  /** `[!NOTE]` 标记的终点（不含） */
  markerTo: number;
  /** 提示类型 */
  type: AlertType;
}

/** 找出行内文本里第一个换行的位置 */
function lineEnd(source: string, from: number, limit: number): number {
  const nl = source.indexOf("\n", from);
  return nl === -1 || nl > limit ? limit : nl;
}

/**
 * 引用块的**直接子段落**（按文档顺序）。
 *
 * 不能用「第一个子节点」——lezer 会把 `>` 标记（QuoteMark）放在段落**前面**：
 *
 * ```
 * Blockquote [0, 14]
 *   QuoteMark [0, 1] ">"
 *   Paragraph [2, 14] "[!NOTE]\n> 内容"
 * ```
 *
 * 所以要找的是「第一个 **Paragraph** 类型的子节点」。
 */
function childParagraphs(block: SyntaxNode): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  const cursor = block.cursor();
  if (cursor.firstChild()) {
    do {
      const child = cursor.node;
      if (child.type.name === "Paragraph") result.push(child);
    } while (cursor.nextSibling());
  }
  return result;
}

/**
 * 在语法树里找出所有 GitHub 提示块。
 *
 * @param tree   lezer 语法树
 * @param source 文档全文
 */
export function findAlerts(tree: Tree, source: string): AlertBlock[] {
  const out: AlertBlock[] = [];

  tree.iterate({
    enter: (ref) => {
      if (ref.type.name !== "Blockquote") return;
      const block = ref.node;

      // 按上游的规则：逐个段落看，**第一个匹配上的**算数。
      let hit: { paragraph: SyntaxNode; type: AlertType; length: number } | null = null;
      for (const paragraph of childParagraphs(block)) {
        // 段落的原始文本（已去掉行首的 `> `）
        const end = lineEnd(source, paragraph.from, paragraph.to);
        const firstLine = source.slice(paragraph.from, end);
        const match = matchAlert(firstLine);
        if (match) {
          hit = { paragraph, type: match.type, length: match.length };
          break;
        }
      }
      if (!hit) return; // 不是提示块 → 继续往里走（嵌套的引用块自己判断）

      out.push({
        from: block.from,
        to: block.to,
        markerFrom: hit.paragraph.from,
        markerTo: hit.paragraph.from + hit.length,
        type: hit.type,
      });
      // 这个引用块整体就是一个提示块，不再往里找
      return false;
    },
  });

  return out;
}

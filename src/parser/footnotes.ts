/**
 * 「定义了却没人引用」的脚注定义。
 *
 * ## 为什么这是���缺陷
 *
 * GFM 的脚注定义（`[^label]: 内容`）只有**被引用**时才构成脚注。
 * remark（HTML / PDF 导出那条链路）遇到没人引用的定义时，
 * 会把整条**丢掉**——实测：源文里写着
 *
 * ```
 * [^unused]: 没人引用的定义，屏幕上看得见。
 * ```
 *
 * 屏幕上这段字**看得见**（它是用户的正文），导出后的 HTML / PDF 里
 * 却**一个字都不剩**——用户的内容被静默删掉了。
 *
 * pandoc 那条链路不一样：它会**告警**
 * （实测 `Note with key 'unused' defined at ... but not used.`），
 * 而这个告警是会被带回给用户看的（见 `src/export/service.ts` 的 warnings）。
 *
 * 于是两条导出链路的行为**不对称**：一条静默丢内容，一条会告诉你。
 * 静默丢内容的那条必须修。
 *
 * ## 修法：把没人引用的定义**按原文留在原处**
 *
 * 屏幕上它就是一段普通正文（编辑器把它当源码显示，只是不给它编号徽标），
 * 那导出物里它也该是一段普通正文——**位置、内容、字符，一个都不改**。
 *
 * 选「留在原处」而不是「挪到脚注区」的��由：
 *
 * - 留在原处 = 与屏幕**逐字一致**（架构约束 C）
 * - 挪到脚注区 = 我们替用户决定了一个他没写的结构
 *
 * ## 为什么不在解析层做
 *
 * 解析层必须保持「mdast → Markdown → mdast」往返等价
 * （见 `src/parser/markdown.ts` 的 `isEquivalent`）。
 * 把定义换成段落会破坏往返——所以它属于**表现层变换**，
 * 与 `applyAlerts`（提示块）、`applyImageSizes`（图片尺寸）同一性质。
 */

import type { Paragraph, Root, RootContent } from "mdast";

/** 一个「定义了却没人引用」的脚注定义 */
export interface UnusedFootnoteDefinition {
  /** 标签（mdast 已归一化成小写） */
  identifier: string;
  /** 定义在**原文**中的起点（含 `[^label]:`） */
  from: number;
  /** 定义在**原文**中的终点 */
  to: number;
}

/**
 * 找出所有「定义了却没人引用」的脚注定义。
 *
 * 判据：树里有 `footnoteDefinition` 节点，
 * 但**没有**任何 `footnoteReference` 指向它的 `identifier`。
 *
 * 与 remark 的行为对齐（实测）：没被引用的定义整条丢弃，
 * 所以我们要在丢掉之前把它捞出来。
 */
export function findUnusedFootnoteDefinitions(tree: Root): UnusedFootnoteDefinition[] {
  const referenced = new Set<string>();
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (record.type === "footnoteReference" && typeof record.identifier === "string") {
      referenced.add(record.identifier);
    }
    const children = record.children;
    if (Array.isArray(children)) {
      for (const child of children) visit(child);
    }
  };
  visit(tree);

  const out: UnusedFootnoteDefinition[] = [];
  for (const child of tree.children) {
    if (child.type !== "footnoteDefinition") continue;
    if (referenced.has(child.identifier)) continue;
    const start = child.position?.start.offset;
    const end = child.position?.end.offset;
    if (start === undefined || end === undefined) continue;
    out.push({ identifier: child.identifier, from: start, to: end });
  }
  return out;
}

/**
 * 把「没人引用」的脚注定义换成**普通段落**，就地改树。
 *
 * 段落内容是**定义在原文里的那几行**（原样），
 * 所以导出的文件里那一行与用户写的一模一样。
 *
 * @param tree 一次性使用的 mdast 树（改完就废弃）
 * @param source 原文
 */
export function applyUnusedFootnotes(tree: Root, source: string): void {
  const unused = findUnusedFootnoteDefinitions(tree);
  if (unused.length === 0) return;

  const unusedById = new Map(unused.map((item) => [item.identifier, item]));
  const next: RootContent[] = [];

  for (const child of tree.children) {
    if (child.type !== "footnoteDefinition") {
      next.push(child);
      continue;
    }
    const found = unusedById.get(child.identifier);
    if (!found) {
      next.push(child);
      continue;
    }

    // 标签要用**原文**里的那个（mdast 把 identifier 归一化成小写了，
    // 源文写的是 `[^Note]` 的话，导出里不能变成 `[^note]`）。
    const original = source.slice(found.from, found.to);
    const marker = /^\s*(\[\^[^\]]*\])/.exec(original);
    const label = marker ? `${marker[1]}: ` : `[^${child.identifier}]: `;

    // 定义的内容是已经解析好的块（段落 / 列表…）。
    // 把它们原样放回根层级，标签塞进**第一个段落**的开头。
    const blocks = child.children;
    if (blocks.length === 0) {
      const paragraph: Paragraph = {
        type: "paragraph",
        children: [{ type: "text", value: label.trimEnd() }],
        data: { hProperties: { className: ["inkstone-footnote-unused"] } },
      };
      next.push(paragraph);
      continue;
    }

    const [first, ...rest] = blocks;
    if (first.type === "paragraph") {
      first.children = [{ type: "text", value: label }, ...first.children];
      first.data = {
        ...first.data,
        hProperties: {
          ...(first.data?.hProperties ?? {}),
          className: ["inkstone-footnote-unused"],
        },
      };
      next.push(first, ...rest);
      continue;
    }

    // 定义的第一块不是段落（少见）：单独加一个带标签的段落，再放其余块
    next.push({
      type: "paragraph",
      children: [{ type: "text", value: label.trimEnd() }],
      data: { hProperties: { className: ["inkstone-footnote-unused"] } },
    });
    next.push(...blocks);
  }

  tree.children = next;
}

/**
 * 把源码里「没人引用」的脚注定义改成**字面文本**。
 *
 * 给 pandoc 那条链路用——pandoc 也会丢弃没人引用的定义，
 * 而我们要的是**内容不丢**（见文件头的说明）。
 *
 * 做法：把定义标记的 `[` 转义成 `\[`，
 * pandoc 就把它当普通文字而不是定义，
 * 渲染出来仍然是 `[^unused]: 内容`——与屏幕逐字一致。
 *
 * 续行（缩进 4 空格以上）要**去掉一层缩进**：
 * 不然 pandoc 会把续行当成缩进代码块（那是另一段内容了）。
 *
 * @param source 原始 Markdown
 * @param unused 找出��的未引用定义
 */
export function escapeUnusedFootnotes(
  source: string,
  unused: UnusedFootnoteDefinition[],
): string {
  if (unused.length === 0) return source;

  // 从后往前替换——前面的偏移才不会因后面的替换而失效
  const ordered = [...unused].sort((a, b) => b.from - a.from);
  let out = source;
  for (const item of ordered) {
    const block = source.slice(item.from, item.to);
    const escaped = escapeDefinition(block);
    out = out.slice(0, item.from) + escaped + out.slice(item.to);
  }
  return out;
}

/**
 * 把一段脚注定义改成字面文本。
 *
 * - 第一行：把开头的 `[` 转义（`[^x]:` → `\[^x]:`）
 * - 续行：去掉一层 4 空格缩进（让它留在同一个段落里）
 */
function escapeDefinition(block: string): string {
  const lines = block.split("\n");
  const out: string[] = [];
  lines.forEach((line, index) => {
    if (index === 0) {
      out.push(line.replace(/^\s*\[[^\]]*\]/, (m) => m.replace("[", "\\[")));
      return;
    }
    // 续行：去掉最多 4 个前导空格
    out.push(line.replace(/^ {1,4}/, ""));
  });
  return out.join("\n");
}

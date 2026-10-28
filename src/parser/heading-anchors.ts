/**
 * 标题锚点：让大纲里的链接能跳到正文里**对应**的标题。
 *
 * ## 为什么要有这个模块
 *
 * 导出的 HTML 里，大纲是一个 `<a href="#…">`，正文里的标题是 `<h2 id="…">`。
 * 两边的 id 必须是**同一个值**，否则点了目录跳不到地方。
 *
 * ## 早先的做法为什么是错的
 *
 * 早先的实现在导出时用正则数出 HTML 里第 N 个 `<hN>` 标签，
 * 再把第 N 个大纲项的 id 贴上去。这个对应关系**只在「文档里所有标题
 * 都是顶层标题」时成立**。三种情况会打破它：
 *
 *   - 引用块里的标题（`> # 标题`）：大纲只收顶层标题，不收它，
 *     但 HTML 里它照样是一个 `<h1>` 标签——**占掉一个名额**；
 *   - 列表项里的标题（`- # 标题`）：同上；
 *   - 用户自己写的原始 HTML（`<h1>标题</h1>`）：那根本不是 mdast 的
 *     标题节点，只是原样输出的文本——同样占掉一个名额。
 *
 * 实测（2026-10-28）：文档里只有**一个**顶层标题、外加一个引用块标题时，
 * 大纲项的 id 被贴到了**引用块里那个标题**上，真正的大纲标题反而没有 id。
 * 导出的文件里点目录，跳到的是错误的位置——而文件本身看不出任何异常。
 *
 * ## 现在的做法
 *
 * id 由**标题节点自己**决定：标题深度 + 它在源码里的起始偏移。
 *
 * 大纲与正文都从**同一棵** mdast 树取这两个值（偏移量是唯一的），
 * 所以两边**不可能对不上**——不是「算得准」，是「没有第二次计算」。
 *
 * ## 写进 hast 的机制
 *
 * mdast 的标准扩展点 `data.hProperties`。
 * 上游 `mdast-util-to-hast` 的 heading handler 末尾调用 `state.applyData(node, result)`，
 * 而 `applyData` 会把 `data.hProperties` 合并进元素的属性
 * （上游 `lib/state.js`：`Object.assign(result.properties, structuredClone(hProperties))`）。
 *
 * 所以 `data.hProperties.id` 最终就是 `<h2 id="…">` 里的那个 id。
 */

import type { Nodes, Root } from "mdast";

/**
 * 标题的锚点 id。
 *
 * @param depth 标题层级 1–6
 * @param from 该标题在**源码**里的起始偏移（`position.start.offset`）
 */
export function headingAnchorId(depth: number, from: number): string {
  return `section-${depth}-${from}`;
}

/** mdast 里带 `children` 的容器节点 */
function isParent(node: Nodes): node is Nodes & { children: Nodes[] } {
  return "children" in node && Array.isArray(node.children);
}

/**
 * 给树里**每个**标题节点打上锚点 id。
 *
 * ## 为什么连嵌套的标题也打
 *
 * 引用块里、列表项里的标题同样是能直接跳转的位置，
 * 给它们 id 只是多一个可用的深链。
 *
 * 不会与大纲的链接冲突：id 里含源码偏移量，**每个节点都不同**。
 *
 * ## 没有位置的标题怎么办
 *
 * 跳过。没有 `position` 就不知道它在源码里的偏移，
 * 也就没法生成一个稳定的 id——凭空造一个反而可能在两处撞车。
 *
 * （提示块变换会往引用块里插一个标题段落，那是**合成的**节点、没有位置，
 * 正好被这一条挡住。）
 */
export function applyHeadingAnchors(tree: Root): void {
  walk(tree);
}

function walk(node: Nodes): void {
  if (node.type === "heading") {
    const from = node.position?.start.offset;
    if (typeof from === "number") {
      // `data` 上已有别的键时要**合并**而不是覆盖——
      // 上游的 `applyData` 只看 `hName` / `hProperties` / `hChildren` 三个键，
      // 但别处的插件可能往 `data` 里放别的东西。
      const data = (node.data ?? {}) as { hProperties?: Record<string, unknown> };
      node.data = {
        ...data,
        hProperties: {
          ...data.hProperties,
          id: headingAnchorId(node.depth, from),
        },
      };
    }
    // heading 没有 children，不用往下走
    return;
  }

  if (isParent(node)) {
    for (const child of node.children) {
      walk(child);
    }
  }
}

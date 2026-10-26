/**
 * 关掉公式时，把公式节点**还原成原文**。
 *
 * ## 为什么需要这一步
 *
 * `remark-math` 只有一个开关（`singleDollarTextMath`），
 * **没有**「行内公式」「块级公式」分开的开关——
 * 而设置面板里这两个是分开的。
 *
 * 那能不能不挂 `remark-math`？只能两个一起关。
 * 单独关行内公式时，`remark-math` 仍然要挂（块级还要用），
 * 于是 `$x$` 会被解析成 `inlineMath` 节点——
 * **定界符 `$` 在 mdast 里是不存在的**（节点只有 `value: "x"`）。
 *
 * 直接不渲染它，导出会变成 `<code>x</code>`——**用户的 `$` 没了**。
 * 那比「不解析」更糟：文档内容被悄悄改掉了。
 *
 * ## 解法：用 position 把原文切回来
 *
 * `inlineMath` / `math` 节点的 position **完整覆盖定界符**（实测）：
 *
 * | 源码 | position 切出来的原文 |
 * |---|---|
 * | `$x^2$` | `$x^2$` |
 * | `$ x^2 $`（带空格） | `$ x^2 $` |
 * | `$$\ny = mc^2\n$$` | `$$\ny = mc^2\n$$` |
 *
 * 所以把节点换成一个**内容等于原文**的文本节点，
 * 效果就等于「这个公式根本不被识别」——
 * 而这正是关掉开关应该有的样子。
 *
 * ## 为什么要放在解析层而不是渲染层
 *
 * 架构约束 C：编辑器与导出必须对同一段文字给出同样的结论。
 * 如果只在渲染层拦，mdast 里仍然是公式节点，
 * 而导出链路（mdast → hast）拿到的还是公式——
 * 屏幕上是字面文本、导出却是 KaTeX，分裂当场发生。
 *
 * 放在解析层则**两边同时生效**：
 * 编辑器的行内公式定位走的是同一个 `parseMarkdown`（逐行解析），
 * 导出走的是同一棵树，天然一致。
 *
 * ## 为什么是普通函数，不是 remark 插件
 *
 * unified 的插件分两类：**解析器扩展**（`parse` 阶段）与
 * **变换器**（`run` 阶段）。
 *
 * 而 `parseMarkdown()` 只调 `processor.parse(source)`——
 * **变换器根本不会跑**。
 *
 * 早先把它写成 remark 插件（`remarkMathOff`）时，
 * 它一次都没执行过：测试是绿的，因为**没有测试断言它生效**。
 * 「插件挂上了」不等于「插件跑了」——这是 unified 最容易踩的一类坑。
 *
 * 所以这里改成一个**普通函数**，由 `parseMarkdown` 在解析完立刻调用：
 * 调用关系是显式的，跑没跑一眼看得见。
 */

import type { Node, Parent, Root, RootContent } from "mdast";

/** 关掉哪些公式 */
export interface MathOffOptions {
  /** **关掉**行内公式（true = 还原成字面文本） */
  inlineMath: boolean;
  /** **关掉**块级公式（true = 还原成字面文本） */
  blockMath: boolean;
}

/** 节点的 position 区间（mdast 的 `Position` 在这里够用了） */
function rawOf(node: Node, source: string): string | null {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (start === undefined || end === undefined) return null;
  return source.slice(start, end);
}

/**
 * 递归遍历 mdast，就地替换节点。
 *
 * 自己写而不用 `unist-util-visit`：只用到「按类型找到节点并替换」这一件事，
 * 而 `unist-util-visit` 是传递依赖，要用就得再提升一个直接依赖。
 */
function replaceNodes(
  parent: Parent,
  source: string,
  type: string,
  make: (raw: string) => RootContent,
): void {
  const children = parent.children as RootContent[];
  for (let i = 0; i < children.length; i++) {
    const child = children[i] as Node & Parent;
    if (child.type === type) {
      const raw = rawOf(child, source);
      if (raw !== null) {
        children[i] = make(raw);
      }
      continue;
    }
    if (Array.isArray(child.children)) {
      replaceNodes(child as Parent, source, type, make);
    }
  }
}

/**
 * 把被关掉的公式节点还原成字面文本。
 *
 * **就地修改**传入的树。
 *
 * @param tree    刚解析出来的 mdast
 * @param source  原文（用来按 position 切回原文）
 * @param options 哪些公式被关掉了
 */
export function restoreDisabledMath(
  tree: Root,
  source: string,
  options: MathOffOptions,
): Root {
  const { inlineMath, blockMath } = options;
  if (!inlineMath && !blockMath) return tree;

  if (inlineMath) {
    // 行内公式 → 纯文本节点。
    // 父节点一定是段落/标题这类**行内容器**，换成 text 是合法的。
    replaceNodes(tree, source, "inlineMath", (raw) => ({ type: "text", value: raw }));
  }

  if (blockMath) {
    // 块级公式 → 段落。
    //
    // 必须是**块级**节点：块级公式的父节点是 root，
    // 而 root 的子节点只能是块级节点（塞 text 会让 mdast 结构非法）。
    // 段落里的换行是软换行，导出后显示成一行——与「压根没识别」的效果一致。
    replaceNodes(tree, source, "math", (raw) => ({
      type: "paragraph",
      children: [{ type: "text", value: raw }],
    }));
  }

  return tree;
}

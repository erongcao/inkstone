/**
 * `==高亮==` —— Typora 同款的行内高亮。
 *
 * ## 为什么需要它
 *
 * GFM 没有高亮语法，但 Typora 的 Live Preview 行内样式里明确含 `==`
 * （见 `docs/typora-feature-inventory.md` 第 13 行），Obsidian 也用同一套。
 * 用户从 Typora 迁过来时文件里本来就带 `==`——
 * 不认它，等于把别人的文档显示成一片裸等号。
 *
 * ## 三层都要认它
 *
 * 架构约束 C（解析规则唯一）要求「编辑器认的」与「导出认的」是同一套规则：
 *
 *   - **remark/mdast**（本文件）：语义与序列化——`==高亮==` → `highlight` 节点 → `==高亮==`
 *   - **lezer**（`src/editor/markdown-language.ts`）：编辑视图的标记隐藏与样式
 *   - **导出**（`src/parser/html.ts`）：`highlight` 节点 → `<mark>`
 *
 * 三处的「什么算高亮」必须一致，判据在 `tests/parser-agreement.test.ts`
 * 里对着语料库断言：lezer 与 remark 对同一段文字给出不同结论，
 * 就会出现「屏幕上标了高亮、导出却没有」这种分裂。
 *
 * ## 依赖从哪来
 *
 * - `micromark-extension-highlight-mark`：micromark 层的分词器（delimiter 规则）
 * - `mdast-util-highlight-mark`：mdast 层的节点定义与序列化器
 *
 * 两者都是 MIT。它的 delimiter 规则是从 GFM 官方的删除线扩展
 * （`micromark-extension-gfm-strikethrough`）改写而来——
 * 而 lezer 侧的 `Highlight` 扩展也是照同一份模板写的，
 * 所以两边的「什么算高亮」天然一致，不是各写一套碰运气。
 *
 * ## 一个副作用：`=` 会被转义
 *
 * `highlightMarkToMarkdown` 把 `=` 标成了 `unsafe`——
 * 序列化时行文中的 `=` 会变成 `\=`。
 *
 * 这不会碰到用户的文件：Inkstone 存盘写的是**编辑器里的原文**，
 * `remark-stringify` 只在 round-trip 测试与「mdast → Markdown 源码」这条出口上跑，
 * 而导出只有 HTML / PDF / pandoc 三种，没有一条走 remark-stringify。
 * 结构等价性不受影响（`\=` 解析回来还是 `=`）。
 */

import { highlightMark } from "micromark-extension-highlight-mark";
import {
  highlightMarkFromMarkdown,
  highlightMarkToMarkdown,
} from "mdast-util-highlight-mark";
import type { Options } from "remark-rehype";
import type { Plugin } from "unified";
import type { Root } from "mdast";
import { mount, type ExtensionMounts } from "./extensions";

/**
 * remark 插件：让解析与序列化都认 `==高亮==`。
 *
 * 三样东西分别挂在三个不同的挂载点上：
 *   - micromarkExtensions：分词器，决定「哪里是标记」
 *   - fromMarkdownExtensions：token → mdast 节点
 *   - toMarkdownExtensions：mdast 节点 → Markdown 源码（round-trip 用）
 */
export const remarkHighlightMark: Plugin<[], Root> = function remarkHighlightMark() {
  const data = this.data() as unknown as ExtensionMounts;
  mount(data, "micromarkExtensions", highlightMark());
  mount(data, "fromMarkdownExtensions", highlightMarkFromMarkdown);
  mount(data, "toMarkdownExtensions", highlightMarkToMarkdown);
};

/**
 * `highlight` mdast 节点 → hast 的 `<mark>`。
 *
 * 挂在 `remark-rehype` 的 `handlers` 选项上——
 * 那是 `mdast-util-to-hast` 唯一开放的扩展入口
 * （它没有 `toHastExtensions` 那套机制）。
 *
 * 不走 `data.hName` 的路子：那要改 mdast 节点的创建过程，
 * 而节点的创建是 `mdast-util-highlight-mark` 包的职责；
 * 在这层补一个 handler 更直白，也不用给包打补丁。
 */
export const highlightHastHandlers: NonNullable<Options["handlers"]> = {
  highlight(state, node) {
    return {
      type: "element",
      tagName: "mark",
      properties: {},
      children: state.all(node),
    };
  },
};

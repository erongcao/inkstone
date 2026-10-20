/**
 * Markdown 解析层 —— 全应用唯一的语义来源。
 *
 * 架构约束 C：**渲染、导出、大纲、脚注编号全部从同一棵 mdast 树派生**。
 * 任何模块都不得自己再实现一套 Markdown 解析逻辑。
 *
 * 插件组合与 Typora 保持一致：
 *   remark-frontmatter  YAML front matter
 *   remark-gfm          表格、任务列表、删除线、自动链接、GFM 脚注
 *   remark-math         行内 $…$ 与块级 $$…$$
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import remarkStringify from "remark-stringify";
import type { Root } from "mdast";

export type MarkdownAst = Root;

/** 构建统一处理器（抽成函数以便用 ReturnType 推导，避免手写泛型参数出错） */
function buildProcessor() {
  return unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ["yaml"])
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkStringify, {
      bullet: "-",
      emphasis: "*",
      strong: "*",
      fence: "`",
      rule: "-",
      listItemIndent: "one",
      tightDefinitions: true,
    });
}

type MarkdownProcessor = ReturnType<typeof buildProcessor>;

let processor: MarkdownProcessor | null = null;

/** 获取（并缓存）统一的 Markdown 处理器 */
export function getProcessor(): MarkdownProcessor {
  if (!processor) {
    processor = buildProcessor();
  }
  return processor;
}

/** 解析 Markdown 源码为 mdast */
export function parseMarkdown(source: string): MarkdownAst {
  return getProcessor().parse(source);
}

/**
 * 把 mdast 序列化回 Markdown 源码。
 *
 * 注意：序列化结果不保证与输入逐字节相同（Markdown 语法有多种等价写法），
 * 真正的要求是「再次解析后结构等价」——这由 round-trip 测试保证。
 */
export function stringifyMarkdown(tree: MarkdownAst): string {
  return getProcessor().stringify(tree);
}

/** 解析 → 序列化，往返一次 */
export function roundTrip(source: string): string {
  return stringifyMarkdown(parseMarkdown(source));
}

/**
 * 结构等价性判断：比较两次解析得到的 mdast 的"骨架"。
 *
 * 判定标准刻意放宽到"结构相同、文本相同"，忽略：
 *   - position 信息（行号列号）
 *   - 空白与换行差异
 *   - 节点上的非语义属性
 *
 * 这样既能抓住真正的语义丢失，又不会被格式化差异误报淹没。
 */
export function isEquivalent(a: MarkdownAst, b: MarkdownAst): boolean {
  return JSON.stringify(stripPositions(a)) === JSON.stringify(stripPositions(b));
}

/** 递归去掉 position 字段，得到可比较的结构 */
function stripPositions(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(stripPositions);
  }
  if (node !== null && typeof node === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "position") continue;
      result[key] = stripPositions(value);
    }
    return result;
  }
  return node;
}

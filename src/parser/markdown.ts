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
 *   remarkHighlightMark ==高亮==（Typora 同款，见 highlight.ts）
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import remarkStringify from "remark-stringify";
import { remarkHighlightMark } from "./highlight";
import type { Root } from "mdast";

export type MarkdownAst = Root;

/** 构建统一处理器（抽成函数以便用 ReturnType 推导，避免手写泛型参数出错） */
function buildProcessor(parseOptions: ParseOptions = {}) {
  return (
    unified()
      .use(remarkParse)
      .use(remarkFrontmatter, ["yaml"])
      // `singleTilde: false`：**单波浪号不算删除线**。
      //
      // GFM 的默认是 `true`（github.com 认单波浪号），但 GFM 规范本身并不允许。
      // 而 Inkstone 这里必须关掉它，有两个具体理由：
      //
      //   1. **编辑视图不认单波浪号**：lezer 那侧的 GFM 删除线扩展要求成对两个 `~`，
      //      所以 `~x~` 在编辑器里是普通文本。remark 若认它，两层就对不上了
      //      ——屏幕上是字面文本，导出却变成删除线。
      //   2. **Typora 的 `~x~` 是下标**，不是删除线；而 `H~2~O`（化学式）
      //      里的单波浪号更不该被吃掉。开着这个选项，导出 HTML 时
      //      `H~2~O` 会变成 `H<del>2</del>O`。
      //
      // 顺带说明：Typora 的下标/上标（`~x~` / `^x^`）是 P1 功能，
      // 但 remark 侧还没有对应解析规则，所以本轮没开——
      // 只开 lezer 那一半会破「解析规则唯一」那条红线。
      .use(remarkGfm, { singleTilde: false })
      // 选项透传：关掉单 `$` 时 micromark 只会把 `$$…$$` 当行内定界符，
      // 块级 `$$` 始终要求至少两个 `$`，不受这个选项影响。
      .use(remarkMath, {
        singleDollarTextMath: parseOptions.singleDollarTextMath !== false,
      })
      // `==高亮==`：Typora 同款的行内高亮（不是 GFM，但 Typora/Obsidian 都用）。
      // 必须挂在 remarkStringify 之前——序列化器要知道这个节点该怎么写回去。
      .use(remarkHighlightMark)
      .use(remarkStringify, {
        bullet: "-",
        emphasis: "*",
        strong: "*",
        fence: "`",
        rule: "-",
        listItemIndent: "one",
        tightDefinitions: true,
      })
  );
}

/** 解析选项：与设置面板一一对应 */
export interface ParseOptions {
  /**
   * 单个 `$` 是否作为行内公式定界符。
   *
   * 原样透传给 remark-math → micromark-extension-math 的 `singleDollarTextMath`
   * （上游默认 `true`）。这是**语义层**的一等开关，不是编辑器自造的启发式，
   * 所以编辑器视图、HTML 导出、往返测试三者天然一致（架构约束 C）。
   */
  singleDollarTextMath?: boolean;
}

/** 解析选项的缓存键 */
function cacheKey(options: ParseOptions): string {
  return options.singleDollarTextMath === false ? "sd0" : "sd1";
}

type MarkdownProcessor = ReturnType<typeof buildProcessor>;

const processors = new Map<string, MarkdownProcessor>();

/** 获取（并按选项缓存）统一的 Markdown 处理器 */
export function getProcessor(options: ParseOptions = {}): MarkdownProcessor {
  const key = cacheKey(options);
  let processor = processors.get(key);
  if (!processor) {
    processor = buildProcessor({
      singleDollarTextMath: options.singleDollarTextMath !== false,
    });
    processors.set(key, processor);
  }
  return processor;
}

/** 解析 Markdown 源码为 mdast */
export function parseMarkdown(source: string, options: ParseOptions = {}): MarkdownAst {
  return getProcessor(options).parse(source);
}

/**
 * 把 mdast 序列化回 Markdown 源码。
 *
 * 注意：序列化结果不保证与输入逐字节相同（Markdown 语法有多种等价写法），
 * 真正的要求是「再次解析后结构等价」——这由 round-trip 测试保证。
 *
 * 序列化必须用**与解析同一个**处理器：否则 `singleDollarTextMath` 一开一关，
 * 往返就会把行内公式的定界符形式改掉。
 */
export function stringifyMarkdown(tree: MarkdownAst, options: ParseOptions = {}): string {
  return getProcessor(options).stringify(tree);
}

/** 解析 → 序列化，往返一次 */
export function roundTrip(source: string, options: ParseOptions = {}): string {
  return stringifyMarkdown(parseMarkdown(source, options), options);
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

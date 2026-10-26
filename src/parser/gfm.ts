/**
 * GFM 的**可拆分**组装。
 *
 * ## 为什么不用 `remark-gfm`
 *
 * `remark-gfm` 是一次性挂上五样东西：
 * 自动链接字面量、脚注、删除线、表格、任务列表。
 * **没有单独的开关**——想关掉「表格」，就只能把整个 GFM 拆开自己装。
 *
 * 而设置面板里恰好有「表格」「任务列表」「脚注」三个独立开关。
 *
 * ## 为什么拆开是零成本的
 *
 * 这五样东西本来就是 `remark-gfm` 的**传递依赖**，早就在 pnpm store 里了：
 *
 * ```
 * micromark-extension-gfm-{autolink-literal,footnote,strikethrough,table,task-list-item}
 * mdast-util-gfm-{autolink-literal,footnote,strikethrough,table,task-list-item}
 * ```
 *
 * 把它们提升为**直接依赖**即可（`pnpm add` 报 `downloaded 0`），
 * 不下载任何新包，许可证也还是同一批 MIT。
 *
 * ## 顺序不能改
 *
 * `remark-gfm` 挂载的顺序是
 * 自动链接 → 脚注 → 删除线 → 表格 → 任务列表，
 * 这里**原样照抄**。micromark 的 text 构造是按顺序叠加的，
 * 换顺序会改变某些输入的判定（例如 `(` 到底是脚注引用还是普通括号）。
 *
 * ## 一处必须保留的选项
 *
 * `remark-gfm` 默认 `singleTilde: true`（单个 `~` 也算删除线），
 * 而 Inkstone 必须关掉它——理由见 `markdown.ts` 里那段长注释。
 * 拆开之后这个选项要**自己传**给 `gfmStrikethrough`。
 */

import { gfmAutolinkLiteral } from "micromark-extension-gfm-autolink-literal";
import { gfmFootnote } from "micromark-extension-gfm-footnote";
import { gfmStrikethrough } from "micromark-extension-gfm-strikethrough";
import { gfmTable } from "micromark-extension-gfm-table";
import { gfmTaskListItem } from "micromark-extension-gfm-task-list-item";
import { gfmAutolinkLiteralFromMarkdown } from "mdast-util-gfm-autolink-literal";
import { gfmFootnoteFromMarkdown } from "mdast-util-gfm-footnote";
import { gfmStrikethroughFromMarkdown } from "mdast-util-gfm-strikethrough";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
import { gfmTaskListItemFromMarkdown } from "mdast-util-gfm-task-list-item";
import { gfmAutolinkLiteralToMarkdown } from "mdast-util-gfm-autolink-literal";
import { gfmFootnoteToMarkdown } from "mdast-util-gfm-footnote";
import { gfmStrikethroughToMarkdown } from "mdast-util-gfm-strikethrough";
import { gfmTableToMarkdown } from "mdast-util-gfm-table";
import { gfmTaskListItemToMarkdown } from "mdast-util-gfm-task-list-item";
import type { Plugin } from "unified";
import type { Root } from "mdast";
import type { MarkdownFeatures } from "./features";
import { mountAll, type ExtensionMounts } from "./extensions";

/** 三组扩展 */
export interface GfmParts {
  micromarkExtensions: unknown[];
  fromMarkdownExtensions: unknown[];
  toMarkdownExtensions: unknown[];
}

/**
 * 按开关组装 GFM 的三组扩展。
 *
 * 始终开启的：自动链接字面量、删除线。
 * 可开关的：脚注（`features.footnotes`）、表格（`features.tables`）、
 * 任务列表（`features.taskLists`）。
 */
export function gfmParts(features: MarkdownFeatures): GfmParts {
  const micromarkExtensions: unknown[] = [];
  const fromMarkdownExtensions: unknown[] = [];
  const toMarkdownExtensions: unknown[] = [];

  // 顺序与 remark-gfm 一致，理由见文件头。

  // 自动链接字面量：`www.example.com` 自动变成链接。没有开关。
  micromarkExtensions.push(gfmAutolinkLiteral());
  fromMarkdownExtensions.push(gfmAutolinkLiteralFromMarkdown());
  toMarkdownExtensions.push(gfmAutolinkLiteralToMarkdown());

  // 脚注：`[^1]` / `[^1]:`
  if (features.footnotes) {
    micromarkExtensions.push(gfmFootnote());
    fromMarkdownExtensions.push(gfmFootnoteFromMarkdown());
    toMarkdownExtensions.push(gfmFootnoteToMarkdown());
  }

  // 删除线：`~~文本~~`
  // `singleTilde: false` 是**必须**的：单个 `~` 不算删除线
  // （GFM 规范本来就不允许，是 github.com 的宽松行为；Typora 的 `~x~` 是下标）。
  micromarkExtensions.push(gfmStrikethrough({ singleTilde: false }));
  fromMarkdownExtensions.push(gfmStrikethroughFromMarkdown());
  toMarkdownExtensions.push(gfmStrikethroughToMarkdown());

  // 表格：`| a | b |`
  if (features.tables) {
    micromarkExtensions.push(gfmTable());
    fromMarkdownExtensions.push(gfmTableFromMarkdown());
    toMarkdownExtensions.push(gfmTableToMarkdown());
  }

  // 任务列表：`- [ ]` / `- [x]`
  if (features.taskLists) {
    micromarkExtensions.push(gfmTaskListItem());
    fromMarkdownExtensions.push(gfmTaskListItemFromMarkdown());
    toMarkdownExtensions.push(gfmTaskListItemToMarkdown());
  }

  return { micromarkExtensions, fromMarkdownExtensions, toMarkdownExtensions };
}

/**
 * remark 插件：按开关挂载 GFM 的三组扩展。
 *
 * 为什么不直接 `.use(remarkGfm)`：它五样一起挂，没有开关。
 * 这里是同一套东西的**可拆版**。
 */
export const remarkGfmParts: Plugin<[MarkdownFeatures], Root> = function remarkGfmParts(
  features,
) {
  const data = this.data() as unknown as ExtensionMounts;
  const parts = gfmParts(features);
  mountAll(data, "micromarkExtensions", parts.micromarkExtensions);
  mountAll(data, "fromMarkdownExtensions", parts.fromMarkdownExtensions);
  mountAll(data, "toMarkdownExtensions", parts.toMarkdownExtensions);
};

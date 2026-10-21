/**
 * turndown-plugin-gfm 没有自带类型声明，补一个最小可用的。
 *
 * 只声明我们真正用到的那几个导出，其余不管。
 */
declare module "turndown-plugin-gfm" {
  import type TurndownService from "turndown";

  /** 一次装上全部 GFM 规则（表格、删除线、任务列表、高亮代码块） */
  export function gfm(service: TurndownService): void;
  export function highlightedCodeBlock(service: TurndownService): void;
  export function strikethrough(service: TurndownService): void;
  export function tables(service: TurndownService): void;
  export function taskListItems(service: TurndownService): void;
}

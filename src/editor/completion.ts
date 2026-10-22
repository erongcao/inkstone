/**
 * 补全总装配。
 *
 * 一个 CM6 扩展只能有**一个** `completionConfig`，所以所有补全源必须在这里汇合，
 * 不能各装各的（后装的会覆盖前面的）。
 *
 * ## `override` 必须是数组
 *
 * ```js
 * let sources = conf.override || state.languageDataAt("autocomplete", cur(state)).map(asSource);
 * ```
 *
 * `override: null` 是「**不覆盖**」——会退回语言级补全数据，
 * 而 Markdown 没有语言级补全数据，拿到空数组，等于把唯一能用的源也关了。
 * 要换掉 CM6 自带的几套源（语言数据 / 路径 / 变量名），必须给数组。
 */

import { autocompletion } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { emojiCompletion, EMOJI_OPTION_CLASS, EMOJI_OPTION_TYPE } from "./emoji";
import { slashMenuCompletion, SLASH_OPTION_TYPE } from "./slash-menu";

/** 一次最多渲染多少条（emoji 有 40 条，斜杠菜单不到 40，取个够用的值） */
const MAX_RENDERED = 40;

/**
 * 补全源清单。
 *
 * 顺序不影响结果排序（各源自己排序，`filter: false` 时按源给出的顺序拼接），
 * 但**触发条件互斥**是刻意保持的：Emoji 要 `:`，斜杠菜单要行首 `/`，
 * 同一时刻只可能有一个源命中。
 */
const SOURCES = [emojiCompletion, slashMenuCompletion];

export function inkstoneAutocomplete(): Extension {
  return autocompletion({
    override: SOURCES,
    activateOnTyping: true,
    optionClass: (option) =>
      option.type === EMOJI_OPTION_TYPE
        ? EMOJI_OPTION_CLASS
        : option.type === SLASH_OPTION_TYPE
          ? "ink-slash-option"
          : "",
    maxRenderedOptions: MAX_RENDERED,
    /**
     * 设为 0：默认 100 ms。
     *
     * 两个源都用了 `filter: false`（也就都没有 `validFor`，见各源的说明），
     * CM6 每敲一个字符都会把上一个结果打回 Pending、重新查一遍源，
     * 这期间弹层是 `disabled`（发灰）的。源本身是同步的、1 ms 内就有结果，
     * 没必要为此发灰 100 ms。
     */
    activateOnTypingDelay: 0,
  });
}

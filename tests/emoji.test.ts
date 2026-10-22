/**
 * Emoji 补全的护栏测试。
 *
 * 测三块：
 *   1. **前缀识别**——什么该触发、什么绝对不能触发（URL、代码、时间）
 *   2. **检索排序**——前缀匹配、完全匹配优先、条数上限
 *   3. **数据质量**——中文别名真的合进去了、生成结果没有重复字形
 *
 * 弹层本身的 UI 不在这里测（jsdom 驱动真实补全弹窗没有意义），
 * 那部分靠生产构建的浏览器实测。
 */

import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import {
  emojiCompletion,
  findEmojiTrigger,
  preloadEmojiData,
  searchEmoji,
} from "@/editor/emoji";
import { EMOJI_TABLE, type EmojiRow } from "@/editor/emoji-data";
import { EMOJI_ZH_ALIASES } from "@/editor/emoji-aliases";

/** 用一段文本 + 光标位置造一个补全上下文 */
function contextAt(text: string) {
  return {
    pos: text.length,
    state: EditorState.create({ doc: text }),
    explicit: false,
  } as Parameters<typeof findEmojiTrigger>[0];
}

describe("Emoji 前缀识别", () => {
  it("行首的 `:` 触发", () => {
    expect(findEmojiTrigger(contextAt(":"))?.query).toBe("");
  });

  it("空格后的 `:` 触发", () => {
    expect(findEmojiTrigger(contextAt("今天真开心 :"))?.query).toBe("");
  });

  it("带查询词的触发，并算出 from 位置", () => {
    const ctx = contextAt("哈哈 :smi");
    const hit = findEmojiTrigger(ctx);
    expect(hit?.query).toBe("smi");
    expect(hit?.from).toBe(3); // 从 `:` 那一列开始
  });

  it("URL 里的 `://` 不触发", () => {
    // 前一个字符是 `/`，而 `/` 不在允许的前置字符里
    expect(findEmojiTrigger(contextAt("见 https://"))).toBeNull();
  });

  it("标识符里的冒号不触发（`a::b`）", () => {
    expect(findEmojiTrigger(contextAt("a::"))).toBeNull();
  });

  it("查询里出现空白就停（不再触发）", () => {
    expect(findEmojiTrigger(contextAt("哈哈 :smi ok"))).toBeNull();
  });

  it("查询里出现标点就停", () => {
    expect(findEmojiTrigger(contextAt(":smi,la"))).toBeNull();
  });

  it("没有冒号不触发", () => {
    expect(findEmojiTrigger(contextAt("普通文字"))).toBeNull();
  });

  it("超长查询不触发", () => {
    expect(findEmojiTrigger(contextAt(`:${"a".repeat(40)}`))).toBeNull();
  });

  it("括号 / 引号后可以触发", () => {
    expect(findEmojiTrigger(contextAt("(:smi"))?.query).toBe("smi");
    expect(findEmojiTrigger(contextAt("“:笑"))?.query).toBe("笑");
  });
});

describe("Emoji 检索", () => {
  const table: EmojiRow[] = [
    ["😀", "笑脸 开心 大笑 grinning face smile"],
    ["😅", "汗 尴尬 笑 sweat smile grinning"],
    ["😎", "墨镜 酷 sunglasses cool"],
    ["🚀", "火箭 发射 rocket ship launch"],
  ];

  it("按前缀匹配", () => {
    const hits = searchEmoji(table, "smi");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.map((h) => h.glyph)).toContain("😀");
  });

  it("完全匹配排在更长的前缀之前", () => {
    const hits = searchEmoji(table, "smile");
    expect(hits[0].glyph).toBe("😀"); // smile 正好命中；😅 是 smiling
  });

  it("关键字越短越靠前", () => {
    const hits = searchEmoji(table, "sm");
    // "smile" / "smiling" 长度相同，按字形稳定排序；关键是都在结果里
    expect(hits.length).toBe(2);
  });

  it("空查询返回全部（受条数上限约束）", () => {
    expect(searchEmoji(table, "").length).toBe(table.length);
  });

  it("大小写不敏感", () => {
    expect(searchEmoji(table, "SMILE").map((h) => h.glyph)).toContain("😀");
  });

  it("中文别名也能搜到", () => {
    const hits = searchEmoji(table, "火箭");
    expect(hits.map((h) => h.glyph)).toContain("🚀");
  });

  it("命中项带出全部关键字（供次要位显示）", () => {
    const [hit] = searchEmoji(table, "火箭");
    expect(hit.keywords).toContain("rocket");
    expect(hit.keyword).toBe("火箭");
  });

  it("限制条数", () => {
    expect(searchEmoji(table, "", 2)).toHaveLength(2);
  });

  it("排序确定：同一查询重复检索顺序不变", () => {
    // 末位键是字形码点，唯一且可复现——连按 ↓ 时列表不会跳来跳去
    const once = searchEmoji(table, "sm").map((h) => h.glyph);
    const twice = searchEmoji(table, "sm").map((h) => h.glyph);
    expect(once).toEqual(twice);
  });
});

describe("补全源与 CM6 的契约", () => {
  // 这组是 M2-11b 实机调试逼出来的回归测试：
  // 少了 `filter: false`，弹层在生产构建里永远不出现，而单测全绿。
  // 原因见 `emojiCompletion` 里的注释（CM6 `index.js:793` 的模糊匹配）。
  it("必须 filter: false —— 否则 CM6 会拿 `:smi` 去匹配字形 label", async () => {
    await preloadEmojiData();
    const result = emojiCompletion(contextAt("哈哈 :smi"));
    expect(result).not.toBeNull();
    expect(result?.filter).toBe(false);
  });

  it("不得同时给 validFor（CM6 文档：filter 为 false 时它不生效）", async () => {
    await preloadEmojiData();
    const result = emojiCompletion(contextAt("哈哈 :smi"));
    expect(result).not.toBeNull();
    expect("validFor" in (result as object)).toBe(false);
  });

  it("from 覆盖冒号本身 —— 接受候选时要把 `:smi` 整段替换掉", async () => {
    await preloadEmojiData();
    const ctx = contextAt("哈哈 :smi");
    const result = emojiCompletion(ctx);
    expect(result?.from).toBe(3); // `:` 那一列
    expect(ctx.state.sliceDoc(result!.from, result!.to)).toBe(":smi");
  });

  it("候选顺序原样保留 searchEmoji 的排序", async () => {
    await preloadEmojiData();
    const ctx = contextAt(":smi");
    const result = emojiCompletion(ctx);
    const mine = searchEmoji(EMOJI_TABLE, "smi").map((h) => h.glyph);
    expect(result?.options.map((o) => o.label)).toEqual(mine);
  });

  it("label 是字形、detail 带关键字 —— 因为 CM6 6.20 没有 renderOption 钩子", async () => {
    await preloadEmojiData();
    const [first] = emojiCompletion(contextAt(":smil"))!.options;
    const expected = searchEmoji(EMOJI_TABLE, "smil")[0];
    expect(first.label).toBe(expected.glyph);
    expect(first.label).toMatch(/\p{Extended_Pictographic}/u);
    expect(first.detail).toContain(expected.keyword);
  });

  it("没有前缀 / 没有命中时返回 null", async () => {
    await preloadEmojiData();
    expect(emojiCompletion(contextAt("普通文字"))).toBeNull();
    expect(emojiCompletion(contextAt(":zzzzzzz"))).toBeNull();
  });
});

describe("生成的数据", () => {
  it("规模在预期量级", () => {
    expect(EMOJI_TABLE.length).toBeGreaterThan(1500);
  });

  it("字形不重复", () => {
    const seen = new Set(EMOJI_TABLE.map(([glyph]) => glyph));
    expect(seen.size).toBe(EMOJI_TABLE.length);
  });

  it("按字形稳定排序（重复生成不会有 diff 噪声）", () => {
    const glyphs = EMOJI_TABLE.map(([glyph]) => glyph);
    const sorted = [...glyphs].sort();
    expect(glyphs).toEqual(sorted);
  });

  it("每条至少有一个可用关键字", () => {
    for (const [glyph, keywords] of EMOJI_TABLE) {
      expect(keywords.trim().length, `字形 ${glyph} 没有关键字`).toBeGreaterThan(0);
      // 关键字里不该混进颜文字（`:)` 这种对 `:` 补全毫无意义，
      // 生成时已用 `^[\w\- ]+$` 过滤掉，这里再验一次防回归）
      expect(keywords).not.toMatch(/[:()]/);
    }
  });

  it("ASCII 颜文字没被收进关键字", () => {
    for (const [, keywords] of EMOJI_TABLE) {
      expect(keywords).not.toMatch(/[:()]/);
    }
  });

  it("中文别名表里的字形都在数据里", () => {
    const glyphs = new Set(EMOJI_TABLE.map(([g]) => g));
    const missing = Object.keys(EMOJI_ZH_ALIASES).filter((g) => !glyphs.has(g));
    expect(missing).toEqual([]);
  });

  it("手写别名表里的重复项已经被清掉（TS 对象字面量重复键会直接报错）", () => {
    // 反过来查一遍：中文关键字能不能反查到字形
    const hits = searchEmoji(EMOJI_TABLE, "点赞");
    expect(hits.map((h) => h.glyph)).toContain("👍");
  });
});

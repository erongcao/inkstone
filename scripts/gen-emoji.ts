/**
 * 生成 `src/editor/emoji-data.ts`。
 *
 * ## 为什么要生成而不是直接依赖 emojilib
 *
 * `emojilib` 的完整数据是 1800+ 条、JSON 形态，直接打进主 chunk 会让冷启动多几十 KB。
 * 但它**只用于生成**，不进入运行时依赖——生成结果是纯数据，提交进仓库：
 *   - 运行时零依赖（应用体积不涨）
 *   - 数据可审计（提交进 git，能 diff、能 review）
 *
 * 重新生成：`pnpm gen:emoji`
 *
 * ## 中文关键词从哪来
 *
 * `emojilib` 只有英文 CLDR 关键字。中文搜索靠 `EMOJI_ZH_ALIASES` 里那份手写表
 * （覆盖高频 emoji）。不全，但比没有强；想扩就往那张表里加。
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import emojilib from "emojilib";
import { EMOJI_ZH_ALIASES } from "../src/editor/emoji-aliases";

const here = dirname(fileURLToPath(import.meta.url));
const outFile = resolve(here, "../src/editor/emoji-data.ts");

interface EmojiEntry {
  glyph: string;
  keywords: string[];
}

function loadEntries(): EmojiEntry[] {
  const lib = emojilib as unknown as Record<string, unknown>;
  const source = (lib.default ?? lib) as Record<string, string[]>;
  const out: EmojiEntry[] = [];
  for (const [glyph, keywords] of Object.entries(source)) {
    if (!Array.isArray(keywords)) continue;
    out.push({ glyph, keywords: keywords.filter((k) => typeof k === "string") });
  }
  return out;
}

/** 把 ASCII 颜文字关键字（如 `:)`）剔掉——它们根本不是 `:` 补全的候选 */
function isUsableKeyword(keyword: string): boolean {
  if (!keyword || keyword.length > 32) return false;
  // 只留下「像词」的：字母、数字、下划线、连字符、空格
  return /^[\w\- ]+$/.test(keyword);
}

function build(): void {
  const entries = loadEntries()
    .map((entry) => {
      const zh = EMOJI_ZH_ALIASES[entry.glyph] ?? [];
      const keywords = [...new Set([...zh, ...entry.keywords.filter(isUsableKeyword)])];
      return { glyph: entry.glyph, keywords };
    })
    .filter((entry) => entry.keywords.length > 0)
    // 稳定排序：glyph 按码位，保证重复生成的结果一致（否则 diff 全是噪声）
    .sort((a, b) => (a.glyph < b.glyph ? -1 : a.glyph > b.glyph ? 1 : 0));

  const rows = entries
    .map(
      (e) => `  [${JSON.stringify(e.glyph)}, ${JSON.stringify(e.keywords.join(" "))}],`,
    )
    .join("\n");

  const header = `/**
 * Emoji 检索数据 —— **由 \`scripts/gen-emoji.ts\` 生成，请勿手改**。
 *
 * 重新生成：\`pnpm gen:emoji\`
 *
 * 格式：\`[字形, "关键字1 关键字2 …"]\`，关键字已小写、空格分隔。
 * 用元组而不是对象，是为了让生成结果尽可能小（1800+ 条的数据量下差别很明显）。
 *
 * 数据来源：emojilib（MIT）提供的 CLDR 英文关键字，
 * 中文关键字来自 \`emoji-aliases.ts\` 里手写的别名表。
 */

/** \`[字形, "关键字1 关键字2 …"]\` */
export type EmojiRow = readonly [glyph: string, keywords: string];

export const EMOJI_TABLE: readonly EmojiRow[] = [
${rows}
];
`;

  writeFileSync(outFile, header, "utf8");
  const bytes = Buffer.byteLength(header, "utf8");
  console.log(
    `已写入 ${outFile}\n  条目 ${entries.length}，体积 ${(bytes / 1024).toFixed(1)} KB`,
  );
}

build();

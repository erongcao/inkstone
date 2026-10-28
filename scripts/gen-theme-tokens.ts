/**
 * 从主题 CSS 生成导出用的令牌表。
 *
 * ## 为什么是「生成」而不是「手写」
 *
 * 导出的 HTML 要内联一份主题令牌（颜色 + 字体）——
 * 导出物是**单个 .html 文件**，不能依赖 Vite 的 CSS 管线。
 *
 * 于是令牌有了**两份**：
 *
 *   - `src/styles/tokens.css` + `src/themes/*.css` —— 应用内的真相源
 *   - `src/export/html.ts` 里手写的那张表 —— 导出链路的真相源
 *
 * 两份真相源**永远不会互相提醒**。实测（2026-10-28）：
 * `academic` 主题的配色在两边**完全不同**——
 * 应用里是蓝调（accent `#1a5fb4`、背景 `#fdfdfc`），
 * 导出里是暗红调（accent `#7a2e2e`、背景 `#ffffff`），
 * 连字体都不同（应用是衬线体，导出是无衬线）。
 *
 * 结果：用户用「学术写作」主题写完，导出的文件**看着像另一个主题**——
 * 直接违反架构约束 C（屏幕与导出必须一致）。
 *
 * 生成之后，**令牌只有一份**（CSS 文件），导出用的表由它派生，
 * 漂移在结构上不再可能。
 *
 * ## 复现 CSS 的层叠
 *
 * 生成的表必须与应用内的实际效果一致，所以要复现三条规则：
 *
 * 1. **基础令牌**（`tokens.css` 的 `:root` 与 `[data-mode]`）对所有主题生效
 * 2. **主题令牌**（`themes/<主题>.css`）覆盖同名基础令牌
 * 3. `:root` 里的**字体**被主题的 `[data-theme="X"]` 块覆盖
 *    （学术主题就是靠这条换成衬线体的）
 *
 * 同一层里**后者覆盖前者**——与 CSS 的层叠一致。
 *
 * ## 用法
 *
 * ```bash
 * pnpm gen:theme-tokens           # 生成 / 更新
 * pnpm gen:theme-tokens -- --check  # 只校验是否最新（CI 用，不改工作区）
 * ```
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..");
const OUTPUT = resolve(ROOT, "src/export/theme-tokens.generated.ts");

/**
 * 基础令牌所在的文件。
 *
 * `tokens.css` 里的 `:root` 与 `[data-mode="…"]` 对**所有**主题生效，
 * 主题 CSS 只是覆盖其中的一部分。
 */
const BASE_FILE = "src/styles/tokens.css";

/** 主题 CSS 文件 → 主题 id */
const THEME_FILES: { file: string; theme: string }[] = [
  { file: "src/themes/github.css", theme: "github" },
  { file: "src/themes/academic.css", theme: "academic" },
];

/** 基础主题 id（对应 `tokens.css` 自己） */
const BASE_THEME = "inkstone-light";

/** 一个 CSS 块里抽出来的 `--ink-*` 声明 */
interface Block {
  /** "light" / "dark" / "base"（不带 data-mode 的块） */
  mode: "light" | "dark" | "base";
  /** 声明列表，保持源码顺序 */
  declarations: { name: string; value: string }[];
}

/**
 * 解析一个 CSS 文件里的所有 `--ink-*` 声明。
 *
 * 用受限的正则而不是 CSS 解析器：这些文件是我们自己写的，
 * 结构已知（没有嵌套规则），而引入依赖换不来什么。
 */
function parseFile(file: string, theme: string): Block[] {
  // 先剥注释——注释里可能有 `{` `}`，会把规则切碎
  const raw = readFileSync(resolve(ROOT, file), "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks: Block[] = [];

  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = rule.exec(raw)) !== null) {
    const selector = match[1].trim();
    const body = match[2];
    if (!body.includes("--ink-")) continue;

    // 选择器里带的 data-theme 必须与文件对应的主题一致——
    // 不一致说明文件被挪了位置或改名了，生成的结果会错配
    const declared = /data-theme="([^"]+)"/.exec(selector)?.[1];
    if (declared && declared !== theme) {
      throw new Error(
        `${file} 里出现了 data-theme="${declared}"，与预期的主题 "${theme}" 不符`,
      );
    }

    const modeMatch = /data-mode="(light|dark)"/.exec(selector);
    const mode: Block["mode"] = modeMatch ? (modeMatch[1] as "light" | "dark") : "base";

    const declarations: { name: string; value: string }[] = [];
    for (const decl of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      if (!decl[1].startsWith("--ink-")) continue;
      declarations.push({
        name: decl[1],
        // 值可能跨行（字体栈就是），压成一行再写出去
        value: decl[2].trim().replace(/\s+/g, " "),
      });
    }
    if (declarations.length > 0) blocks.push({ mode, declarations });
  }

  return blocks;
}

/**
 * 合并两组声明：后者覆盖前者（与 CSS 层叠一致）。
 *
 * 覆盖时**保留原位置**——CSS 里同名的自定义属性只生效一次，
 * 位置不影响结果，但保留位置能让生成的文件读起来像原来的 CSS。
 */
function merge(
  base: { name: string; value: string }[],
  override: { name: string; value: string }[],
): { name: string; value: string }[] {
  const merged = base.map((d) => ({ ...d }));
  const index = new Map(merged.map((d, i) => [d.name, i]));
  for (const decl of override) {
    const at = index.get(decl.name);
    if (at === undefined) {
      index.set(decl.name, merged.length);
      merged.push({ ...decl });
    } else {
      merged[at] = { ...decl };
    }
  }
  return merged;
}

/**
 * 取某个块里的某类声明。
 *
 * `names` 为空 = **全部**（颜色块就是这种情况）。
 */
function pick(
  blocks: Block[],
  mode: Block["mode"],
  names: string[],
): { name: string; value: string }[] {
  return blocks
    .filter((b) => b.mode === mode)
    .flatMap((b) => b.declarations)
    .filter((d) => names.length === 0 || names.includes(d.name));
}

/** 把声明列表写成 CSS 文本 */
function toCss(declarations: { name: string; value: string }[], indent = "  "): string {
  return declarations.map((d) => `${indent}${d.name}: ${d.value};`).join("\n");
}

/** 生成主题表 */
function build(): string {
  const baseBlocks = parseFile(BASE_FILE, BASE_THEME);
  const baseFonts = pick(baseBlocks, "base", ["--ink-font-family", "--ink-mono-family"]);

  const themes: string[] = [];
  const fonts: string[] = [];

  // 基础主题（tokens.css 自己）
  const baseLight = pick(baseBlocks, "light", []);
  const baseDark = pick(baseBlocks, "dark", []);
  themes.push(
    `  "${BASE_THEME}": {\n` +
      `    light: \`${toCss(baseLight)}\`,\n` +
      `    dark: \`${toCss(baseDark)}\`,\n` +
      `  },`,
  );
  fonts.push(`  "${BASE_THEME}": \`${toCss(baseFonts)}\`,`);

  for (const { file, theme } of THEME_FILES) {
    const blocks = parseFile(file, theme);
    const light = merge(baseLight, pick(blocks, "light", []));
    const dark = merge(baseDark, pick(blocks, "dark", []));
    // 主题的字体块覆盖基础字体（学术主题的衬线体就是这么来的）
    const fontDecls = merge(baseFonts, pick(blocks, "base", []));

    themes.push(
      `  ${theme}: {\n` +
        `    light: \`${toCss(light)}\`,\n` +
        `    dark: \`${toCss(dark)}\`,\n` +
        `  },`,
    );
    fonts.push(`  ${theme}: \`${toCss(fontDecls)}\`,`);
  }

  return `/**
 * 主题令牌 —— **本文件由 \`scripts/gen-theme-tokens.ts\` 生成，请勿手改**。
 *
 * 来源：\`${BASE_FILE}\` 与 \`src/themes/*.css\`（应用内的真相源）。
 * 改了主题 CSS 之后运行 \`pnpm gen:theme-tokens\` 更新这份表。
 *
 * 生成的原因见脚本的文件头：手抄一份必然漂移，
 * 而漂移的代价是「导出的文件看着像另一个主题」。
 */

/** 每个主题的亮 / 暗两套令牌（CSS 声明文本） */
export const THEME_TOKENS: Record<string, { light: string; dark: string }> = {
${themes.join("\n")}
};

/** 每个主题的字体栈（基础字体被主题的 \`[data-theme]\` 块覆盖） */
export const THEME_FONTS: Record<string, string> = {
${fonts.join("\n")}
};
`;
}

const content = build();

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(OUTPUT, "utf-8");
  } catch {
    console.error(`❌ ${OUTPUT} 不存在，请先运行 pnpm gen:theme-tokens`);
    process.exit(1);
  }
  if (current !== content) {
    console.error(
      "❌ src/export/theme-tokens.generated.ts 已过期，请运行 pnpm gen:theme-tokens",
    );
    process.exit(1);
  }
  console.log("✅ src/export/theme-tokens.generated.ts 与主题 CSS 一致");
} else {
  writeFileSync(OUTPUT, content, "utf-8");
  const themes = (content.match(/^ {2}"?[\w-]+"?: \{$/gm) ?? []).length;
  console.log(`✅ 已生成 ${OUTPUT}（${themes} 个主题）`);
}

/**
 * 主题令牌 —— **本文件由 `scripts/gen-theme-tokens.ts` 生成，请勿手改**。
 *
 * 来源：`src/styles/tokens.css` 与 `src/themes/*.css`（应用内的真相源）。
 * 改了主题 CSS 之后运行 `pnpm gen:theme-tokens` 更新这份表。
 *
 * 生成的原因见脚本的文件头：手抄一份必然漂移，
 * 而漂移的代价是「导出的文件看着像另一个主题」。
 */

/** 每个主题的亮 / 暗两套令牌（CSS 声明文本） */
export const THEME_TOKENS: Record<string, { light: string; dark: string }> = {
  "inkstone-light": {
    light: `  --ink-bg: #ffffff;
  --ink-bg-soft: #f6f8fa;
  --ink-bg-inset: #eaeef2;
  --ink-fg: #1f2328;
  --ink-fg-muted: #59636e;
  --ink-fg-faint: #8c959f;
  --ink-border: #d1d9e0;
  --ink-border-strong: #afb8c1;
  --ink-accent: #0969da;
  --ink-accent-hover: #0550ae;
  --ink-selection: rgba(9, 105, 218, 0.15);
  --ink-accent-soft: #ddf4ff;
  --ink-highlight-bg: #fff3b8;
  --ink-code-bg: #f6f8fa;
  --ink-code-fg: #1f2328;
  --ink-code-border: #d1d9e0;
  --ink-code-comment: #6e7781;
  --ink-code-keyword: #cf222e;
  --ink-code-string: #0a3069;
  --ink-code-number: #0550ae;
  --ink-code-function: #8250df;
  --ink-code-type: #953800;
  --ink-code-variable: #24292f;
  --ink-code-punctuation: #57606a;
  --ink-code-tag: #116329;
  --ink-code-attr: #0550ae;
  --ink-code-regex: #116329;
  --ink-code-deleted: #82071e;
  --ink-code-inserted: #116329;
  --ink-danger: #cf222e;
  --ink-danger-bg: #ffebe9;
  --ink-quote-border: #d1d9e0;
  --ink-quote-fg: #59636e;
  --ink-mark-bg: #fff8c5;
  --ink-mark-fg: #1f2328;
  --ink-table-border: #d1d9e0;
  --ink-table-header-bg: #f6f8fa;
  --ink-table-stripe-bg: #f6f8fa;
  --ink-shadow-sm: 0 1px 2px rgba(31, 35, 40, 0.08);
  --ink-shadow-md: 0 4px 16px rgba(31, 35, 40, 0.12);`,
    dark: `  --ink-bg: #0d1117;
  --ink-bg-soft: #161b22;
  --ink-bg-inset: #010409;
  --ink-fg: #e6edf3;
  --ink-fg-muted: #9198a1;
  --ink-fg-faint: #6e7681;
  --ink-border: #30363d;
  --ink-border-strong: #444c56;
  --ink-accent: #4493f8;
  --ink-accent-hover: #58a6ff;
  --ink-selection: rgba(68, 147, 248, 0.25);
  --ink-accent-soft: #121d2f;
  --ink-highlight-bg: #4a3c0a;
  --ink-code-bg: #161b22;
  --ink-code-fg: #e6edf3;
  --ink-code-border: #30363d;
  --ink-code-comment: #8b949e;
  --ink-code-keyword: #ff7b72;
  --ink-code-string: #a5d6ff;
  --ink-code-number: #79c0ff;
  --ink-code-function: #d2a8ff;
  --ink-code-type: #ffa657;
  --ink-code-variable: #e6edf3;
  --ink-code-punctuation: #8b949e;
  --ink-code-tag: #7ee787;
  --ink-code-attr: #79c0ff;
  --ink-code-regex: #7ee787;
  --ink-code-deleted: #ffdcd7;
  --ink-code-inserted: #aff5b4;
  --ink-danger: #ff7b72;
  --ink-danger-bg: #490202;
  --ink-quote-border: #3d444d;
  --ink-quote-fg: #9198a1;
  --ink-mark-bg: rgba(187, 128, 9, 0.4);
  --ink-mark-fg: #e6edf3;
  --ink-table-border: #30363d;
  --ink-table-header-bg: #161b22;
  --ink-table-stripe-bg: #12181f;
  --ink-shadow-sm: 0 1px 2px rgba(1, 4, 9, 0.6);
  --ink-shadow-md: 0 4px 16px rgba(1, 4, 9, 0.7);`,
  },
  github: {
    light: `  --ink-bg: #ffffff;
  --ink-bg-soft: #f6f8fa;
  --ink-bg-inset: #eff2f5;
  --ink-fg: #1f2328;
  --ink-fg-muted: #59636e;
  --ink-fg-faint: #818b98;
  --ink-border: #d1d9e0;
  --ink-border-strong: #afb8c1;
  --ink-accent: #0969da;
  --ink-accent-hover: #0550ae;
  --ink-selection: rgba(9, 105, 218, 0.15);
  --ink-accent-soft: #ddf4ff;
  --ink-highlight-bg: #fff3b8;
  --ink-code-bg: #f6f8fa;
  --ink-code-fg: #1f2328;
  --ink-code-border: #d1d9e0;
  --ink-code-comment: #6e7781;
  --ink-code-keyword: #cf222e;
  --ink-code-string: #0a3069;
  --ink-code-number: #0550ae;
  --ink-code-function: #8250df;
  --ink-code-type: #953800;
  --ink-code-variable: #24292f;
  --ink-code-punctuation: #57606a;
  --ink-code-tag: #116329;
  --ink-code-attr: #0550ae;
  --ink-code-regex: #116329;
  --ink-code-deleted: #82071e;
  --ink-code-inserted: #116329;
  --ink-danger: #cf222e;
  --ink-danger-bg: #ffebe9;
  --ink-quote-border: #d1d9e0;
  --ink-quote-fg: #59636e;
  --ink-mark-bg: #fff8c5;
  --ink-mark-fg: #1f2328;
  --ink-table-border: #d1d9e0;
  --ink-table-header-bg: #f6f8fa;
  --ink-table-stripe-bg: #f6f8fa;
  --ink-shadow-sm: 0 1px 2px rgba(31, 35, 40, 0.08);
  --ink-shadow-md: 0 4px 16px rgba(31, 35, 40, 0.12);`,
    dark: `  --ink-bg: #0d1117;
  --ink-bg-soft: #161b22;
  --ink-bg-inset: #010409;
  --ink-fg: #e6edf3;
  --ink-fg-muted: #9198a1;
  --ink-fg-faint: #6e7681;
  --ink-border: #30363d;
  --ink-border-strong: #444c56;
  --ink-accent: #4493f8;
  --ink-accent-hover: #58a6ff;
  --ink-selection: rgba(68, 147, 248, 0.25);
  --ink-accent-soft: #121d2f;
  --ink-highlight-bg: #4a3c0a;
  --ink-code-bg: #161b22;
  --ink-code-fg: #e6edf3;
  --ink-code-border: #30363d;
  --ink-code-comment: #8b949e;
  --ink-code-keyword: #ff7b72;
  --ink-code-string: #a5d6ff;
  --ink-code-number: #79c0ff;
  --ink-code-function: #d2a8ff;
  --ink-code-type: #ffa657;
  --ink-code-variable: #e6edf3;
  --ink-code-punctuation: #8b949e;
  --ink-code-tag: #7ee787;
  --ink-code-attr: #79c0ff;
  --ink-code-regex: #7ee787;
  --ink-code-deleted: #ffdcd7;
  --ink-code-inserted: #aff5b4;
  --ink-danger: #ff7b72;
  --ink-danger-bg: #490202;
  --ink-quote-border: #3d444d;
  --ink-quote-fg: #9198a1;
  --ink-mark-bg: rgba(187, 128, 9, 0.4);
  --ink-mark-fg: #e6edf3;
  --ink-table-border: #30363d;
  --ink-table-header-bg: #161b22;
  --ink-table-stripe-bg: #12181f;
  --ink-shadow-sm: 0 1px 2px rgba(1, 4, 9, 0.6);
  --ink-shadow-md: 0 4px 16px rgba(1, 4, 9, 0.7);`,
  },
  academic: {
    light: `  --ink-bg: #fdfdfc;
  --ink-bg-soft: #f4f4f1;
  --ink-bg-inset: #eaeae5;
  --ink-fg: #1a1a19;
  --ink-fg-muted: #55554f;
  --ink-fg-faint: #8a8a80;
  --ink-border: #dcdcd5;
  --ink-border-strong: #bcbcb2;
  --ink-accent: #1a5fb4;
  --ink-accent-hover: #134ba0;
  --ink-selection: rgba(26, 95, 180, 0.16);
  --ink-accent-soft: #ddf4ff;
  --ink-highlight-bg: #fff3b8;
  --ink-code-bg: #f4f4f1;
  --ink-code-fg: #2a2a27;
  --ink-code-border: #dcdcd5;
  --ink-code-comment: #6e7781;
  --ink-code-keyword: #cf222e;
  --ink-code-string: #0a3069;
  --ink-code-number: #0550ae;
  --ink-code-function: #8250df;
  --ink-code-type: #953800;
  --ink-code-variable: #24292f;
  --ink-code-punctuation: #57606a;
  --ink-code-tag: #116329;
  --ink-code-attr: #0550ae;
  --ink-code-regex: #116329;
  --ink-code-deleted: #82071e;
  --ink-code-inserted: #116329;
  --ink-danger: #cf222e;
  --ink-danger-bg: #ffebe9;
  --ink-quote-border: #b9c8de;
  --ink-quote-fg: #3f4a5a;
  --ink-mark-bg: #fdf3c8;
  --ink-mark-fg: #1a1a19;
  --ink-table-border: #dcdcd5;
  --ink-table-header-bg: #f4f4f1;
  --ink-table-stripe-bg: #fafaf8;
  --ink-shadow-sm: 0 1px 2px rgba(31, 35, 40, 0.08);
  --ink-shadow-md: 0 4px 16px rgba(31, 35, 40, 0.12);`,
    dark: `  --ink-bg: #1a1a19;
  --ink-bg-soft: #232322;
  --ink-bg-inset: #121211;
  --ink-fg: #e8e6e0;
  --ink-fg-muted: #a8a69e;
  --ink-fg-faint: #7d7b74;
  --ink-border: #373733;
  --ink-border-strong: #4d4d47;
  --ink-accent: #7aa2f7;
  --ink-accent-hover: #94b8ff;
  --ink-selection: rgba(122, 162, 247, 0.22);
  --ink-accent-soft: #121d2f;
  --ink-highlight-bg: #4a3c0a;
  --ink-code-bg: #232322;
  --ink-code-fg: #e8e6e0;
  --ink-code-border: #373733;
  --ink-code-comment: #8b949e;
  --ink-code-keyword: #ff7b72;
  --ink-code-string: #a5d6ff;
  --ink-code-number: #79c0ff;
  --ink-code-function: #d2a8ff;
  --ink-code-type: #ffa657;
  --ink-code-variable: #e6edf3;
  --ink-code-punctuation: #8b949e;
  --ink-code-tag: #7ee787;
  --ink-code-attr: #79c0ff;
  --ink-code-regex: #7ee787;
  --ink-code-deleted: #ffdcd7;
  --ink-code-inserted: #aff5b4;
  --ink-danger: #ff7b72;
  --ink-danger-bg: #490202;
  --ink-quote-border: #3f4a5a;
  --ink-quote-fg: #b6bcc7;
  --ink-mark-bg: rgba(199, 160, 40, 0.28);
  --ink-mark-fg: #e8e6e0;
  --ink-table-border: #373733;
  --ink-table-header-bg: #232322;
  --ink-table-stripe-bg: #1f1f1e;
  --ink-shadow-sm: 0 1px 2px rgba(1, 4, 9, 0.6);
  --ink-shadow-md: 0 4px 16px rgba(1, 4, 9, 0.7);`,
  },
};

/** 每个主题的字体栈（基础字体被主题的 `[data-theme]` 块覆盖） */
export const THEME_FONTS: Record<string, string> = {
  "inkstone-light": `  --ink-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
  --ink-mono-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;`,
  github: `  --ink-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
  --ink-mono-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;`,
  academic: `  --ink-font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Songti SC", "STSong", "Source Han Serif SC", "Noto Serif CJK SC", serif;
  --ink-mono-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;`,
};

/**
 * 应用设置的数据模型与默认值。
 *
 * 设计原则：
 * 1. 设置项分「外观 / 编辑 / Markdown / 导出 / 通用」五组，与 Typora 偏好面板的分类对齐，
 *    方便用户迁移心智。
 * 2. 所有设置都有确定的默认值，缺失时用默认值补齐（设置文件损坏也不应导致启动失败）。
 * 3. 设置持久化层与数据模型解耦（见 store.ts），后期换成 Tauri store / SQLite 不用改这里。
 */

/** 主题明暗模式 */
export type ColorMode = "light" | "dark" | "auto";

/** 字号档位（px） */
export const FONT_SIZE_PRESETS = [13, 14, 15, 16, 17, 18, 20, 22] as const;

/** 写作区宽度档位（rem） */
export const CONTENT_WIDTH_PRESETS = [36, 40, 44, 46, 50, 56, 64, 72] as const;

/**
 * 行内标记符的显示策略。
 *
 * 三种策略对应三个标杆产品（调研见 docs/editors-comparison.md）：
 *   - `live`   标记隐藏，光标进入才显露 —— Typora
 *   - `dimmed` 标记始终可见但弱化着色 —— Ulysses
 *   - `source` 纯源码，不做渲染 —— Typora 源码模式 / Bear 通用模式
 *
 * 三者共用同一份文档、同一套装饰器管线，切换只改装饰器策略，
 * 所以光标、滚动、撤销栈天然保持。
 */
export type MarkerDisplayMode = "live" | "dimmed" | "source";

export const MARKER_DISPLAY_MODES: { value: MarkerDisplayMode; label: string }[] = [
  { value: "live", label: "实时预览（Typora 式，标记隐藏）" },
  { value: "dimmed", label: "弱化显示（Ulysses 式，标记可见）" },
  { value: "source", label: "源码模式（纯 Markdown）" },
];

/**
 * 自动配对的级别。
 *
 * 分两级对齐 Typora 官方文档（support.typora.com.cn/Auto-Pair/）：
 *   - `basic`    只配对括号与引号：`(` `[` `{` `"` `'`
 *   - `markdown` 在 basic 之上追加 Markdown 符号：`` ` `` `*` `_` `$` `~` `=` `^`
 *
 * 之所以是三档而不是一个开关：basic 与 markdown 的手感差别明显，
 * 有人写技术文档时希望 `*` 原样输出（方便写乘法与通配符），
 * 那就该能单独关掉 Markdown 级、只留括号引号。
 */
export type AutoPairMode = "off" | "basic" | "markdown";

export const AUTO_PAIR_MODES: { value: AutoPairMode; label: string }[] = [
  { value: "off", label: "关闭" },
  { value: "basic", label: "括号与引号" },
  { value: "markdown", label: "Markdown 符号（含括号引号）" },
];

export interface AppearanceSettings {
  /** 主题 ID，对应 theme/themes.ts 的注册表 */
  theme: string;
  /** 明暗模式；auto 表示跟随系统 */
  colorMode: ColorMode;
  /** 正文排版字体族（CSS font-family 值） */
  fontFamily: string;
  /** 等宽字体族 */
  monoFontFamily: string;
  /** 正文字号（px） */
  fontSize: number;
  /** 行高倍数 */
  lineHeight: number;
  /** 写作区最大宽度（rem） */
  contentWidth: number;
  /** 页面背景色（CSS color），空字符串表示使用主题默认 */
  backgroundColor: string;
  /** 用户自定义 CSS 文件内容（内联注入） */
  customCss: string;
  /** 是否跟随系统自动切换明暗 */
  followSystemAppearance: boolean;
}

export interface EditorSettings {
  /** 行内标记符的显示策略 */
  markerDisplay: MarkerDisplayMode;
  /** 自动配对级别：off / basic / markdown */
  autoPairMode: AutoPairMode;
  /** 智能标点：自动引号/破折号 */
  smartPunctuation: boolean;
  /** 严格模式：按严格 CommonMark 解析 */
  strictMode: boolean;
  /** 缩进首行 */
  indentFirstLine: boolean;
  /** 段落续行缩进 */
  indentParagraph: boolean;
  /** 拼写检查 */
  spellCheck: boolean;
  /** 焦点模式 */
  focusMode: boolean;
  /** 打字机模式（当前行居中） */
  typewriterMode: boolean;
  /** 始终显示字数统计 */
  alwaysShowWordCount: boolean;
}

export interface MarkdownSettings {
  /** 行内数学 $...$ */
  inlineMath: boolean;
  /**
   * 行内公式是否把**单个** `$` 当作定界符。
   *
   * 直接透传给 remark-math 的 `singleDollarTextMath`（→ micromark-extension-math 的一等选项），
   * 所以**不是**编辑器自己加的启发式，语义层与导出天然一致。
   *
   * 关掉后（`false`，上游默认 `true`）：
   *   - `价格 $5 到 $10 元` 不再被误判成公式 —— 这是关它的**主要动机**
   *   - `$$x^2$$` 在行内**仍然**是行内公式，所以「关掉就没有行内公式」是不成立的
   *
   * 默认为开：调研的六个商业编辑器（Typora / VS Code / MarkText / Obsidian / GitHub）
   * 全部默认开启单 `$`，调研与实测见 AGENTS.md「行内公式定界符」。
   */
  inlineMathSingleDollar: boolean;
  /** 数学块 $$...$$ */
  blockMath: boolean;
  /** 数学公式自动编号 */
  autoNumberEquations: boolean;
  /** mhchem 化学扩展 */
  mhchem: boolean;
  /** Mermaid 图表 */
  mermaid: boolean;
  /** GitHub 风格 Alerts */
  githubAlerts: boolean;
  /** 脚注 */
  footnotes: boolean;
  /** 行内高亮 ==...== */
  highlight: boolean;
  /** 下标 / 上标 */
  subscriptSuperscript: boolean;
  /** YAML front matter */
  frontMatter: boolean;
  /** 表格 */
  tables: boolean;
  /** 任务列表 */
  taskLists: boolean;
}

export interface ExportSettings {
  /** 导出后打开所在文件夹 */
  openFolderAfterExport: boolean;
  /** 导出后直接打开文件 */
  openFileAfterExport: boolean;
  /** PDF 纸张尺寸 */
  pdfPaperSize: "A4" | "Letter" | "Legal" | "A5";
  /** 导出 HTML 时包含大纲 */
  htmlIncludeOutline: boolean;
  /** 是否读取 YAML front matter 覆盖导出设置（安全相关，默认关闭） */
  readExportSettingsFromFrontMatter: boolean;
}

export interface GeneralSettings {
  /** 界面语言 */
  language: "zh-CN" | "zh-TW" | "en";
  /** 自动保存 */
  autoSave: boolean;
  /** 自动保存间隔（毫秒） */
  autoSaveInterval: number;
  /** 启动时恢复上次未保存的草稿 */
  restoreSession: boolean;
  /** 发送匿名使用统计（默认关闭） */
  sendAnonymousStats: boolean;
}

export interface Settings {
  appearance: AppearanceSettings;
  editor: EditorSettings;
  markdown: MarkdownSettings;
  export: ExportSettings;
  general: GeneralSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  appearance: {
    theme: "inkstone-light",
    colorMode: "auto",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
    monoFontFamily:
      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
    fontSize: 16,
    lineHeight: 1.6,
    contentWidth: 46,
    backgroundColor: "",
    customCss: "",
    followSystemAppearance: true,
  },
  editor: {
    markerDisplay: "live",
    autoPairMode: "markdown",
    smartPunctuation: false,
    strictMode: false,
    indentFirstLine: false,
    indentParagraph: false,
    spellCheck: true,
    focusMode: false,
    typewriterMode: false,
    alwaysShowWordCount: true,
  },
  markdown: {
    inlineMath: true,
    inlineMathSingleDollar: true,
    blockMath: true,
    autoNumberEquations: false,
    mhchem: true,
    mermaid: true,
    githubAlerts: true,
    footnotes: true,
    highlight: true,
    subscriptSuperscript: true,
    frontMatter: true,
    tables: true,
    taskLists: true,
  },
  export: {
    openFolderAfterExport: false,
    openFileAfterExport: false,
    pdfPaperSize: "A4",
    htmlIncludeOutline: true,
    readExportSettingsFromFrontMatter: false,
  },
  general: {
    language: "zh-CN",
    autoSave: true,
    autoSaveInterval: 2000,
    restoreSession: true,
    sendAnonymousStats: false,
  },
};

/** 设置的分组元信息，设置面板据此自动渲染 */
export const SETTINGS_SECTIONS = [
  { id: "appearance", label: "外观" },
  { id: "editor", label: "编辑" },
  { id: "markdown", label: "Markdown" },
  { id: "export", label: "导出" },
  { id: "general", label: "通用" },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

/**
 * 深层局部类型：允许只更新某个分组里的某一项。
 * 运行时由 store 做深合并，类型上要与之一致，
 * 否则调用方会被迫把整个分组补齐，写起来非常痛苦。
 */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[]
    ? T[K]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

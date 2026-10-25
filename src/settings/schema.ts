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
  { value: "off", label: "不配对" },
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
  /**
   * 导出文件名模板。
   *
   * 支持 `${变量名}` 语法（见 `src/export/variables.ts`）。
   * 空串 = 用文档标题。模板里**不允许路径分隔符**——
   * 「导出到哪里」由保存对话框决定，模板只管叫什么名字。
   */
  fileNameTemplate: string;
  /**
   * 追加进 HTML 导出的 `<head>` 的原始 HTML。
   *
   * 用途是加 `<meta>`、`<link>`（外链字体）、`<script>` 之类。
   * 注意：这段内容会**原样**进入导出文件，它由用户自己写。
   */
  htmlExtraHead: string;
  /** 追加进 HTML 导出的 `<body>` 末尾的原始 HTML */
  htmlExtraBody: string;
  /**
   * 用户自定义的导出变量。
   *
   * 数组而非对象：顺序要稳定（面板里是列表），
   * 而且同名变量可以按顺序覆盖（后者优先）。
   */
  variables: ExportVariableSetting[];
  /**
   * 导出项的用户自定义（增删、重排、重命名、绑定快捷键）。
   *
   * **空数组 = 没有自定义**，此时用内置默认（注册表顺序，全部可见）。
   *
   * 非空时它是**权威的有序列表**：
   *   - 顺序 = 面板里的显示顺序
   *   - `visible === false` = 移除（但条目仍留在列表里，
   *     这样设置面板能把它列在「已移除」一栏，用户想恢复时找得到）
   *   - 没被提及的内置项按默认显示（这样以后新增的内置格式会自动出现）
   */
  items: ExportItemSetting[];
}

/**
 * 一个导出项的用户自定义。
 *
 * 形状与 `src/export/items.ts` 的 `ResolvedExportItem` 不同：
 * 这里存的是**用户填的**（可能只有 id），那边是**解析后的**（一定有名字和格式）。
 */
export interface ExportItemSetting {
  /** 导出项 id：内置的（`html` / `docx` …）或额外 pandoc 格式的（`pandoc:gfm`） */
  id: string;
  /** 自定义显示名；空 = 用默认名 */
  label?: string;
  /** 绑定的快捷键（CM6 语法，如 `Mod-Shift-1`）；空 = 不绑定 */
  shortcut?: string;
  /** 是否在导出面板里显示；默认 true */
  visible?: boolean;
}

/**
 * 一个用户自定义的导出变量。
 *
 * 这里的形状与 `src/export/variables.ts` 的 `ExportVariable` 一致，
 * 但放在 schema 里是因为它要**持久化**——设置文件是 JSON，
 * 只能存纯数据。
 */
export interface ExportVariableSetting {
  /** 引用时用的名字（不含 `${}`） */
  name: string;
  /** 取值来源 */
  source:
    | "title"
    | "author"
    | "date"
    | "filename"
    | "filenameNoExt"
    | "path"
    | "directory"
    | "today"
    | "now"
    | "words"
    | "chars"
    | "custom";
  /** `source === "custom"` 时的文本 */
  value?: string;
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

/** AI 端点的协议 */
export type AiProtocol = "openai" | "anthropic" | "gemini";

/**
 * 一个 AI 端点配置。
 *
 * 注意这里**没有密钥字段**——密钥存在系统钥匙串里，
 * 前端永远拿不到明文（见 `src-tauri/src/ai/secrets.rs`）。
 * 设置里只记「用哪个端点 + 哪个模型 + 能力位覆盖」。
 */
export interface AiEndpointSetting {
  /** 端点 id，同时是钥匙串里的 account 名 */
  id: string;
  /** 展示名 */
  label: string;
  /** 协议 */
  protocol: AiProtocol;
  /** base URL（用户可改，用来接自建服务） */
  baseUrl: string;
  /** 模型 id */
  model: string;
  /**
   * 计费性质。UI 必须显示——订阅 / 按量 / 本地免费三者
   * 对用户的成本含义完全不同，混起来显示会让人误判。
   */
  billing: "subscription" | "pay-per-token" | "local-free";
  /**
   * 并发上限。0 = 不限。
   * 必须真的限流而不只是显示：实测 GLM Coding Plan 的 Lite / Pro 档
   * 只允许 1 个并发请求，超了直接 429。
   */
  maxConcurrent: number;
  /** 能力位覆盖：模型不支持的参数必须关掉，否则上游直接 400 */
  capabilities?: {
    temperature?: boolean;
    reasoningToggle?: boolean;
  };
  /** 用户自定义的提示文案（覆盖内置预设的 note） */
  note?: string;
}

export interface AiSettings {
  /** 是否启用 AI 能力 */
  enabled: boolean;
  /** 用户配置的端点列表（内置预设不在这里，它们是只读的模板） */
  endpoints: AiEndpointSetting[];
  /** 默认端点 id */
  defaultEndpointId: string;
  /** 默认模型 id */
  defaultModel: string;
  /** 改写类的系统提示词（用户可改） */
  rewriteSystemPrompt: string;
  /** 总结类的系统提示词 */
  summarizeSystemPrompt: string;
  /** 问答类的系统提示词 */
  chatSystemPrompt: string;
  /** 单次请求的最大输出 token */
  maxOutputTokens: number;
  /** 温度（仅在端点能力位允许时生效） */
  temperature: number;
}

export interface Settings {
  appearance: AppearanceSettings;
  editor: EditorSettings;
  markdown: MarkdownSettings;
  export: ExportSettings;
  general: GeneralSettings;
  ai: AiSettings;
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
    fileNameTemplate: "",
    htmlExtraHead: "",
    htmlExtraBody: "",
    variables: [],
    // 空数组 = 没有自定义，用内置默认
    items: [],
  },
  general: {
    language: "zh-CN",
    autoSave: true,
    autoSaveInterval: 2000,
    restoreSession: true,
    sendAnonymousStats: false,
  },
  ai: {
    enabled: false,
    endpoints: [],
    defaultEndpointId: "",
    defaultModel: "",
    rewriteSystemPrompt:
      "你是一位中文写作助手。用户会给 you 一段 Markdown 文本，" +
      "请按要求改写它。只输出改写后的 Markdown，不要解释、不要加引号、" +
      "不要用代码块包裹。保持原有的 Markdown 结构（列表、代码块、公式）不变。",
    summarizeSystemPrompt:
      "你是一位中文写作助手。请对用户给的 Markdown 文档做摘要，" +
      "只输出 Markdown 本身，不要解释。",
    chatSystemPrompt:
      "你是一位中文笔记助手。只能依据用户提供的笔记内容回答，" +
      "不要编造。引用了哪些笔记就明确说是哪几篇。",
    maxOutputTokens: 4096,
    temperature: 0.7,
  },
};

/** 设置的分组元信息，设置面板据此自动渲染 */
export const SETTINGS_SECTIONS = [
  { id: "appearance", label: "外观" },
  { id: "editor", label: "编辑器" },
  { id: "markdown", label: "Markdown" },
  { id: "export", label: "导出" },
  { id: "general", label: "通用" },
  { id: "ai", label: "AI" },
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

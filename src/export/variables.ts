/**
 * 导出变量系统。
 *
 * 变量形如 `${title}`、`${author}`、`${today}`，可以在
 *   - 导出文件名模板
 *   - HTML 导出的 `<head>` / `<body>` 追加内容
 * 里引用。
 *
 * ## 变量只在「导出产物」上替换，绝不碰文档正文
 *
 * 文档正文是**单一真相源**（架构约束 1）。如果导出时把 `${title}` 替换进正文再写回，
 * 就等于用导出行为篡改了用户的源文件——那是最严重的一类 bug。
 * 所以替换只发生在**离开文档之后**的字符串上。
 *
 * ## 未定义的变量保持原样
 *
 * `${typo}` 不会被替换成空串，而是原样留在输出里。
 * 静默清空会让用户以为变量生效了（标题变成空），却查不出哪里错；
 * 原样保留一眼就能看出「这个变量名拼错了 / 没定义」。
 */

/** 内置变量的取值来源 */
export type ExportVariableSource =
  /** 文档标题：front matter 的 title → 第一个一级标题 → 文件名 */
  | "title"
  /** front matter 的 author */
  | "author"
  /** front matter 的 date */
  | "date"
  /** 文件名（含扩展名） */
  | "filename"
  /** 文件名（不含扩展名） */
  | "filenameNoExt"
  /** 文件绝对路径 */
  | "path"
  /** 文件所在目录 */
  | "directory"
  /** 今天，YYYY-MM-DD */
  | "today"
  /** 现在，YYYY-MM-DD HH:mm */
  | "now"
  /** 正文字数 */
  | "words"
  /** 正文字符数 */
  | "chars"
  /** 用户自定义的固定文本 */
  | "custom";

/** 一个用户配置的变量 */
export interface ExportVariable {
  /** 引用时用的名字（不含 `${}`） */
  name: string;
  /** 取值来源 */
  source: ExportVariableSource;
  /** `source === "custom"` 时的文本 */
  value?: string;
}

/** 求值时需要的上下文 */
export interface VariableContext {
  title: string;
  author: string;
  date: string;
  /** 文件名（含扩展名）；未命名文档为空串 */
  filename: string;
  /** 文件绝对路径；未命名文档为 null */
  path: string | null;
  words: number;
  chars: number;
  /** 求值时刻 */
  now: Date;
}

/** 内置变量的人类可读说明（面板里显示） */
export const BUILTIN_VARIABLE_LABELS: Record<ExportVariableSource, string> = {
  title: "文档标题",
  author: "作者",
  date: "日期",
  filename: "文件名",
  filenameNoExt: "文件名（不含扩展名）",
  path: "文件路径",
  directory: "所在目录",
  today: "今天",
  now: "当前时间",
  words: "字数",
  chars: "字符数",
  custom: "自定义文本",
};

/**
 * 把日期格式化成 `YYYY-MM-DD`。
 *
 * 手工补零：不用 `toISOString()`——那是 **UTC**，
 * 本地时间晚上 8 点会显示成第二天，差一整天。
 */
export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** 把日期格式化成 `YYYY-MM-DD HH:mm` */
export function formatDateTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${formatDate(date)} ${hours}:${minutes}`;
}

/** 取路径的最后一段（文件名） */
export function basenameOf(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

/** 取路径的所在目录 */
export function dirnameOf(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index > 0 ? path.slice(0, index) : "";
}

/**
 * 求出单个变量的值。
 *
 * `custom` 之外的来源全部从上下文取；上下文里没有的（未命名文档没有 path）返回空串。
 */
export function resolveVariable(variable: ExportVariable, ctx: VariableContext): string {
  switch (variable.source) {
    case "title":
      return ctx.title;
    case "author":
      return ctx.author;
    case "date":
      return ctx.date;
    case "filename":
      return ctx.filename;
    case "filenameNoExt":
      return ctx.filename.replace(/\.(md|markdown|mdown|mkd|txt)$/i, "");
    case "path":
      return ctx.path ?? "";
    case "directory":
      return ctx.path ? dirnameOf(ctx.path) : "";
    case "today":
      return formatDate(ctx.now);
    case "now":
      return formatDateTime(ctx.now);
    case "words":
      return String(ctx.words);
    case "chars":
      return String(ctx.chars);
    case "custom":
      return variable.value ?? "";
  }
}

/**
 * 在字符串里替换所有 `${变量名}`。
 *
 * 实现要点：
 *   - **只**替换配置里定义过的变量名，其余 `${...}` 原样保留
 *   - 变量名里的 `-` / `_` / 空格都允许（用户自己起的名字，不必限制）
 *   - 替换是一次性扫描，不做递归——替换结果里的 `${` 不会被二次解释
 *     （否则用户自定义文本里写 `${title}` 会被无限展开）
 */
export function applyVariables(
  template: string,
  variables: ExportVariable[],
  ctx: VariableContext,
): string {
  if (!template.includes("${")) return template;

  // 先把变量名 → 值建表，避免对同一个名字反复遍历配置
  const table = new Map<string, string>();
  for (const variable of variables) {
    table.set(variable.name, resolveVariable(variable, ctx));
  }

  return template.replace(/\$\{([^{}]*)\}/g, (match, name: string) => {
    // 未定义的变量原样保留
    return table.has(name) ? table.get(name)! : match;
  });
}

/**
 * 列出模板里用到的、且**已定义**的变量名。
 *
 * 用途：导出面板要告诉用户「你这个模板用了 title 和 author」。
 * 顺带能发现拼错的变量名（不在定义表里）——那是最容易犯又最难发现的错。
 */
export function collectVariableUsage(
  template: string,
  variables: ExportVariable[],
): { used: string[]; unknown: string[] } {
  const defined = new Set(variables.map((variable) => variable.name));
  const used: string[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();

  for (const match of template.matchAll(/\$\{([^{}]*)\}/g)) {
    const name = match[1];
    if (seen.has(name)) continue;
    seen.add(name);
    if (defined.has(name)) used.push(name);
    else unknown.push(name);
  }

  return { used, unknown };
}

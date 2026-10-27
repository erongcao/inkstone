/**
 * Markdown 扩展功能开关——**全应用唯一一份**。
 *
 * ## 为什么要有这个文件
 *
 * 设置面板里有一组「Markdown」开关（表格 / 任务列表 / 脚注 / 高亮 / 公式……）。
 * 在这份文件出现之前，其中**只有 1 个**真的接线（`inlineMathSingleDollar`），
 * 其余 12 个是**摆设**：面板画出了复选框，但没有任何代码读它们，
 * 勾一下什么都不发生。
 *
 * 「设置里的参数不接到请求上，就是摆设」——这条原则最早是为 AI 面板写的，
 * 这里同样适用。所以把它们接起来。
 *
 * ## 这一份对象要满足三件事
 *
 * 1. **单一真相源**：设置面板改的就是这一份，其它地方不自己存一份。
 * 2. **能算出缓存键**：解析器与语法分析器都按开关组合缓存
 *    （见 `markdown.ts` 的 `getProcessor` 与 `markdown-language.ts` 的
 *    `getMarkdownParser`），所以要有一个稳定的字符串键。
 * 3. **能跨层传**：同一个对象要同时喂给
 *    - **语义层**（remark：哪些节点会被解析出来）
 *    - **编辑布局层**（lezer：哪些标记会被认出来）
 *    - **渲染层**（装饰器：哪些东西会被渲染成图）
 *    - **导出与剪贴板**（同一套规则，屏幕与导出必须一致）
 *
 * ## 三个层次的区别（别混）
 *
 * 开关关掉之后，「不生效」在不同层表现不一样，但**用户看到的结果必须一致**：
 *
 * | 层 | 开关关掉后 |
 * |---|---|
 * | remark（语义） | 不再产出对应节点（表格 / 任务 / 脚注 / 高亮…） |
 * | lezer（编辑布局） | 不再认对应标记（表格 / 任务 / 高亮） |
 * | 渲染层 | 不渲染（公式不渲染成 KaTeX、图表不渲染成 SVG） |
 *
 * 三层同时关 → 用户看到的是「这段语法不被识别，显示为字面文本」，
 * 导出也是字面文本。**屏幕与导出必须一致**（架构约束 C）。
 *
 * ## 为什么不把 `autoNumberEquations` 放进来
 *
 * `autoNumberEquations`（公式自动编号）对应的东西**还不存在**：
 * 代码里根本没有编号功能，它的默认值是 `false`——它是个**许愿**。
 *
 * （`subscriptSuperscript` 曾经也在这个名单里——那是因为 remark 侧
 * 没有对应的解析规则，只开 lezer 那一半会破「解析规则唯一」那条红线。
 * 现在 remark 侧补上了自研的 micromark 扩展，见 `subsup.ts`，
 * 所以它已经是真正的开关了。）
 *
 * 把 `autoNumberEquations` 放进这个类型，等于给「还没实现的功能」发一张通行证。
 * 不放，设置面板里就把它**置灰**并写明原因。
 */

import type { MarkdownSettings } from "@/settings/schema";

/**
 * Inkstone 真正支持的 Markdown 扩展开关。
 *
 * 每一项都对应设置面板里的一个复选框，且**真的**影响行为。
 */
export interface MarkdownFeatures {
  /** 行内公式 `$…$` */
  inlineMath: boolean;
  /**
   * 单个 `$` 是否作为行内公式定界符。
   *
   * 直接透传给 remark-math 的 `singleDollarTextMath`（上游一等选项），
   * 所以不是编辑器自造的启发式，语义层与导出天生一致。
   * 只在 `inlineMath` 开着时才有意义。
   */
  inlineMathSingleDollar: boolean;
  /** 块级公式 `$$…$$` */
  blockMath: boolean;
  /** mhchem 化学扩展（`\ce{…}`） */
  mhchem: boolean;
  /** Mermaid 图表 */
  mermaid: boolean;
  /** GitHub 风格提示块（`> [!NOTE]`） */
  githubAlerts: boolean;
  /** GFM 脚注（`[^1]` / `[^1]:`） */
  footnotes: boolean;
  /** 行内高亮 `==…==`（Typora 同款） */
  highlight: boolean;
  /** YAML front matter */
  frontMatter: boolean;
  /** GFM 表格 */
  tables: boolean;
  /** GFM 任务列表 */
  taskLists: boolean;
  /**
   * 下标 `~…~` 与上标 `^…^`（Pandoc 风格）。
   *
   * lezer 侧用 `@lezer/markdown` 自带的 `Subscript` / `Superscript`，
   * remark 侧是本项目自研的 micromark 扩展（`subsup.ts`）——
   * 两边的规则逐条对齐，规格写在那份文件的表里。
   */
  subscriptSuperscript: boolean;
}

/** 全部开启——`parseMarkdown()` 不传选项时的行为 */
export const DEFAULT_FEATURES: MarkdownFeatures = Object.freeze({
  inlineMath: true,
  inlineMathSingleDollar: true,
  blockMath: true,
  mhchem: true,
  mermaid: true,
  githubAlerts: true,
  footnotes: true,
  highlight: true,
  frontMatter: true,
  tables: true,
  taskLists: true,
  subscriptSuperscript: true,
});

/** 开关名（用于缓存键与测试断言） */
export const FEATURE_NAMES = Object.keys(DEFAULT_FEATURES) as (keyof MarkdownFeatures)[];

/**
 * 从设置派生出一份完整的功能开关。
 *
 * 设置里多出来的字段（`autoNumberEquations`）**故意不读**——
 * 它对应的功能还不存在，读取它等于假装支持。
 */
export function featuresFromSettings(settings: MarkdownSettings): MarkdownFeatures {
  return {
    inlineMath: settings.inlineMath,
    inlineMathSingleDollar: settings.inlineMathSingleDollar,
    blockMath: settings.blockMath,
    mhchem: settings.mhchem,
    mermaid: settings.mermaid,
    githubAlerts: settings.githubAlerts,
    footnotes: settings.footnotes,
    highlight: settings.highlight,
    frontMatter: settings.frontMatter,
    tables: settings.tables,
    taskLists: settings.taskLists,
    subscriptSuperscript: settings.subscriptSuperscript,
  };
}

/**
 * 合并成完整的一份（缺省补齐默认）。
 *
 * **只认已知的开关名**，其余键原样丢掉。
 *
 * 为什么这么严：曾经踩过一个坑——传进来的对象形状不对
 * （该扁平的地方多套了一层 `{ features: {...} }`），
 * 展开时那个嵌套对象被当成一个叫 `features` 的开关塞了进去，
 * 于是真正要改的 `inlineMathSingleDollar` **根本没被改到**，
 * 而功能「看起来是关掉的」——排查了很久。
 *
 * 丢掉未知键之后，至少结果只受已知开关影响；
 * 而形状错了会立刻表现为「开关没生效」，而不是悄悄塞进垃圾键。
 */
export function resolveFeatures(partial?: Partial<MarkdownFeatures>): MarkdownFeatures {
  const out: MarkdownFeatures = { ...DEFAULT_FEATURES };
  if (!partial) return out;
  for (const name of FEATURE_NAMES) {
    const value = partial[name];
    if (typeof value === "boolean") out[name] = value;
  }
  return out;
}

/**
 * 缓存键：开关组合的唯一标识。
 *
 * 每一位对应一个开关，用 `1`/`0` 表示开/关——
 * 顺序固定（`FEATURE_NAMES`），所以同一个组合永远得到同一个键。
 */
export function featuresKey(features: MarkdownFeatures): string {
  return FEATURE_NAMES.map((name) => (features[name] ? "1" : "0")).join("");
}

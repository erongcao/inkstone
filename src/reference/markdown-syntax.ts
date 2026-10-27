/**
 * Markdown 语法速查表的数据。
 *
 * ## 这份表说的是「Inkstone 支持什么」，不是「Markdown 规范怎么说」
 *
 * 所以每一行都是**实测过的**：表格能编辑、脚注能跳转、公式走 KaTeX、
 * mermaid 会渲染成图。规范里有但这里没写的东西，是 Inkstone 还没实现的
 * （比如 `~下标~`、`^上标^`）——写上去就是骗人。
 *
 * 反过来，Inkstone 支持但规范里没有的（`==高亮==`），也要写在这里：
 * 用户从 Typora 迁过来，文件里本来就有这些标记，
 * 他需要知道「这里能写、而且 Inkstone 会认」。
 *
 * ## 表要跟着开关走
 *
 * 速查表是「Inkstone 支持什么」的说明书——
 * 而「支持什么」是**由设置面板的开关决定的**。
 *
 * 用户关掉「表格」之后，表里还写着表格语法，
 * 那就是在骗人：照着写，屏幕上什么都不会发生。
 *
 * 所以每条示例都带一个 `feature` 标签：
 * 开关关掉时，那条示例**从表里消失**；
 * 一组示例全被过滤掉时，整个分组也一起消失
 * （留一个空标题更糟）。
 *
 * 标签挂在**示例**上而不是分组上——
 * 因为「强调」这一组里只有 `==高亮==` 受开关影响，
 * 而「公式」这一组里行内与块级是两个不同的开关。
 *
 * ## 翻译约定
 *
 * - **分组名**与**说明**是界面文案：中文原文作 key，渲染时 `t()` 查字典。
 * - **示例**是 Markdown 源码：整串作字典 key，译文会把示例里的文字换掉
 *   （`# 一级标题` → `# Heading 1`），而语法符号本身原样保留。
 *
 * 为什么示例也要进字典：示例里带的是有意义的文字（「粗体」「引用块」），
 * 不翻译的话，英文界面里会夹着一堆中文示例，看起来像没做完。
 *
 * 注意：**不要在这里调 `t()`**。
 * 模块作用域里调 `t()` 会在导入时就把译文定死（语言切换就不生效了），
 * `scripts/check-i18n-scope.ts` 会把这种写法拦下来。
 */

import type { MarkdownFeatures } from "@/parser/features";

/** 一条语法示例 */
export interface SyntaxSample {
  /** 示例源码（整串是字典 key） */
  text: string;
  /**
   * 这条示例依赖哪个扩展开关。
   *
   * 不写 = 始终支持（CommonMark 基础语法、GFM 的删除线与自动链接——
   * 它们没有对应的开关）。
   *
   * 写了 = 那个开关关掉时，这条示例从速查表里消失。
   */
  feature?: keyof MarkdownFeatures;
}

/** 一组语法示例 */
export interface SyntaxGroup {
  /** 分组名（中文原文，渲染时翻译） */
  name: string;
  /** 分组说明（中文原文，渲染时翻译）；空串表示没有说明 */
  note: string;
  /** 组内的语法示例 */
  samples: SyntaxSample[];
}

/**
 * 语法速查表的全部内容。
 *
 * 顺序就是显示顺序——从最常用的标题、强调开始，
 * 最后是 Inkstone 自己扩展的那几样（公式、图表、脚注、Emoji）。
 */
export const SYNTAX_GROUPS: SyntaxGroup[] = [
  {
    name: "标题",
    note: "井号越多级别越高，最多六级。",
    samples: [{ text: "# 一级标题" }, { text: "## 二级标题" }, { text: "### 三级标题" }],
  },
  {
    name: "强调",
    note: "删除线是 GitHub 扩展（GFM）语法，高亮是 Typora 同款扩展，其它编辑器未必支持。",
    samples: [
      { text: "**粗体**" },
      { text: "*斜体*" },
      { text: "***粗斜体***" },
      { text: "~~删除线~~" },
      { text: "==高亮==", feature: "highlight" },
      { text: "H~2~O", feature: "subscriptSuperscript" },
      { text: "x^2^", feature: "subscriptSuperscript" },
    ],
  },
  {
    name: "列表",
    note: "",
    samples: [{ text: "- 无序列表" }, { text: "1. 有序列表" }, { text: "  - 嵌套列表" }],
  },
  {
    name: "链接",
    note: "尖括号写法会自动变成可点击的链接。",
    samples: [
      { text: "[链接文字](https://example.com)" },
      { text: "[链接文字][ref]" },
      { text: "[ref]: https://example.com" },
      { text: "<https://example.com>" },
    ],
  },
  {
    name: "图片",
    note: "图片没加载出来时显示替代文字。",
    samples: [
      { text: "![替代文字](image.png)" },
      { text: '![替代文字](image.png "标题")' },
    ],
  },
  {
    name: "代码",
    note: "围栏代码块可以标注语言，会自动高亮。",
    samples: [
      { text: "`行内代码`" },
      { text: "```js\nconst a = 1;\n```" },
      { text: "    缩进四格的代码块" },
    ],
  },
  {
    name: "引用",
    note: "引用块里可以放列表、图片、代码等任何内容。",
    samples: [{ text: "> 引用块" }, { text: "> > 嵌套引用" }],
  },
  {
    name: "提示块",
    note: "GitHub 风格的提示块，NOTE / TIP / IMPORTANT / WARNING / CAUTION 五种。",
    samples: [{ text: "> [!NOTE]\n> 这是提示内容", feature: "githubAlerts" }],
  },
  {
    name: "分隔线",
    note: "单独一行三个短横线就是分隔线。",
    samples: [{ text: "---" }],
  },
  {
    name: "表格",
    note: "表格可以直接在编辑器里改内容、调列宽。",
    samples: [
      {
        text: "| 列一 | 列二 |\n| --- | --- |\n| 单元格 | 单元格 |",
        feature: "tables",
      },
    ],
  },
  {
    name: "任务列表",
    note: "在实时预览里点方框就能勾选，勾选结果直接写回源码。",
    samples: [
      { text: "- [ ] 未完成", feature: "taskLists" },
      { text: "- [x] 已完成", feature: "taskLists" },
    ],
  },
  {
    name: "公式",
    note: "公式由 KaTeX 渲染；设置里可以关掉「单 $ 也当行内公式」。",
    samples: [
      { text: "$E = mc^2$", feature: "inlineMath" },
      { text: "$$\nx^2 + y^2 = z^2\n$$", feature: "blockMath" },
    ],
  },
  {
    name: "图表",
    note: "语言标成 mermaid 的代码块会渲染成图表。",
    samples: [{ text: "```mermaid\ngraph TD;\n  A-->B;\n```", feature: "mermaid" }],
  },
  {
    name: "脚注",
    note: "[^1] 是引用，[^1]: 是定义，脚注会自动编号。",
    samples: [
      { text: "正文里的脚注引用[^1]", feature: "footnotes" },
      { text: "[^1]: 脚注的内容", feature: "footnotes" },
    ],
  },
  {
    name: "Emoji",
    note: "输入冒号会弹出 Emoji 补全列表。",
    samples: [{ text: ":smile:" }],
  },
];

/**
 * 按开关过滤速查表。
 *
 * 规则：
 *   1. 带 `feature` 标签的示例，开关关着就丢掉
 *   2. 一组示例全被丢掉时，整组也丢掉（空标题比没有更糟）
 *
 * 返回的是**新对象**，不会改到 `SYNTAX_GROUPS` 本身——
 * 那份常量是模块级的共享数据，被改了会影响下一次渲染。
 */
export function filterSyntaxGroups(
  groups: SyntaxGroup[],
  features: MarkdownFeatures,
): SyntaxGroup[] {
  const out: SyntaxGroup[] = [];
  for (const group of groups) {
    const samples = group.samples.filter(
      (sample) => !sample.feature || features[sample.feature],
    );
    if (samples.length === 0) continue;
    out.push({ ...group, samples });
  }
  return out;
}

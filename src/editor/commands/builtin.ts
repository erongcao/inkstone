/**
 * 内置命令表。
 *
 * 在**模块加载时**就注册好（`registerBuiltinCommands()` 由 `commands/builtin.ts` 顶层调用），
 * 这样命令表在第一个组件挂载之前就是完整的——斜杠菜单是补全源，
 * 可能在 React 渲染之前就被调用。
 *
 * ## 分类
 *
 * 「格式」与「块」出现在斜杠菜单（打 `/` 时真正想要的就是它们）；
 * 「视图」只在命令面板出现——斜杠菜单里塞一个「切到源码模式」很奇怪。
 */

import type { EditorView } from "@codemirror/view";
import {
  toggleLinePrefix,
  toggleWrap,
  prefixLines,
  insertBlock,
  insertAround,
} from "../command-editing";
import { registerCommands, type InkstoneCommand } from "../commands";
import { emitIntent } from "../intents";
import { openFindPanel, openReplacePanel } from "../search-panel";
import { KEYS } from "@/shortcuts";
import { readSettings } from "@/settings/store";
import { featuresFromSettings, type MarkdownFeatures } from "@/parser/features";
import {
  commandAddTableColumn,
  commandAddTableRow,
  commandRemoveTableColumn,
  commandRemoveTableRow,
  commandSetTableAlign,
  findEditableTable,
} from "../render/table-operations";

/** 表格命令只在「光标位于表格内」时可用——不在表内就没有"当前行/当前列"可言 */
const inTable = (view: EditorView): boolean => findEditableTable(view) !== null;

/**
 * 造一条表格命令。
 *
 * `surfaces` 显式给 `["palette"]`：表格操作在斜杠菜单里没有意义——
 * 打 `/` 的时候光标通常不在表内，列出来的条目点下去只会什么都不发生。
 */
const table = (
  id: string,
  label: string,
  keywords: string,
  run: (view: EditorView) => boolean,
): InkstoneCommand => ({
  id: `table.${id}`,
  label,
  category: "表格",
  keywords,
  surfaces: ["palette"],
  enabled: inTable,
  run,
});

/** 表格模板：3×3 带表头 */
const TABLE_TEMPLATE = [
  "| 列 1 | 列 2 | 列 3 |",
  "| --- | --- | --- |",
  "|  |  |  |",
  "|  |  |  |",
].join("\n");

/** 有序列表的起始编号偏移（`toggleLinePrefix` 内部从 1 开始数） */
function heading(level: number): InkstoneCommand {
  return {
    id: `heading.${level}`,
    label: `${"#".repeat(level)} 标题`,
    category: "块",
    keywords: `heading h${level} title biaoti`,
    run: (view) => prefixLines(view, "#".repeat(level) + " "),
  };
}

/**
 * 格式命令的标记表。
 *
 * 单独导出，是为了让测试能对着它断言「这个标记真的会被渲染」。
 *
 * 命令面板里出现一个**不生效**的格式命令，比没有这个命令更糟：
 * 用户点了以为成功了，屏幕上什么都没变——
 * 他不会知道是自己用错了，只会以为编辑器坏了。
 * （`==高亮==` 就是这么活了很久：命令在、标记也在，
 *   但解析层不认，屏幕上永远是裸的等号。）
 */
export interface FormatSpec {
  /** 命令 id 的后缀（完整 id 是 `format.<id>`） */
  id: string;
  /** 命令面板上显示的名字 */
  label: string;
  /** 包裹选区的标记 */
  marker: string;
  /** 没有选区时插入的占位文字 */
  placeholder: string;
  /** 命令面板的搜索关键词 */
  keywords: string;
  /**
   * 这个格式依赖哪个扩展开关。
   *
   * 写了 = 那个开关关着时，这条命令**不可用**（不进命令面板、不进斜杠菜单，
   * 快捷键也不响应）。
   *
   * 为什么要这样：命令面板里出现一个**不生效**的格式命令，比没有更糟——
   * 用户点了以为成功了，屏幕上什么都没变。
   * 插进去 `==高亮==` 而高亮开关是关着的，就是这种情况：
   * 标记插进去了，解析层却不认它，屏幕上永远是裸的等号。
   */
  feature?: keyof MarkdownFeatures;
}

/** 全部行内格式命令的规格 */
export const FORMAT_SPECS: FormatSpec[] = [
  {
    id: "bold",
    label: "加粗",
    marker: "**",
    placeholder: "加粗文字",
    keywords: "bold b cizhong",
  },
  {
    id: "italic",
    label: "斜体",
    marker: "*",
    placeholder: "斜体文字",
    keywords: "italic i xieti em",
  },
  {
    id: "code",
    label: "行内代码",
    marker: "`",
    placeholder: "代码",
    keywords: "code backtick xingnei",
  },
  {
    id: "strike",
    label: "删除线",
    marker: "~~",
    placeholder: "删除",
    keywords: "strike del shanchuxian",
  },
  {
    id: "highlight",
    label: "高亮",
    marker: "==",
    placeholder: "高亮",
    keywords: "highlight gaoliang",
    feature: "highlight",
  },
  {
    id: "sub",
    label: "下标",
    marker: "~",
    placeholder: "下标",
    keywords: "subscript xiabiao",
  },
  {
    id: "super",
    label: "上标",
    marker: "^",
    placeholder: "上标",
    keywords: "superscript shangbiao",
  },
];

/**
 * 某个扩展开关当前是否开着。
 *
 * 命令表是**模块级**的，拿不到 React 的 hook，所以走设置存储的同步读取
 * （`readSettings()`）——与剪贴板那条路径同一个办法。
 *
 * `enabled` 是在**列命令的时候**求值的（`commandsFor`），
 * 所以用户改完设置再打开命令面板，看到的就是新的可用性。
 */
const featureEnabled = (feature: keyof MarkdownFeatures) => (): boolean =>
  featuresFromSettings(readSettings().markdown)[feature];

const format = (spec: FormatSpec): InkstoneCommand => ({
  id: `format.${spec.id}`,
  label: spec.label,
  category: "格式",
  keywords: spec.keywords,
  // 依赖某个扩展开关的格式：开关关着时这条命令整个不出现
  ...(spec.feature ? { enabled: featureEnabled(spec.feature) } : {}),
  run: (view) => toggleWrap(view, spec.marker, spec.placeholder),
});

export function builtinCommands(): InkstoneCommand[] {
  return [
    /* ── 格式 ── */
    ...FORMAT_SPECS.map(format),

    {
      id: "format.link",
      label: "插入链接",
      category: "格式",
      keywords: "link url lianjie",
      run: (view) => insertAround(view, "[", "](url)", "链接文字"),
    },
    {
      id: "format.image",
      label: "插入图片",
      category: "格式",
      keywords: "image picture tupian",
      run: (view) => insertAround(view, "![", "](图片路径)", "图片说明"),
    },

    /* ── 块 ── */
    heading(1),
    heading(2),
    heading(3),
    heading(4),
    heading(5),
    heading(6),
    {
      id: "block.bullet",
      label: "无序列表",
      category: "块",
      keywords: "bullet list ul wuxu liebiao",
      run: (view) => toggleLinePrefix(view, { bullet: "-" }),
    },
    {
      id: "block.ordered",
      label: "有序列表",
      category: "块",
      keywords: "ordered list ol youxu liebiao number",
      run: (view) => toggleLinePrefix(view, { numbered: true }),
    },
    {
      id: "block.task",
      label: "任务列表",
      category: "块",
      keywords: "task todo checkbox renwu",
      run: (view) => insertBlock(view, "- [ ] 待办事项", 2),
    },
    {
      id: "block.quote",
      label: "引用",
      category: "块",
      keywords: "quote blockquote yinyang",
      run: (view) => toggleLinePrefix(view, { bullet: ">" }),
    },
    {
      id: "block.code",
      label: "代码块",
      category: "块",
      keywords: "code block fenced daima ku",
      // 光标落在最后一行，进去就能直接写
      run: (view) => insertBlock(view, "```\n\n```", 4),
    },
    {
      id: "block.table",
      label: "表格",
      category: "块",
      keywords: "table grid biaoge",
      // 光标落在表头第一格
      run: (view) => insertBlock(view, TABLE_TEMPLATE, 2),
    },
    {
      id: "block.math",
      label: "数学公式",
      category: "块",
      keywords: "math latex formula shuxue gongshi katex",
      run: (view) => insertBlock(view, "$$\n\n$$", 3),
    },
    {
      id: "block.inline-math",
      label: "行内公式",
      category: "块",
      keywords: "inline math latex xingnei",
      run: (view) => toggleWrap(view, "$", "公式"),
    },
    {
      id: "block.mermaid",
      label: "Mermaid 图表",
      category: "块",
      keywords: "mermaid chart tubiao",
      run: (view) => insertBlock(view, "```mermaid\n\n```", 11),
    },
    {
      id: "block.footnote",
      label: "脚注",
      category: "块",
      keywords: "footnote note jiaozhu",
      run: (view) => insertBlock(view, "[^1]: 脚注内容", 5),
    },
    {
      id: "block.hr",
      label: "分隔线",
      category: "块",
      keywords: "hr divider rule fengexian",
      run: (view) => insertBlock(view, "---"),
    },

    /* ── 视图（只在命令面板） ── */
    {
      id: "view.live",
      label: "实时预览（隐藏标记符）",
      category: "视图",
      surfaces: ["palette"],
      keywords: "live preview typora shishi",
      run: () => {
        emitIntent({ type: "view.live" });
        return true;
      },
    },
    {
      id: "view.dimmed",
      label: "弱化显示（标记可见）",
      category: "视图",
      surfaces: ["palette"],
      keywords: "dimmed ulysses ruohua",
      run: () => {
        emitIntent({ type: "view.dimmed" });
        return true;
      },
    },
    {
      id: "view.source",
      label: "源码模式",
      category: "视图",
      surfaces: ["palette"],
      keywords: "source code yuanma",
      run: () => {
        emitIntent({ type: "view.source" });
        return true;
      },
    },
    {
      id: "view.focus-mode",
      label: "切换焦点模式",
      category: "视图",
      surfaces: ["palette"],
      keywords: "focus mode jiaodian",
      run: () => {
        emitIntent({ type: "view.toggle-focus-mode" });
        return true;
      },
    },
    {
      id: "view.typewriter-mode",
      label: "切换打字机模式",
      category: "视图",
      surfaces: ["palette"],
      keywords: "typewriter daru ji",
      run: () => {
        emitIntent({ type: "view.toggle-typewriter-mode" });
        return true;
      },
    },

    /* ── 文件（只在命令面板） ── */
    {
      id: "file.new",
      label: "新建文档",
      category: "文件",
      surfaces: ["palette"],
      keywords: "new create xinjian",
      run: () => {
        emitIntent({ type: "file.new" });
        return true;
      },
    },
    {
      id: "file.save",
      label: "保存文档",
      category: "文件",
      surfaces: ["palette"],
      keywords: "save baocun",
      shortcut: KEYS.save,
      run: () => {
        emitIntent({ type: "file.save" });
        return true;
      },
    },

    {
      id: "file.export",
      label: "导出…",
      category: "文件",
      surfaces: ["palette"],
      keywords: "export daochu docx pdf epub html word",
      shortcut: KEYS.exportDocument,
      run: () => {
        emitIntent({ type: "file.export" });
        return true;
      },
    },

    /* ── 应用（只在命令面板） ── */
    {
      id: "app.check-update",
      label: "检查更新…",
      category: "应用",
      surfaces: ["palette"],
      keywords: "update upgrade gengxin check",
      run: () => {
        emitIntent({ type: "app.check-update" });
        return true;
      },
    },

    /* ── 帮助（原生菜单 + 命令面板两个入口） ── */
    {
      id: "app.show-shortcuts",
      label: "快捷键一览",
      category: "帮助",
      surfaces: ["palette"],
      keywords: "shortcuts keyboard kuaijiejian hotkey shortcut",
      run: () => {
        emitIntent({ type: "app.show-shortcuts" });
        return true;
      },
    },
    {
      id: "app.show-markdown-reference",
      label: "Markdown 语法参考",
      category: "帮助",
      surfaces: ["palette"],
      keywords: "markdown syntax reference yufa shuofa",
      run: () => {
        emitIntent({ type: "app.show-markdown-reference" });
        return true;
      },
    },

    /* ── AI（只在命令面板） ── */
    {
      id: "ai.open",
      label: "AI 助手…",
      category: "AI",
      surfaces: ["palette"],
      keywords: "ai assistant gpt model rewrite summarize run aizhu",
      run: () => {
        emitIntent({ type: "ai.open" });
        return true;
      },
    },
    {
      id: "ai.rewrite",
      label: "AI：改写当前选区",
      category: "AI",
      surfaces: ["palette"],
      keywords: "ai rewrite polish gaixie run aizhu",
      run: () => {
        emitIntent({ type: "ai.open", tab: "rewrite" });
        return true;
      },
    },
    {
      id: "ai.summarize",
      label: "AI：总结整篇文档",
      category: "AI",
      surfaces: ["palette"],
      keywords: "ai summary summarize zongjie aizhu",
      run: () => {
        emitIntent({ type: "ai.open", tab: "summarize" });
        return true;
      },
    },

    /* ── 查找 / 替换（只在命令面板） ── */
    // 命令面板里能搜到，是因为**原生菜单只在 Tauri 里存在**：
    // 浏览器开发模式下「编辑 → 查找」是灰的，没有第二个入口就等于没法调试。
    {
      id: "find.open",
      label: "查找",
      category: "查找",
      surfaces: ["palette"],
      keywords: "find search sousuo zha",
      shortcut: KEYS.find,
      run: (view) => openFindPanel(view),
    },
    {
      id: "find.replace",
      label: "替换",
      category: "查找",
      surfaces: ["palette"],
      keywords: "replace tihuan",
      run: (view) => openReplacePanel(view),
    },

    /* ── 表格（只在光标位于表格内时可用） ── */
    table("row-add", "表格：插入一行", "table add row hang biaoge", (view) =>
      commandAddTableRow(view),
    ),
    table("row-del", "表格：删除当前行", "table delete row shanchu biaoge", (view) =>
      commandRemoveTableRow(view),
    ),
    table("col-add", "表格：插入一列", "table add column lie biaoge", (view) =>
      commandAddTableColumn(view),
    ),
    table("col-del", "表格：删除当前列", "table delete column shanchu biaoge", (view) =>
      commandRemoveTableColumn(view),
    ),
    table("align-left", "表格：当前列左对齐", "table align left zuoyou duiqi", (view) =>
      commandSetTableAlign(view, "left"),
    ),
    table(
      "align-center",
      "表格：当前列居中",
      "table align center juzhong duiqi",
      (view) => commandSetTableAlign(view, "center"),
    ),
    table("align-right", "表格：当前列右对齐", "table align right you duiqi", (view) =>
      commandSetTableAlign(view, "right"),
    ),
    table(
      "align-reset",
      "表格：取消当前列对齐",
      "table align none quxiao duiqi",
      (view) => commandSetTableAlign(view, null),
    ),
  ];
}

let registered = false;

/** 注册内置命令（幂等） */
export function registerBuiltinCommands(): void {
  if (registered) return;
  registered = true;
  registerCommands(builtinCommands());
}
// 顶层注册：命令表必须在**任何消费者之前**是完整的。
// 斜杠菜单是补全源，可能在 React 第一个组件挂载之前就被调用，
// 那时如果命令表还是空的，斜杠菜单就会弹出一个空列表。
registerBuiltinCommands();

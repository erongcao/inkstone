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

import {
  toggleLinePrefix,
  toggleWrap,
  prefixLines,
  insertBlock,
  insertAround,
} from "../command-editing";
import { registerCommands, type InkstoneCommand } from "../commands";
import { emitIntent } from "../intents";

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

const format = (
  id: string,
  label: string,
  marker: string,
  placeholder: string,
  keywords: string,
): InkstoneCommand => ({
  id: `format.${id}`,
  label,
  category: "格式",
  keywords,
  run: (view) => toggleWrap(view, marker, placeholder),
});

export function builtinCommands(): InkstoneCommand[] {
  return [
    /* ── 格式 ── */
    format("bold", "加粗", "**", "加粗文字", "bold b cizhong"),
    format("italic", "斜体", "*", "斜体文字", "italic i xieti em"),
    format("code", "行内代码", "`", "代码", "code backtick xingnei"),
    format("strike", "删除线", "~~", "删除", "strike del shanchuxian"),
    format("highlight", "高亮", "==", "高亮", "highlight gaoliang"),
    format("sub", "下标", "~", "下标", "subscript xiabiao"),
    format("super", "上标", "^", "上标", "superscript shangbiao"),

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
        emitIntent("view.live");
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
        emitIntent("view.dimmed");
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
        emitIntent("view.source");
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
        emitIntent("view.toggle-focus-mode");
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
        emitIntent("view.toggle-typewriter-mode");
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
        emitIntent("file.new");
        return true;
      },
    },
    {
      id: "file.save",
      label: "保存文档",
      category: "文件",
      surfaces: ["palette"],
      keywords: "save baocun",
      shortcut: "⌘S",
      run: () => {
        emitIntent("file.save");
        return true;
      },
    },
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

/**
 * Markdown 编辑器（CodeMirror 6 + Live Preview）。
 *
 * 这是 M1 的核心组件。设计要点：
 *   - 文档内容始终是**纯 Markdown 文本**，编辑器不做任何语义转换
 *   - 「实时预览」与「源码模式」是同一份文档的两种视图，切换只改装饰器
 *   - 对外只暴露文本的读写，不泄露 CM6 内部结构
 */

import { EditorState, Transaction, Compartment, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { gfmMarkdownLanguage } from "./markdown-language";
import { searchKeymap, highlightSelectionMatches, search } from "@codemirror/search";
import { openFindPanel } from "./search-panel";
import { languages } from "@codemirror/language-data";
import { livePreview, setDisplayModeOf, setMathOptionsOf } from "./live-preview";
import { setActiveEditorView } from "./active-view";
import { autoPair } from "./auto-pair";
import {
  continueListOnEnter,
  indentListItem,
  outdentListItem,
} from "./list-continuation";
import { markdownPaste } from "./paste";
import { imageDrop } from "./image-insert";
import { focusMode, setFocusModeOf } from "./focus-mode";
import { typewriter, setTypewriterModeOf } from "./typewriter";
import { preloadEmojiData } from "./emoji";
import { inkstoneAutocomplete } from "./completion";
import { primeMermaid } from "./render/mermaid-loader";

/**
 * mermaid 是否已经发起过预加载。
 *
 * 放模块级而不是编辑器实例里：触发点在 `buildExtensions` 构造的 updateListener 闭包里，
 * 那里拿不到 `createMarkdownEditor` 的局部变量；而它本来就该是全局一次性
 * （mermaid 的加载器本身就是模块级单例，重复发起只会拿到同一个 Promise）。
 */
let mermaidPrimed = false;
import { openPalette } from "./palette";
import { runCommand } from "./commands";
import { linkPopoverTrigger } from "./link-trigger";
import "./commands/builtin"; // 顶层副作用：注册内置命令表
import {
  armPlainTextPaste,
  copySelectionAsHtml,
  copySelectionAsMarkdown,
  markdownCopy,
} from "./clipboard";
import type { AutoPairMode, MarkerDisplayMode } from "@/settings/schema";

export interface MarkdownEditorOptions {
  /** 初始内容 */
  doc?: string;
  /** 父容器 */
  parent: HTMLElement;
  /** 初始标记符显示策略 */
  displayMode?: MarkerDisplayMode;
  /** 初始自动配对级别 */
  autoPairMode?: AutoPairMode;
  /** 初始：单个 `$` 是否作为行内公式定界符（默认开） */
  inlineMathSingleDollar?: boolean;
  /** 内容变化回调 */
  onChange?: (value: string) => void;
  /** 选区变化回调 */
  onSelectionChange?: (value: string) => void;
}

/**
 * 构造编辑器扩展列表。
 *
 * `autoPairBox` 是 Compartment：自动配对要在运行时切换（设置面板改一下就生效），
 * 而 Compartment 可以在不重建编辑器的前提下换掉一组扩展。
 */
function buildExtensions(
  options: MarkdownEditorOptions,
  autoPairBox: Compartment,
): Extension[] {
  return [
    // 编辑历史（撤销/重做）
    history(),
    // 搜索
    // 显式挂 `search()`：CM6 的 `openSearchPanel` 内部靠 `togglePanel` 状态效果
    // 打开面板，而这个效果必须由 `searchState` 字段消费。挂上之后，
    // 菜单的「查找 / 替换」和快捷键 ⌘F 走的是同一条路径，行为完全一致。
    search(),
    highlightSelectionMatches(),
    // Markdown 语法高亮（源码模式下也有用）
    markdown({
      base: gfmMarkdownLanguage,
      codeLanguages: languages,
      addKeymap: true,
    }),
    // Live Preview：行内标记的实时隐藏/展开
    livePreview(),
    // 自动配对（可在运行时切换级别）
    autoPairBox.of(autoPair(options.autoPairMode ?? "off")),
    // 粘贴：网页富文本 → Markdown（图片粘贴也走这里，见 image-insert）
    markdownPaste(),
    // 拖放：把图片文件存进 assets/ 并插入
    imageDrop(),
    // 焦点模式 / 打字机模式（两者都由设置面板的开关控制）
    focusMode(),
    typewriter(),
    // 补全：`:前缀` 出 Emoji，行首 `/` 出斜杠菜单（两者共用一个弹层）
    inkstoneAutocomplete(),
    // 敲出 `](` 时在光标旁弹 URL 输入框
    linkPopoverTrigger,
    // 复制：同时写 Markdown 源码与渲染后的 HTML
    markdownCopy(),
    // 键盘映射
    // 剪贴板快捷键：Tauri 里原生菜单的 accelerator 也会响应，
    // 重复执行是无害的（复制幂等、纯文本标志是幂等的置位），
    // 但在浏览器开发模式（无原生菜单）下这两个快捷键是唯一入口。
    keymap.of([
      // 列表续行必须排在 defaultKeymap 之前：
      // defaultKeymap 的 Enter 是 insertNewlineAndIndent，
      // 它会直接换行而不带列表符号。
      { key: "Enter", run: continueListOnEnter },
      { key: "Tab", run: indentListItem },
      { key: "Shift-Tab", run: outdentListItem },
      ...defaultKeymap,
      ...historyKeymap,
      // CM6 的 `searchKeymap` 自带 Mod-f，但它绑的是**原生** `openSearchPanel`——
      // 那个函数在首次打开面板时不会把焦点挪进查找框（面板的 mount() 只做了
      // select()，那不改变焦点），焦点会留在编辑器里，
      // 于是用户按完 ⌘F 再打字，字会打进正文而不是搜索框。
      // 所以这里把 Mod-f 换掉，其余（F3 / Mod-g / Mod-d / Mod-Alt-g）照用。
      ...searchKeymap.filter((binding) => binding.key !== "Mod-f"),
      { key: "Mod-f", run: (view) => openFindPanel(view), scope: "editor search-panel" },
      indentWithTab,
      // 命令面板。放在 defaultKeymap 之前不必要（⌘K 与它不冲突），
      // 但和格式化快捷键放在一起，便于一眼看全「键盘能干什么」
      { key: "Mod-k", run: () => (openPalette(), true) },
      // 快速打开：按文件名模糊匹配整个笔记库。
      // 和 ⌘K 分开是因为意图不同——⌘K 找「命令」，⌘P 找「文件」，
      // 混在一个列表里会互相干扰
      { key: "Mod-p", run: () => (openPalette("", "file"), true) },
      { key: "Mod-b", run: (view) => runCommand("format.bold", view) },
      { key: "Mod-i", run: (view) => runCommand("format.italic", view) },
      { key: "Mod-e", run: (view) => runCommand("format.code", view) },
      {
        key: "Mod-Shift-c",
        run: (view) => {
          void copySelectionAsHtml(view);
          return true;
        },
      },
      {
        key: "Mod-Shift-v",
        run: (view) => {
          armPlainTextPaste(view);
          return true;
        },
      },
    ]),
    // 视图
    lineNumbers(),
    highlightActiveLine(),
    EditorView.lineWrapping,
    EditorView.theme({
      "&": {
        height: "100%",
        fontSize: "var(--ink-font-size, 16px)",
        backgroundColor: "transparent",
      },
      ".cm-content": {
        fontFamily: "var(--ink-font-family, sans-serif)",
        lineHeight: "var(--ink-line-height, 1.6)",
        maxWidth: "var(--ink-content-width, 46rem)",
        margin: "0 auto",
        padding: "24px 16px 40vh",
        caretColor: "var(--ink-accent, #0969da)",
      },
      ".cm-scroller": {
        fontFamily: "var(--ink-font-family, sans-serif)",
      },
      "&.cm-focused": {
        outline: "none",
      },
    }),
    // 状态回调
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const text = update.state.doc.toString();
        if (!mermaidPrimed && text.includes("```mermaid")) {
          mermaidPrimed = true;
          primeMermaid();
        }
        options.onChange?.(text);
      }
      if (update.selectionSet && options.onSelectionChange) {
        options.onSelectionChange(
          update.state.sliceDoc(
            update.state.selection.main.from,
            update.state.selection.main.to,
          ),
        );
      }
    }),
  ];
}

export interface MarkdownEditorHandle {
  /** 获取当前内容 */
  getValue(): string;
  /** 设置内容（会重置撤销历史） */
  setValue(value: string): void;
  /** 聚焦编辑器 */
  focus(): void;
  /** 切换标记符显示策略 */
  setDisplayMode(mode: MarkerDisplayMode): void;
  /** 切换自动配对级别 */
  setAutoPairMode(mode: AutoPairMode): void;
  /** 切换行内公式的定界符策略（单 `$` 是否算） */
  setInlineMathSingleDollar(enabled: boolean): void;
  /** 切换焦点模式（弱化光标所在段落之外的内容） */
  setFocusMode(enabled: boolean): void;
  /** 切换打字机模式（光标固定在视口垂直中线） */
  setTypewriterMode(enabled: boolean): void;
  /** 复制为渲染后的 HTML（同时附带 Markdown 源码作为纯文本兜底） */
  copyAsHtml(): Promise<void>;
  /** 复制为 Markdown 源码（纯文本） */
  copyAsMarkdown(): Promise<void>;
  /** 让下一次粘贴只用纯文本（一次性） */
  pasteAsPlainText(): void;
  /** 销毁编辑器 */
  destroy(): void;
  /** 底层视图（高级用法：查找替换面板、滚动定位等） */
  view: EditorView;
}

export function createMarkdownEditor(
  options: MarkdownEditorOptions,
): MarkdownEditorHandle {
  const autoPairBox = new Compartment();
  const state = EditorState.create({
    doc: options.doc ?? "",
    extensions: buildExtensions(options, autoPairBox),
  });

  const view = new EditorView({
    state,
    parent: options.parent,
  });

  // 后台预热 emoji 数据（补全源本身是同步的，见 emoji.ts 的说明）
  preloadEmojiData();

  // 登记为当前活动编辑器（大纲面板点击跳转要用）。
  // destroy 时注销，避免侧边栏指向一个已销毁的视图。
  setActiveEditorView(view);

  // StateField 没有「初始值」配置项，只能在创建后派发一次 effect 设置。
  // 这条 effect 不会进撤销栈（它不是 change），所以不会污染用户的 ⌘Z。
  if (options.displayMode && options.displayMode !== "live") {
    setDisplayModeOf(view, options.displayMode);
  }

  return {
    getValue: () => view.state.doc.toString(),
    setValue: (value: string) => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        // 程序化替换（比如打开另一个文件）不该出现在用户的撤销栈里，
        // 否则用户按 ⌘Z 会把「打开文件」撤销掉。
        annotations: Transaction.addToHistory.of(false),
      });
    },
    focus: () => view.focus(),
    setDisplayMode: (mode: MarkerDisplayMode) => setDisplayModeOf(view, mode),
    setAutoPairMode: (mode: AutoPairMode) => {
      view.dispatch({ effects: autoPairBox.reconfigure(autoPair(mode)) });
    },
    setInlineMathSingleDollar: (enabled: boolean) =>
      setMathOptionsOf(view, { singleDollarTextMath: enabled }),
    setFocusMode: (enabled: boolean) => setFocusModeOf(view, enabled),
    setTypewriterMode: (enabled: boolean) => setTypewriterModeOf(view, enabled),
    copyAsHtml: () => copySelectionAsHtml(view),
    copyAsMarkdown: () => copySelectionAsMarkdown(view),
    pasteAsPlainText: () => {
      // 置位一次性标志；下一次 paste 事件会消费它
      armPlainTextPaste(view);
      view.focus();
    },
    destroy: () => {
      setActiveEditorView(null);
      view.destroy();
    },
    view,
  };
}

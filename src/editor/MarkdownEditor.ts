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
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { languages } from "@codemirror/language-data";
import { livePreview, setDisplayModeOf } from "./live-preview";
import { autoPair } from "./auto-pair";
import { markdownPaste } from "./paste";
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
    highlightSelectionMatches(),
    // Markdown 语法高亮（源码模式下也有用）
    markdown({
      base: markdownLanguage,
      codeLanguages: languages,
      addKeymap: true,
    }),
    // Live Preview：行内标记的实时隐藏/展开
    livePreview(),
    // 自动配对（可在运行时切换级别）
    autoPairBox.of(autoPair(options.autoPairMode ?? "off")),
    // 粘贴：网页富文本 → Markdown
    markdownPaste(),
    // 键盘映射
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
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
      if (update.docChanged && options.onChange) {
        options.onChange(update.state.doc.toString());
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
    destroy: () => view.destroy(),
    view,
  };
}

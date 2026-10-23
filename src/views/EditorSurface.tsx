/**
 * 编辑区。
 *
 * M1 起由 CodeMirror 6 承担（Live Preview + 源码模式）。
 * 对外仍然只暴露「Markdown 文本」，不泄露编辑器内部结构。
 */

import { useEffect, useRef } from "react";
import { createMarkdownEditor, type MarkdownEditorHandle } from "@/editor/MarkdownEditor";
import { useDocument } from "@/ipc/document";
import { onMenuAction } from "@/ipc/menu";
import { runCommand } from "@/editor/commands";
import { useSettings } from "@/settings/store";
import { MARKER_DISPLAY_MODES } from "@/settings/schema";

interface Props {
  onOpenSettings: () => void;
}

export function EditorSurface({ onOpenSettings }: Props) {
  const { doc, save, create, setContent } = useDocument();
  const [settings, updateSettings] = useSettings();
  const markerDisplay = settings.editor.markerDisplay;
  const autoPairMode = settings.editor.autoPairMode;
  const inlineMathSingleDollar = settings.markdown.inlineMathSingleDollar;
  const focusMode = settings.editor.focusMode;
  const typewriterMode = settings.editor.typewriterMode;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<MarkdownEditorHandle | null>(null);
  /** 上一次同步进编辑器的值，用来避免回环更新 */
  const lastSyncedRef = useRef<string>("");

  // 创建编辑器（只做一次）
  useEffect(() => {
    if (!hostRef.current) return;
    const editor = createMarkdownEditor({
      parent: hostRef.current,
      doc: "",
      displayMode: markerDisplay,
      autoPairMode,
      inlineMathSingleDollar,
      onChange: (value) => {
        lastSyncedRef.current = value;
        setContent(value);
      },
    });
    editorRef.current = editor;
    return () => {
      editor.destroy();
      editorRef.current = null;
    };
    // 只在挂载时创建一次；markerDisplay / autoPairMode 的变化由下面的 effect 单独同步
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setContent]);

  // 外部内容变化 → 同步进编辑器
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (doc.content === lastSyncedRef.current) return;
    if (editor.getValue() === doc.content) return;
    lastSyncedRef.current = doc.content;
    editor.setValue(doc.content);
  }, [doc.content]);

  // 设置里的显示策略变化 → 同步到编辑器
  useEffect(() => {
    editorRef.current?.setDisplayMode(markerDisplay);
  }, [markerDisplay]);

  // 设置里的自动配对级别变化 → 同步到编辑器
  useEffect(() => {
    editorRef.current?.setAutoPairMode(autoPairMode);
  }, [autoPairMode]);

  // 设置里的「单 $ 也当行内公式」变化 → 同步到编辑器。
  // 它直接透传给 remark-math，所以导出的 HTML 与编辑器表现一致。
  useEffect(() => {
    editorRef.current?.setInlineMathSingleDollar(inlineMathSingleDollar);
  }, [inlineMathSingleDollar]);

  // 焦点模式 / 打字机模式：都走设置层的开关（持久化），编辑器侧只接收结果
  useEffect(() => {
    editorRef.current?.setFocusMode(focusMode);
  }, [focusMode]);

  useEffect(() => {
    editorRef.current?.setTypewriterMode(typewriterMode);
  }, [typewriterMode]);

  // 菜单动作：剪贴板相关（作用在编辑器实例上，所以订阅放在这一层）
  useEffect(() => {
    const offs = [
      onMenuAction("copy-as-html", () => void editorRef.current?.copyAsHtml()),
      onMenuAction("copy-as-markdown", () => void editorRef.current?.copyAsMarkdown()),
      onMenuAction("paste-as-plain-text", () => editorRef.current?.pasteAsPlainText()),
      // 查找 / 替换：走命令表（`find.open` / `find.replace`），
      // 这样原生菜单、命令面板、快捷键三条路是**同一个入口**，
      // 不会出现「菜单里能用、面板里不能用」这种分叉。
      onMenuAction("find", () => {
        const view = editorRef.current?.view;
        if (view) runCommand("find.open", view);
      }),
      onMenuAction("replace", () => {
        const view = editorRef.current?.view;
        if (view) runCommand("find.replace", view);
      }),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, []);

  // 工具栏按钮：在三种显示策略之间循环
  const cycleDisplayMode = () => {
    const index = MARKER_DISPLAY_MODES.findIndex((m) => m.value === markerDisplay);
    const next = MARKER_DISPLAY_MODES[(index + 1) % MARKER_DISPLAY_MODES.length];
    // 走设置层，保证持久化；编辑器侧由上面的 effect 同步
    updateSettings({ editor: { markerDisplay: next.value } });
  };

  const modeLabel =
    MARKER_DISPLAY_MODES.find((m) => m.value === markerDisplay)?.label ?? markerDisplay;

  return (
    <div className="editor-surface">
      <header className="editor-toolbar">
        <span className="editor-toolbar__path">
          {doc.title}
          {doc.dirty ? " •" : ""}
        </span>
        <div className="editor-toolbar__actions">
          <button
            type="button"
            className="btn"
            onClick={cycleDisplayMode}
            title={`显示策略：${modeLabel}（点击切换）`}
          >
            {markerDisplay === "live"
              ? "实时预览"
              : markerDisplay === "dimmed"
                ? "弱化显示"
                : "源码模式"}
          </button>
          <button type="button" className="btn" onClick={create}>
            新建
          </button>
          <button type="button" className="btn" onClick={() => void save()}>
            保存
          </button>
          <button type="button" className="btn" onClick={onOpenSettings}>
            设置
          </button>
        </div>
      </header>
      <div className="editor-host" ref={hostRef} />
    </div>
  );
}

/**
 * 编辑区。
 *
 * M1 起由 CodeMirror 6 承担（Live Preview + 源码模式）。
 * 对外仍然只暴露「Markdown 文本」，不泄露编辑器内部结构。
 */

import { useEffect, useRef, useState } from "react";
import { createMarkdownEditor, type MarkdownEditorHandle } from "@/editor/MarkdownEditor";
import { useDocument } from "@/ipc/document";

interface Props {
  onOpenSettings: () => void;
}

export function EditorSurface({ onOpenSettings }: Props) {
  const { doc, save, create, setContent } = useDocument();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<MarkdownEditorHandle | null>(null);
  /** 上一次同步进编辑器的值，用来避免回环更新 */
  const lastSyncedRef = useRef<string>("");
  /** 是否处于实时预览模式（true）还是源码模式（false） */
  const [livePreview, setLivePreview] = useState(true);

  // 创建编辑器（只做一次）
  useEffect(() => {
    if (!hostRef.current) return;
    const editor = createMarkdownEditor({
      parent: hostRef.current,
      doc: "",
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

  // 切换实时预览 / 源码模式
  const toggleLivePreview = () => {
    const next = !livePreview;
    setLivePreview(next);
    editorRef.current?.setLivePreview(next);
  };

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
            onClick={toggleLivePreview}
            title="切换实时预览 / 源码模式（⌘/）"
          >
            {livePreview ? "实时预览" : "源码模式"}
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

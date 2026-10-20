/**
 * 编辑区（M0 临时实现）。
 *
 * M0 用受控 textarea 验证「打开 → 编辑 → 保存 → 字数统计 → 主题」这条链路。
 * M1 会整体替换为 Milkdown 内核（Live Preview + 源码模式），本组件届时只保留外壳职责。
 */

import { useDocument } from "@/ipc/document";

interface Props {
  onOpenSettings: () => void;
}

export function EditorSurface({ onOpenSettings }: Props) {
  const { doc, open, save, create, setContent } = useDocument();

  return (
    <div className="editor-surface">
      <header className="editor-toolbar">
        <span className="editor-toolbar__path">
          {doc.title}
          {doc.dirty ? " •" : ""}
        </span>
        <div className="editor-toolbar__actions">
          <button type="button" className="btn" onClick={create}>
            新建
          </button>
          <button type="button" className="btn" onClick={() => void open()}>
            打开
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void save()}
            disabled={!doc.path || !doc.dirty}
          >
            保存
          </button>
          <button type="button" className="btn" onClick={onOpenSettings}>
            设置
          </button>
        </div>
      </header>
      <textarea
        className="editor-textarea"
        value={doc.content}
        spellCheck={false}
        placeholder="在此输入 Markdown…"
        onChange={(event) => setContent(event.target.value)}
      />
    </div>
  );
}

/**
 * 侧边栏：面板标签（大纲 / 文件 / 搜索）。
 *
 * 大纲面板由 `useDocumentIndex` 提供数据——**防抖的 mdast 解析**，
 * 所以标题集合与导出/大纲的语义来源一致（架构约束 C）。
 */

import { useEffect, useState } from "react";
import { useDocument } from "@/ipc/document";
import {
  requestIndex,
  useDocumentIndex,
  type DocumentIndex,
} from "@/editor/document-index";
import { scrollEditorTo } from "@/editor/active-view";
import { FileTreePanel } from "@/views/FileTreePanel";

type PanelId = "outline" | "files" | "search";

const PANELS: { id: PanelId; label: string }[] = [
  { id: "outline", label: "大纲" },
  { id: "files", label: "文件" },
  { id: "search", label: "搜索" },
];

export function Sidebar() {
  const [active, setActive] = useState<PanelId>("outline");
  const { doc } = useDocument();
  const index = useDocumentIndex();

  // 内容一变就请求重建（内部有防抖）
  useEffect(() => {
    requestIndex(doc.content);
  }, [doc.content]);

  return (
    <aside className="app__sidebar">
      <div className="panel-tabs" role="tablist">
        {PANELS.map((panel) => (
          <button
            key={panel.id}
            type="button"
            role="tab"
            className="panel-tab"
            aria-selected={active === panel.id}
            onClick={() => setActive(panel.id)}
          >
            {panel.label}
          </button>
        ))}
      </div>
      <div className="panel-body">
        {active === "outline" && <OutlinePanel index={index} />}
        {active === "files" && <FileTreePanel />}
        {active === "search" && <p className="panel-placeholder">全局搜索将在 M3 提供</p>}
      </div>
    </aside>
  );
}

function OutlinePanel({ index }: { index: DocumentIndex | null }) {
  // index 为 null = 解析器还没加载完 / 还在算。
  // 这和「文档确实没有标题」是两回事，界面必须区分开。
  if (index === null) {
    return <p className="panel-placeholder">正在分析文档结构…</p>;
  }
  if (index.outline.length === 0) {
    return <p className="panel-placeholder">这份文档还没有标题</p>;
  }
  // 空标题在数据层是空串，显示占位是 UI 的事
  const label = (text: string) => text || "（无标题）";

  return (
    <nav className="outline" aria-label="大纲">
      <ul className="outline__list">
        {index.outline.map((item, i) => (
          <li key={`${item.from}-${i}`}>
            <button
              type="button"
              className="outline__item"
              // 用缩进表达层级：比 font-size 更稳，也不会因主题而失真
              style={{ paddingLeft: `${(item.depth - 1) * 12 + 8}px` }}
              title={item.text}
              onClick={() => scrollEditorTo(item.from)}
            >
              {label(item.text)}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * 状态栏：当前文件、字数统计、编辑模式指示。
 */

import { useSettings } from "@/settings/store";
import { useDocument } from "@/ipc/document";

export function StatusBar() {
  const { doc, stats } = useDocument();
  const [settings] = useSettings();

  return (
    <footer className="app__statusbar">
      <span>{doc.path ?? "未命名文档"}</span>
      {settings.editor.alwaysShowWordCount && (
        <span>
          {stats.words} 词 · {stats.chars} 字符
        </span>
      )}
      <span style={{ marginLeft: "auto" }}>
        {settings.markdown.inlineMath ? "数学已启用" : "数学已禁用"} ·{" "}
        {settings.markdown.mermaid ? "图表已启用" : "图表已禁用"}
      </span>
    </footer>
  );
}

/**
 * 状态栏：当前文件、字数统计、编辑模式指示。
 */

import { useSettings } from "@/settings/store";
import { useDocument } from "@/ipc/document";
import { useDocumentIndex } from "@/editor/document-index";

export function StatusBar() {
  const { doc } = useDocument();
  const [settings] = useSettings();
  const index = useDocumentIndex();

  // 保存失败 / 恢复快照写不进去，都必须让人看见。
  // 自动保存失败却一声不吭是最坏的结果：用户以为字已经存进磁盘了。
  const problem = doc.saveError
    ? `自动保存失败：${doc.saveError}`
    : doc.recoveryError
      ? `崩溃恢复不可用：${doc.recoveryError}`
      : null;

  return (
    <footer className="app__statusbar">
      <span>{doc.path ?? "未命名文档"}</span>
      {settings.editor.alwaysShowWordCount &&
        // 索引还没算出来时显示占位而不是 0：
        // 「0 词」会被读成「文档是空的」，那是个误导
        (index ? (
          <span>
            {index.stats.words} 词 · {index.stats.chars} 字符
          </span>
        ) : (
          <span>统计中…</span>
        ))}
      {problem && (
        <span className="app__statusbar-error" role="status">
          {problem}
        </span>
      )}
      <span style={{ marginLeft: "auto" }}>
        {settings.markdown.inlineMath ? "数学已启用" : "数学已禁用"} ·{" "}
        {settings.markdown.mermaid ? "图表已启用" : "图表已禁用"}
      </span>
    </footer>
  );
}

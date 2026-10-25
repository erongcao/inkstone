/**
 * 状态栏：当前文件、字数统计、编辑模式指示。
 */

import { useSettings } from "@/settings/store";
import { useDocument } from "@/ipc/document";
import { useDocumentIndex } from "@/editor/document-index";
import { t } from "@/i18n";

export function StatusBar() {
  const { doc } = useDocument();
  const [settings] = useSettings();
  const index = useDocumentIndex();

  // 保存失败 / 恢复快照写不进去，都必须让人看见。
  // 自动保存失败却一声不吭是最坏的结果：用户以为字已经存进磁盘了。
  const problem = doc.saveError
    ? t("自动保存失败：{error}", { error: doc.saveError })
    : doc.recoveryError
      ? t("崩溃恢复不可用：{error}", { error: doc.recoveryError })
      : doc.externalChange
        ? t("文件已被外部修改，自动保存已暂停")
        : null;

  return (
    <footer className="app__statusbar">
      <span>{doc.path ?? t("未命名文档")}</span>
      {settings.editor.alwaysShowWordCount &&
        // 索引还没算出来时显示占位而不是 0：
        // 「0 词」会被读成「文档是空的」，那是个误导
        (index ? (
          <span>
            {t("{words} 词 · {chars} 字符", {
              words: index.stats.words,
              chars: index.stats.chars,
            })}
          </span>
        ) : (
          <span>{t("统计中…")}</span>
        ))}
      {problem && (
        <span className="app__statusbar-error" role="status">
          {problem}
        </span>
      )}
      {doc.notice && (
        <span className="app__statusbar-notice" role="status">
          {doc.notice}
        </span>
      )}
      <span style={{ marginLeft: "auto" }}>
        {settings.markdown.inlineMath ? t("数学已启用") : t("数学已禁用")} ·{" "}
        {settings.markdown.mermaid ? t("图表已启用") : t("图表已禁用")}
      </span>
    </footer>
  );
}

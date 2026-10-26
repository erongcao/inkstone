/**
 * Markdown 语法参考。
 *
 * 之前「帮助 → Markdown 语法参考」是个**注册了但没人处理**的菜单项——
 * 点了没反应。现在它真的给出一张速查表。
 *
 * ## 为什么表里写的是「Inkstone 支持什么」
 *
 * 而不是 Markdown 规范怎么说。
 *
 * 规范里有一堆语法 Inkstone 还没实现（比如 `~下标~`、`^上标^`），
 * 把它们写进速查表等于骗用户——用户照着写，屏幕上什么都不发生。
 * 所以表里的每一行都是**实测过的**。
 *
 * ## 为什么不渲染成「预览」
 *
 * 想过做成「左边源码、右边效果」的样子，但渲染路径有两套：
 * 编辑器里的实时预览是 CodeMirror 装饰器，导出走的是 remark → rehype。
 * 两套输出的样式并不完全一样，速查表给出一个「导出时的样子」，
 * 反而会让人以为编辑器里也是那样。
 *
 * 速查表要的是**可靠**，不是好看：给源码，让用户自己在编辑器里试。
 */

import { t } from "@/i18n";
import { SYNTAX_GROUPS } from "@/reference/markdown-syntax";

interface Props {
  onClose: () => void;
}

export function MarkdownReferenceDialog({ onClose }: Props) {
  return (
    <div
      className="recovery-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t("Markdown 语法参考")}
    >
      <div className="recovery-panel recovery-panel--wide">
        <h2>{t("Markdown 语法参考")}</h2>

        <p className="recovery-text recovery-text--muted">
          {t("下面是 Inkstone 支持的 Markdown 语法。")}
        </p>

        <div className="syntax-reference">
          {SYNTAX_GROUPS.map((group) => (
            <section key={group.name} className="syntax-reference__group">
              <h3 className="syntax-reference__title">{t(group.name)}</h3>
              {group.note && <p className="syntax-reference__note">{t(group.note)}</p>}
              <ul className="syntax-reference__samples">
                {group.samples.map((sample) => (
                  <li key={sample} className="syntax-reference__item">
                    <code className="syntax-reference__sample">{t(sample)}</code>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="recovery-actions">
          <button type="button" className="btn btn--primary" onClick={onClose}>
            {t("关闭")}
          </button>
        </div>
      </div>
    </div>
  );
}

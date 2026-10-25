/**
 * 标签栏。
 *
 * 每个标签页有自己的内容、脏标记、撤销历史（见 views/EditorSurface.tsx）。
 * 这里只负责画出来 + 把点击转成动作。
 */

import { activateTab, closeTab, useDocument, useTabs } from "@/ipc/document";
import { t } from "@/i18n";

export function TabBar() {
  const tabs = useTabs();
  const { doc } = useDocument();

  return (
    <div className="tab-bar" role="tablist" aria-label={t("打开的文档")}>
      {tabs.map((tab) => {
        const active = tab.id === doc.tabId;
        // 未命名草稿的标题是「未命名」这个占位词——翻译在渲染时做，
        // 存下来的话语言一变，标签页标题就停在旧语言了
        const title = tab.path === null ? t("未命名") : tab.title;
        return (
          <div key={tab.id} className={`tab-bar__item${active ? " is-active" : ""}`}>
            <button
              type="button"
              role="tab"
              aria-selected={active}
              className="tab-bar__label"
              title={tab.path ?? title}
              onClick={() => activateTab(tab.id)}
            >
              <span className="tab-bar__title">{title}</span>
              {tab.dirty && (
                <span className="tab-bar__dot" aria-label={t("有未保存的改动")} />
              )}
            </button>
            <button
              type="button"
              className="tab-bar__close"
              aria-label={t("关闭 {title}", { title })}
              onClick={() => closeTab(tab.id)}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

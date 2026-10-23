/**
 * 标签栏。
 *
 * 每个标签页有自己的内容、脏标记、撤销历史（见 views/EditorSurface.tsx）。
 * 这里只负责画出来 + 把点击转成动作。
 */

import { activateTab, closeTab, useDocument, useTabs } from "@/ipc/document";

export function TabBar() {
  const tabs = useTabs();
  const { doc } = useDocument();

  return (
    <div className="tab-bar" role="tablist" aria-label="打开的文档">
      {tabs.map((tab) => {
        const active = tab.id === doc.tabId;
        return (
          <div key={tab.id} className={`tab-bar__item${active ? " is-active" : ""}`}>
            <button
              type="button"
              role="tab"
              aria-selected={active}
              className="tab-bar__label"
              title={tab.path ?? tab.title}
              onClick={() => activateTab(tab.id)}
            >
              <span className="tab-bar__title">{tab.title}</span>
              {tab.dirty && <span className="tab-bar__dot" aria-label="有未保存的改动" />}
            </button>
            <button
              type="button"
              className="tab-bar__close"
              aria-label={`关闭 ${tab.title}`}
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

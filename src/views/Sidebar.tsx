/**
 * 侧边栏：面板标签（大纲 / 文件 / 搜索）。
 *
 * M0 阶段只有骨架与占位，M2/M3 填充实际功能。
 */

import { useState } from "react";

type PanelId = "outline" | "files" | "search";

const PANELS: { id: PanelId; label: string }[] = [
  { id: "outline", label: "大纲" },
  { id: "files", label: "文件" },
  { id: "search", label: "搜索" },
];

export function Sidebar() {
  const [active, setActive] = useState<PanelId>("outline");

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
        <p className="panel-placeholder">
          {active === "outline" && "大纲面板将在 M2 提供"}
          {active === "files" && "文件树将在 M3 提供"}
          {active === "search" && "全局搜索将在 M3 提供"}
        </p>
      </div>
    </aside>
  );
}

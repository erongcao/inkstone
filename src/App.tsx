/**
 * 应用外壳。
 *
 * M0 阶段：主题系统 + 设置面板 + 骨架布局 + 最小可用的文本编辑区。
 * M1 阶段：把 <EditorSurface> 换成 Milkdown 内核。
 */

import { useEffect, useState } from "react";
import { useThemeRuntime } from "@/theme/useThemeRuntime";
import { initMenuBridge, onMenuAction } from "@/ipc/menu";
import { useDocument } from "@/ipc/document";
import { useSettings } from "@/settings/store";
import { Sidebar } from "@/views/Sidebar";
import { EditorSurface } from "@/views/EditorSurface";
import { StatusBar } from "@/views/StatusBar";
import { SettingsPanel } from "@/views/SettingsPanel";

export default function App() {
  // 应用主题副作用（data-theme / data-mode / 版式变量 / 自定义 CSS）
  useThemeRuntime();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const { open, save, saveAs, create } = useDocument();
  const [settings, update] = useSettings();

  // 挂载原生菜单事件桥
  useEffect(() => {
    void initMenuBridge();
  }, []);

  // 菜单动作 → 具体行为
  useEffect(() => {
    const offs = [
      onMenuAction("new-document", () => create()),
      onMenuAction("open-document", () => void open()),
      onMenuAction("save-document", () => void save()),
      onMenuAction("save-document-as", () => void saveAs()),
      onMenuAction("preferences", () => setSettingsOpen(true)),
      onMenuAction("toggle-sidebar", () => setSidebarVisible((v) => !v)),
      onMenuAction("toggle-focus-mode", () =>
        update({ editor: { focusMode: !settings.editor.focusMode } }),
      ),
      onMenuAction("toggle-typewriter-mode", () =>
        update({ editor: { typewriterMode: !settings.editor.typewriterMode } }),
      ),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, [
    open,
    save,
    saveAs,
    create,
    update,
    settings.editor.focusMode,
    settings.editor.typewriterMode,
  ]);

  return (
    <div className="app" data-sidebar={sidebarVisible ? "visible" : "hidden"}>
      {sidebarVisible && <Sidebar />}
      <main className="app__main">
        <EditorSurface onOpenSettings={() => setSettingsOpen(true)} />
      </main>
      <StatusBar />
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

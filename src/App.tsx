/**
 * 应用外壳。
 *
 * M0 阶段：主题系统 + 设置面板 + 骨架布局 + 最小可用的文本编辑区。
 * M1 阶段：把 <EditorSurface> 换成 Milkdown 内核。
 */

import { useEffect, useState } from "react";
import { useThemeRuntime } from "@/theme/useThemeRuntime";
import { initMenuBridge, onMenuAction } from "@/ipc/menu";
import { openDocumentAt, useDocument } from "@/ipc/document";
import { useSettings } from "@/settings/store";
import { Sidebar } from "@/views/Sidebar";
import { EditorSurface } from "@/views/EditorSurface";
import { StatusBar } from "@/views/StatusBar";
import { SettingsPanel } from "@/views/SettingsPanel";
import { CommandPalette } from "@/views/CommandPalette";
import { LinkPopover } from "@/views/LinkPopover";
import { RecoveryDialog } from "@/views/RecoveryDialog";
import { onIntent } from "@/editor/intents";
import { startAutoSaveRuntime } from "@/document/autosave";
import {
  applyRecovery,
  discardRecovery,
  findRecoveryCandidate,
  type RecoveryCandidate,
} from "@/document/recovery";

export default function App() {
  // 应用主题副作用（data-theme / data-mode / 版式变量 / 自定义 CSS）
  useThemeRuntime();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const { open, save, saveAs, create } = useDocument();
  const [settings, update] = useSettings();
  const [recovery, setRecovery] = useState<RecoveryCandidate | null>(null);

  // 挂载原生菜单事件桥
  useEffect(() => {
    void initMenuBridge();
  }, []);

  // 自动保存 + 崩溃恢复快照：跟着文档内容走，组件卸载时要停掉定时器
  useEffect(() => startAutoSaveRuntime(), []);

  // 启动时检查有没有上次没保存完的改动
  useEffect(() => {
    if (!settings.general.restoreSession) return;
    let cancelled = false;
    void findRecoveryCandidate().then((candidate) => {
      if (!cancelled) setRecovery(candidate);
    });
    return () => {
      cancelled = true;
    };
  }, [settings.general.restoreSession]);

  // 从 Finder / 命令行打开文件
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen<string>("document://open", (event) => {
        void openDocumentAt(event.payload);
      }).then((fn) => {
        unlisten = fn;
      }),
    );
    return () => unlisten?.();
  }, []);

  // 命令面板发出的意图 → 具体行为。
  // 视图与文件相关的命令实现在 React 这一侧（见 editor/intents.ts 的说明）
  useEffect(() => {
    const off = onIntent((intent) => {
      switch (intent) {
        case "view.live":
          update({ editor: { markerDisplay: "live" } });
          break;
        case "view.dimmed":
          update({ editor: { markerDisplay: "dimmed" } });
          break;
        case "view.source":
          update({ editor: { markerDisplay: "source" } });
          break;
        case "view.toggle-focus-mode":
          update({ editor: { focusMode: !settings.editor.focusMode } });
          break;
        case "view.toggle-typewriter-mode":
          update({ editor: { typewriterMode: !settings.editor.typewriterMode } });
          break;
        case "file.new":
          create();
          break;
        case "file.save":
          void save();
          break;
      }
    });
    return off;
  }, [create, save, update, settings.editor.focusMode, settings.editor.typewriterMode]);

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
      {recovery && (
        <RecoveryDialog
          candidate={recovery}
          onRestore={() => {
            void applyRecovery(recovery);
            setRecovery(null);
          }}
          onDiscard={() => {
            discardRecovery();
            setRecovery(null);
          }}
        />
      )}
      <CommandPalette />
      <LinkPopover />
    </div>
  );
}

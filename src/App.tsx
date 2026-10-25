/**
 * 应用外壳。
 *
 * M0 阶段：主题系统 + 设置面板 + 骨架布局 + 最小可用的文本编辑区。
 * M1 阶段：把 <EditorSurface> 换成 Milkdown 内核。
 */

import { useCallback, useEffect, useState } from "react";
import { useThemeRuntime } from "@/theme/useThemeRuntime";
import { initMenuBridge, onMenuAction } from "@/ipc/menu";
import { openDocumentAt, useDocument } from "@/ipc/document";
import { useSettings } from "@/settings/store";
import { Sidebar } from "@/views/Sidebar";
import { EditorSurface } from "@/views/EditorSurface";
import { TabBar } from "@/views/TabBar";
import { StatusBar } from "@/views/StatusBar";
import { SettingsPanel } from "@/views/SettingsPanel";
import { ExportPanel } from "@/views/ExportPanel";
import { CommandPalette } from "@/views/CommandPalette";
import { LinkPopover } from "@/views/LinkPopover";
import { RecoveryDialog } from "@/views/RecoveryDialog";
import { ConflictDialog } from "@/views/ConflictDialog";
import { onIntent } from "@/editor/intents";
import { startAutoSaveRuntime } from "@/document/autosave";
import { exportDocument, type ExportResult } from "@/export/service";
import { findResolvedExportItem } from "@/export/items";
import { readSettings } from "@/settings/store";
import {
  resolveKeepLocal,
  resolveWithDisk,
  startWatchRuntime,
  useConflict,
} from "@/document/conflict";
import {
  applyRecovery,
  discardRecovery,
  refreshRecoveryCandidate,
  useRecoveryCandidate,
} from "@/document/recovery";

export default function App() {
  // 应用主题副作用（data-theme / data-mode / 版式变量 / 自定义 CSS）
  useThemeRuntime();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  /** 导出面板的运行状态（面板本身是受控组件） */
  const [exportRun, setExportRun] = useState<{
    /** 正在导出的格式 id */
    busy: string | null;
    /** 最近一次导出的结果 */
    result: ExportResult | null;
  }>({ busy: null, result: null });
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const { open, save, saveAs, create } = useDocument();
  const [settings, update] = useSettings();
  // 待恢复的会话是**派生**出来的：候选在模块加载时就定好了，
  // 这里只决定「要不要提示」——设置里关掉了恢复就不提示
  const recoveryCandidate = useRecoveryCandidate();
  const recovery = settings.general.restoreSession ? recoveryCandidate : null;
  const conflict = useConflict();

  // 挂载原生菜单事件桥
  useEffect(() => {
    void initMenuBridge();
  }, []);

  // 自动保存 + 崩溃恢复快照：跟着文档内容走，组件卸载时要停掉定时器
  useEffect(() => startAutoSaveRuntime(), []);

  // 挂载时再检查一次有没有待恢复的会话（模块加载时算的那次可能太早）
  useEffect(() => {
    refreshRecoveryCandidate();
  }, []);

  // 文件监听：检测当前文档在外部被修改
  useEffect(() => startWatchRuntime(), []);

  /**
   * 执行一次导出。
   *
   * 放在 App 而不是导出面板里，有两个原因：
   *   1. 快捷键触发的导出**不经过面板**——用户绑了 ⌘⇧1，按下去就该直接导出。
   *      执行逻辑只有一处，两条路径的行为才不会分叉。
   *   2. 面板里自动执行导出需要在 effect 里跑，
   *      而 effect 里同步 setState 会被 `react-hooks/set-state-in-effect` 拦下。
   *      放在事件处理器（意图回调 / 按钮点击）里，规则自然满足。
   */
  const runExport = useCallback(async (formatId: string) => {
    setExportRun({ busy: formatId, result: null });
    const outcome = await exportDocument(formatId);
    setExportRun({ busy: null, result: outcome });

    // PDF 走系统打印面板，面板不该关（用户还要在打印面板里操作）
    const item = findResolvedExportItem(formatId, readSettings().export.items);
    const isPdf = item?.format.kind === "pdf";
    // 成功且**没有警告**时才自动关面板——
    // 有警告时用户得留下来看到它（比如「公式在 Word 里变成了源码」）
    if (outcome.ok && !outcome.warnings?.length && !isPdf) {
      setTimeout(() => setExportOpen(false), 600);
    }
  }, []);

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
      switch (intent.type) {
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
        case "file.export":
          // 带 formatId = 直接导出那个格式（用户绑的快捷键）；
          // 不带 = 打开面板让用户选
          setExportOpen(true);
          if (intent.formatId) {
            void runExport(intent.formatId);
          } else {
            setExportRun({ busy: null, result: null });
          }
          break;
      }
    });
    return off;
  }, [
    create,
    save,
    update,
    runExport,
    settings.editor.focusMode,
    settings.editor.typewriterMode,
  ]);

  // 菜单动作 → 具体行为
  useEffect(() => {
    const offs = [
      onMenuAction("new-document", () => create()),
      onMenuAction("open-document", () => void open()),
      onMenuAction("save-document", () => void save()),
      onMenuAction("save-document-as", () => void saveAs()),
      onMenuAction("preferences", () => setSettingsOpen(true)),
      onMenuAction("export-document", () => {
        // 原生菜单的「导出…」是「打开面板」，不是「直接导出某个格式」
        setExportRun({ busy: null, result: null });
        setExportOpen(true);
      }),
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
        <TabBar />
        <EditorSurface onOpenSettings={() => setSettingsOpen(true)} />
      </main>
      <StatusBar />
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      {exportOpen && (
        <ExportPanel
          busy={exportRun.busy}
          result={exportRun.result}
          onRun={(formatId) => void runExport(formatId)}
          onClose={() => setExportOpen(false)}
        />
      )}
      {recovery && (
        <RecoveryDialog
          candidate={recovery}
          onRestore={() => applyRecovery(recovery)}
          onDiscard={() => discardRecovery()}
        />
      )}
      <CommandPalette />
      <LinkPopover />
      {conflict && (
        <ConflictDialog
          conflict={conflict}
          onUseDisk={() => resolveWithDisk()}
          onKeepLocal={() => resolveKeepLocal()}
        />
      )}
    </div>
  );
}

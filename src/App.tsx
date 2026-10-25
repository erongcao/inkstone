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
import { AiPanel } from "@/views/AiPanel";
import { CommandPalette } from "@/views/CommandPalette";
import { LinkPopover } from "@/views/LinkPopover";
import { RecoveryDialog } from "@/views/RecoveryDialog";
import { ConflictDialog } from "@/views/ConflictDialog";
import { UpdateDialog } from "@/views/UpdateDialog";
import { ShortcutsDialog } from "@/views/ShortcutsDialog";
import { MarkdownReferenceDialog } from "@/views/MarkdownReferenceDialog";
import { onIntent } from "@/editor/intents";
import { startAutoSaveRuntime } from "@/document/autosave";
import { exportDocument, type ExportResult } from "@/export/service";
import { findResolvedExportItem } from "@/export/items";
import { readSettings } from "@/settings/store";
import { openAiPanel, useAiPanel } from "@/ai/panel-store";
import { useLocale } from "@/i18n";
import { checkForUpdate, openUrl, type UpdateCheck } from "@/ipc/update";
import { syncNativeLocale } from "@/i18n/native";
import type { SettingsSectionId } from "@/settings/schema";
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

  // 订阅语言变化。
  //
  // 界面文案是在**渲染时**查字典的（`t()`），所以语言一变，
  // 必须有人重渲染整棵树——否则界面会停留在旧语言。
  // 这里订阅一次就够了：App 重渲染 → 所有子组件重渲染 → `t()` 重新查表。
  const locale = useLocale();

  // 原生菜单画在系统控件上，前端那套 `t()` 管不到它——
  // 语言变了要通知 Rust 一次，让它重建菜单。
  useEffect(() => {
    void syncNativeLocale(locale);
  }, [locale]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  /** 设置面板打开时落在哪个分区（AI 面板的「去设置」要直接落到 AI 分区） */
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>("appearance");
  const [exportOpen, setExportOpen] = useState(false);
  /** 导出面板的运行状态（面板本身是受控组件） */
  const [exportRun, setExportRun] = useState<{
    /** 正在导出的格式 id */
    busy: string | null;
    /** 最近一次导出的结果 */
    result: ExportResult | null;
  }>({ busy: null, result: null });
  const [sidebarVisible, setSidebarVisible] = useState(true);
  /** 「帮助」菜单里的两个速查面板（同一时刻只开一个） */
  const [helpPanel, setHelpPanel] = useState<"shortcuts" | "reference" | null>(null);
  /** 检查更新对话框的状态（结果与失败原因都在这里） */
  const [updateCheck, setUpdateCheck] = useState<{
    open: boolean;
    result: UpdateCheck | null;
    error: string | null;
  }>({ open: false, result: null, error: null });
  const { open, save, saveAs, create } = useDocument();
  const [settings, update] = useSettings();
  // 待恢复的会话是**派生**出来的：候选在模块加载时就定好了，
  // 这里只决定「要不要提示」——设置里关掉了恢复就不提示
  const recoveryCandidate = useRecoveryCandidate();
  const recovery = settings.general.restoreSession ? recoveryCandidate : null;
  const conflict = useConflict();
  // AI 面板的状态住在模块级 store 里（打开入口有三个），
  // 这里只订阅它决定要不要渲染
  const ai = useAiPanel();

  /** 打开设置面板并落在指定分区 */
  const openSettings = useCallback((section: SettingsSectionId = "appearance") => {
    setSettingsSection(section);
    setSettingsOpen(true);
  }, []);

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
   * 检查有没有新版本。
   *
   * 「查」与「显示」分两步：先打开对话框显示「正在检查…」，
   * 拿到结果再填进去——否则网络慢的时候点了菜单**什么反应都没有**，
   * 用户会以为菜单坏了。
   *
   * 失败也要说清楚原因，并给一个「重试」——
   * 静默失败是最坏的体验。
   */
  const runUpdateCheck = useCallback(async () => {
    setUpdateCheck({ open: true, result: null, error: null });
    try {
      const result = await checkForUpdate();
      setUpdateCheck({ open: true, result, error: null });
    } catch (err) {
      setUpdateCheck({
        open: true,
        result: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

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
        case "app.check-update":
          // 原生菜单与命令面板是同一个动作，都落到这一处
          void runUpdateCheck();
          break;
        case "app.show-shortcuts":
          setHelpPanel("shortcuts");
          break;
        case "app.show-markdown-reference":
          setHelpPanel("reference");
          break;
        case "ai.open":
          openAiPanel(intent.tab ?? "rewrite");
          break;
      }
    });
    return off;
  }, [
    create,
    save,
    update,
    runExport,
    runUpdateCheck,
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
      onMenuAction("check-update", () => void runUpdateCheck()),
      // 「Markdown 语法参考」与「快捷键一览」之前也是**注册了但没人处理**
      // 的菜单项——点了没反应。现在一个给语法速查表，一个给键位表。
      onMenuAction("markdown-reference", () => setHelpPanel("reference")),
      onMenuAction("shortcuts", () => setHelpPanel("shortcuts")),
      // 「项目主页」之前是**注册了但没人处理**的菜单项——点了没反应。
      onMenuAction(
        "open-homepage",
        () => void openUrl("https://github.com/erongcao/inkstone"),
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
    runUpdateCheck,
  ]);

  return (
    <div className="app" data-sidebar={sidebarVisible ? "visible" : "hidden"}>
      {sidebarVisible && <Sidebar />}
      <main className="app__main">
        <TabBar />
        <EditorSurface onOpenSettings={() => setSettingsOpen(true)} />
      </main>
      <StatusBar />
      {settingsOpen && (
        <SettingsPanel
          initialSection={settingsSection}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {ai.open && <AiPanel onOpenSettings={() => openSettings("ai")} />}
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
      {updateCheck.open && (
        <UpdateDialog
          result={updateCheck.result}
          error={updateCheck.error}
          onOpen={(url) => void openUrl(url)}
          onClose={() => setUpdateCheck((state) => ({ ...state, open: false }))}
          onRetry={() => void runUpdateCheck()}
        />
      )}
      <CommandPalette />
      <LinkPopover />
      {helpPanel === "shortcuts" && (
        <ShortcutsDialog onClose={() => setHelpPanel(null)} />
      )}
      {helpPanel === "reference" && (
        <MarkdownReferenceDialog onClose={() => setHelpPanel(null)} />
      )}
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

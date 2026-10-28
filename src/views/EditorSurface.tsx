/**
 * 编辑区。
 *
 * M1 起由 CodeMirror 6 承担（Live Preview + 源码模式）。
 * 对外仍然只暴露「Markdown 文本」，不泄露编辑器内部结构。
 */

import { useEffect, useMemo, useRef } from "react";
import type { EditorState } from "@codemirror/state";
import { createMarkdownEditor, type MarkdownEditorHandle } from "@/editor/MarkdownEditor";
import { useDocument, takePendingScroll } from "@/ipc/document";
import { scrollEditorTo } from "@/editor/active-view";
import { onMenuAction } from "@/ipc/menu";
import { runCommand } from "@/editor/commands";
import { useSettings } from "@/settings/store";
import { MARKER_DISPLAY_MODES } from "@/settings/schema";
import { featuresFromSettings } from "@/parser/features";
import type { CaptionOptions } from "@/parser/captions";
import { resolveExportItems } from "@/export/items";
import { setAiEditorBridge } from "@/ai/editor-bridge";
import { openAiPanel } from "@/ai/panel-store";
import { t } from "@/i18n";

interface Props {
  onOpenSettings: () => void;
}

export function EditorSurface({ onOpenSettings }: Props) {
  const { doc, save, create, setContent } = useDocument();
  const [settings, updateSettings] = useSettings();
  const markerDisplay = settings.editor.markerDisplay;
  const autoPairMode = settings.editor.autoPairMode;
  /**
   * Markdown 扩展开关。
   *
   * 用 `settings.markdown` 的**引用**做依赖：
   * 设置合并是深合并，没动 `markdown` 这一支时引用不变，
   * 于是改「主题」不会触发编辑器重解析。
   */
  const markdownFeatures = useMemo(
    () => featuresFromSettings(settings.markdown),
    [settings.markdown],
  );
  /**
   * 题注设置。
   *
   * 关掉时传 `null`——编辑器那边就知道「不启用题注」，
   * 而不是「用默认编号方式但什么都别渲染」。
   */
  const captionOptions = useMemo<CaptionOptions | null>(
    () =>
      settings.markdown.captions.enabled
        ? { numbering: settings.markdown.captions.numbering }
        : null,
    [settings.markdown.captions.enabled, settings.markdown.captions.numbering],
  );
  const focusMode = settings.editor.focusMode;
  const typewriterMode = settings.editor.typewriterMode;
  /**
   * 导出项的快捷键绑定。
   *
   * 依赖 `settings.export.items` 的**引用**——设置没改这个数组时引用不变，
   * 于是 useMemo 不会重算，下面的 effect 也不会重配 keymap。
   */
  const exportShortcuts = useMemo(
    () =>
      resolveExportItems(settings.export.items)
        .filter((item) => item.visible && item.shortcut)
        .map((item) => ({ shortcut: item.shortcut, formatId: item.format.id })),
    [settings.export.items],
  );
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<MarkdownEditorHandle | null>(null);
  /** 上一次同步进编辑器的值，用来避免回环更新 */
  const lastSyncedRef = useRef<string>("");
  /**
   * 每个标签页各自的编辑器状态。
   *
   * 状态里带着撤销历史与光标位置——切回上一页时整个状态换回去，
   * 用户按 ⌘Z 还能撤上一轮编辑。
   * 用「往同一个状态里塞新文档」代替的话，撤销栈会被清掉，
   * 切回来按 ⌘Z 会发现「什么都没得撤」，那比没有多标签更糟。
   */
  const statesRef = useRef(new Map<string, EditorState>());
  /** 当前编辑器对应的是哪个标签页 */
  const activeTabRef = useRef<string>("");

  // 创建编辑器（只做一次）
  useEffect(() => {
    if (!hostRef.current) return;
    const editor = createMarkdownEditor({
      parent: hostRef.current,
      doc: "",
      displayMode: markerDisplay,
      autoPairMode,
      features: markdownFeatures,
      onChange: (value) => {
        lastSyncedRef.current = value;
        setContent(value);
      },
    });
    editorRef.current = editor;
    // 把编辑器注册给 AI：面板在应用级浮层里，拿不到这个 ref。
    // 注册表里永远只有当前活动的那一个，AI 改的就是你眼前这份文档。
    setAiEditorBridge({
      getSource: () => editor.getValue(),
      getCursor: () => editor.getCursorOffset(),
      getSelection: () => editor.getSelectionRange(),
      replaceRange: (from, to, text) => editor.replaceRange(from, to, text),
      getState: () => editor.getState(),
    });
    return () => {
      editor.destroy();
      editorRef.current = null;
      setAiEditorBridge(null);
    };
    // 只在挂载时创建一次；markerDisplay / autoPairMode 的变化由下面的 effect 单独同步
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setContent]);

  // 切换标签页：换整个 EditorState（保住每页各自的撤销历史与光标位置）
  //
  // 必须排在「外部内容变化 → 同步进编辑器」之前：
  // 切换时把 lastSynced 一起更新掉，后面那个 effect 就不会
  // 又拿新内容去 setValue 一遍（那会把刚换好的状态又搅乱）。
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const nextId = doc.tabId;
    const previousId = activeTabRef.current;
    if (nextId === previousId) return;

    // 离开的那一页：把当前状态存下来（连同它的撤销栈）
    if (previousId) {
      statesRef.current.set(previousId, editor.getState());
    }

    const cached = statesRef.current.get(nextId);
    editor.setState(cached ?? editor.createState(doc.content));
    activeTabRef.current = nextId;
    lastSyncedRef.current = doc.content;
  }, [doc.tabId, doc.content]);

  // 外部内容变化 → 同步进编辑器
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (doc.content === lastSyncedRef.current) return;
    if (editor.getValue() === doc.content) return;
    lastSyncedRef.current = doc.content;
    editor.setValue(doc.content);
  }, [doc.content]);

  // 待执行的滚动（「跳到第 N 行」）：必须在状态换完之后做，
  // 否则偏移量是按旧文档算的
  useEffect(() => {
    const offset = takePendingScroll();
    if (offset !== null) scrollEditorTo(offset);
  });

  // 设置里的显示策略变化 → 同步到编辑器
  useEffect(() => {
    editorRef.current?.setDisplayMode(markerDisplay);
  }, [markerDisplay]);

  // 设置里的自动配对级别变化 → 同步到编辑器
  useEffect(() => {
    editorRef.current?.setAutoPairMode(autoPairMode);
  }, [autoPairMode]);

  // 设置里的 Markdown 扩展开关变化 → 同步到编辑器。
  //
  // 换开关会换掉 lezer 的 parser（扩展是配置期决定的），
  // 于是语法树要整篇重解析——编辑器的 `setMarkdownFeatures` 内部会判断
  // 「是不是真的变了」，没变就不动。
  useEffect(() => {
    editorRef.current?.setMarkdownFeatures(markdownFeatures);
  }, [markdownFeatures]);

  // 题注设置变化 → 同步到编辑器
  //
  // 题注不换 parser，只重算装饰器——比换 Markdown 开关轻得多。
  useEffect(() => {
    editorRef.current?.setCaptionOptions(captionOptions);
  }, [captionOptions]);

  // 焦点模式 / 打字机模式：都走设置层的开关（持久化），编辑器侧只接收结果
  useEffect(() => {
    editorRef.current?.setFocusMode(focusMode);
  }, [focusMode]);

  useEffect(() => {
    editorRef.current?.setTypewriterMode(typewriterMode);
  }, [typewriterMode]);

  // 导出项快捷键变化 → 重配编辑器的 keymap
  useEffect(() => {
    editorRef.current?.setExportShortcuts(exportShortcuts);
  }, [exportShortcuts]);

  // 菜单动作：剪贴板相关（作用在编辑器实例上，所以订阅放在这一层）
  useEffect(() => {
    const offs = [
      onMenuAction("copy-as-html", () => void editorRef.current?.copyAsHtml()),
      onMenuAction("copy-as-markdown", () => void editorRef.current?.copyAsMarkdown()),
      onMenuAction("paste-as-plain-text", () => editorRef.current?.pasteAsPlainText()),
      // 查找 / 替换：走命令表（`find.open` / `find.replace`），
      // 这样原生菜单、命令面板、快捷键三条路是**同一个入口**，
      // 不会出现「菜单里能用、面板里不能用」这种分叉。
      onMenuAction("find", () => {
        const view = editorRef.current?.view;
        if (view) runCommand("find.open", view);
      }),
      onMenuAction("replace", () => {
        const view = editorRef.current?.view;
        if (view) runCommand("find.replace", view);
      }),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, []);

  // 工具栏按钮：在三种显示策略之间循环
  const cycleDisplayMode = () => {
    const index = MARKER_DISPLAY_MODES.findIndex((m) => m.value === markerDisplay);
    const next = MARKER_DISPLAY_MODES[(index + 1) % MARKER_DISPLAY_MODES.length];
    // 走设置层，保证持久化；编辑器侧由上面的 effect 同步
    updateSettings({ editor: { markerDisplay: next.value } });
  };

  /*
   * 模式名要**先翻译再插值**。
   *
   * `MARKER_DISPLAY_MODES[i].label` 是中文原文（它就是翻译表的 key），
   * 直接插进 t() 的参数里，英文界面下这个 title 就会夹一段中文——
   * 按钮正文翻译了、悬停提示没翻译，最难发现的那种漏。
   */
  const modeLabel = t(
    MARKER_DISPLAY_MODES.find((m) => m.value === markerDisplay)?.label ?? markerDisplay,
  );

  return (
    <div className="editor-surface">
      <header className="editor-toolbar">
        <span className="editor-toolbar__path">
          {doc.path === null ? t("未命名") : doc.title}
          {doc.dirty ? " •" : ""}
        </span>
        <div className="editor-toolbar__actions">
          <button
            type="button"
            className="btn"
            onClick={cycleDisplayMode}
            title={t("显示策略：{mode}（点击切换）", { mode: modeLabel })}
          >
            {markerDisplay === "live"
              ? t("实时预览")
              : markerDisplay === "dimmed"
                ? t("弱化显示")
                : t("源码模式")}
          </button>
          <button type="button" className="btn" onClick={create}>
            {t("新建")}
          </button>
          <button type="button" className="btn" onClick={() => openAiPanel("rewrite")}>
            AI
          </button>
          <button type="button" className="btn" onClick={() => void save()}>
            {t("保存")}
          </button>
          <button type="button" className="btn" onClick={onOpenSettings}>
            {t("设置")}
          </button>
        </div>
      </header>
      <div className="editor-host" ref={hostRef} />
    </div>
  );
}

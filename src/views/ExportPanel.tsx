/**
 * 导出面板。
 *
 * 列出所有可用的导出项，点一下就导出。
 *
 * ## 为什么面板要显示 pandoc 的状态
 *
 * pandoc 是**外部程序**，用户不一定装了。如果把它藏起来，
 * 用户根本不知道「导出成 Word」这个功能存在；
 * 如果显示成可点但点了才报错，用户会以为是 bug。
 *
 * 所以：显示，但**标注不可用与原因**（如「未找到 pandoc」）。
 *
 * ## 为什么这个面板是 React 覆盖层
 *
 * 与命令面板、链接浮层一致——它们都是「盖在编辑器上面的浮层」，
 * 不是编辑器的一部分。用 React 组件实现，样式与生命周期都好管。
 *
 * ## 为什么面板只负责「显示」，不负责「执行」
 *
 * 执行在 App 那边（见 `App.tsx` 的 `runExport`）。两个原因：
 *
 *   1. **快捷键也要能导出**。用户在设置里给某个导出项绑了 ⌘⇧1，
 *      按下去就该直接导出——这条路径不经过面板。
 *      执行逻辑只有一处，两条路径的行为才不会分叉。
 *   2. **React 的规矩**。自动执行导出需要在 effect 里跑，
 *      而 effect 里同步 setState 会被 `react-hooks/set-state-in-effect` 拦下。
 *      把执行放到事件处理器（App 的意图回调）里，规则自然满足。
 *
 * 所以面板是**受控组件**：状态由 App 给，动作由 App 接。
 */

import { useEffect, useState } from "react";
import { resolveExportItems, type ResolvedExportItem } from "@/export/items";
import { formatShortcut } from "@/shortcuts";
import { detectPandoc, type PandocInfo } from "@/ipc/export";
import type { ExportResult } from "@/export/service";
import { readSettings } from "@/settings/store";
import { t } from "@/i18n";

interface Props {
  onClose: () => void;
  /** 正在导出的格式 id */
  busy: string | null;
  /** 最近一次导出的结果 */
  result: ExportResult | null;
  /** 点某个导出项 */
  onRun: (formatId: string) => void;
}

export function ExportPanel({ onClose, busy, result, onRun }: Props) {
  const [pandoc, setPandoc] = useState<PandocInfo | null>(null);

  // 面板一打开就探测 pandoc——
  // 否则用户要点一下才知道自己能不能导 Word
  useEffect(() => {
    let cancelled = false;
    void detectPandoc().then((info) => {
      if (!cancelled) setPandoc(info);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 导出项按用户的自定义来（增删、重排、重命名、快捷键）。
  // 直接读设置而不是 React state：面板是一次性的快照，
  // 用户在设置面板改完再打开导出面板，看到的必须是新的。
  const items = resolveExportItems(readSettings().export.items).filter(
    (item) => item.visible,
  );
  const nativeItems = items.filter((item) => item.format.kind !== "pandoc");
  const pandocItems = items.filter((item) => item.format.kind === "pandoc");

  return (
    <div
      className="export-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t("导出")}
    >
      <div className="export-panel">
        <header className="export-header">
          <h2>{t("导出")}</h2>
          <button type="button" className="btn" onClick={onClose}>
            {t("关闭")}
          </button>
        </header>

        <div className="export-body">
          {nativeItems.length > 0 && (
            <>
              <h3 className="export-group-title">{t("直接导出")}</h3>
              <div className="export-list">
                {nativeItems.map((item) => (
                  <ExportRow
                    key={item.format.id}
                    item={item}
                    disabled={busy !== null}
                    busy={busy === item.format.id}
                    onRun={onRun}
                  />
                ))}
              </div>
            </>
          )}

          {pandocItems.length > 0 && (
            <>
              <h3 className="export-group-title">
                {t("通过 pandoc 导出")}
                {pandoc && !pandoc.available && (
                  <span className="export-group-hint">{pandoc.reason}</span>
                )}
                {pandoc?.available && (
                  <span className="export-group-hint">{pandoc.version}</span>
                )}
              </h3>
              <div className="export-list">
                {pandocItems.map((item) => (
                  <ExportRow
                    key={item.format.id}
                    item={item}
                    disabled={busy !== null || !pandoc?.available}
                    busy={busy === item.format.id}
                    onRun={onRun}
                  />
                ))}
              </div>
            </>
          )}

          {result && (
            <p className={`export-result${result.ok ? "" : " export-result--error"}`}>
              {result.message}
            </p>
          )}

          {result?.warnings && result.warnings.length > 0 && (
            <div className="export-warnings">
              <h4 className="export-warnings-title">{t("导出完成，但有警告")}</h4>
              {result.warnings.map((warning, index) => (
                <p key={index} className="export-warning">
                  {warning}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface RowProps {
  item: ResolvedExportItem;
  disabled: boolean;
  busy: boolean;
  onRun: (formatId: string) => void;
}

function ExportRow({ item, disabled, busy, onRun }: RowProps) {
  const { format } = item;
  return (
    <button
      type="button"
      className="export-item"
      disabled={disabled}
      onClick={() => onRun(format.id)}
      data-export-id={format.id}
    >
      <span className="export-item-label">{t(item.label)}</span>
      <span className="export-item-desc">{t(format.description)}</span>
      <span className="export-item-ext">{format.extension}</span>
      {item.shortcut && (
        <span className="export-item-shortcut">{formatShortcut(item.shortcut)}</span>
      )}
      {busy && <span className="export-item-busy">{t("导出中…")}</span>}
    </button>
  );
}

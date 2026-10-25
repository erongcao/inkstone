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
 */

import { useEffect, useState } from "react";
import { BUILTIN_EXPORT_FORMATS, type ExportFormat } from "@/export/registry";
import { detectPandoc, type PandocInfo } from "@/ipc/export";
import { exportDocument, type ExportResult } from "@/export/service";

interface Props {
  onClose: () => void;
}

export function ExportPanel({ onClose }: Props) {
  const [pandoc, setPandoc] = useState<PandocInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);

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

  const run = async (format: ExportFormat) => {
    setBusy(format.id);
    setResult(null);
    try {
      const outcome = await exportDocument(format.id);
      setResult(outcome);
      // 成功且**没有警告**时才自动关面板——
      // 有警告时用户得留下来看到它（比如「公式在 Word 里变成了源码」）
      if (outcome.ok && !outcome.warnings?.length && format.kind !== "pdf") {
        setTimeout(onClose, 600);
      }
    } finally {
      setBusy(null);
    }
  };

  const nativeFormats = BUILTIN_EXPORT_FORMATS.filter(
    (format) => format.kind !== "pandoc",
  );
  const pandocFormats = BUILTIN_EXPORT_FORMATS.filter(
    (format) => format.kind === "pandoc",
  );

  return (
    <div className="export-overlay" role="dialog" aria-modal="true" aria-label="导出">
      <div className="export-panel">
        <header className="export-header">
          <h2>导出</h2>
          <button type="button" className="btn" onClick={onClose}>
            关闭
          </button>
        </header>

        <div className="export-body">
          <h3 className="export-group-title">直接导出</h3>
          <div className="export-list">
            {nativeFormats.map((format) => (
              <ExportRow
                key={format.id}
                format={format}
                disabled={busy !== null}
                busy={busy === format.id}
                onRun={() => void run(format)}
              />
            ))}
          </div>

          <h3 className="export-group-title">
            通过 pandoc 导出
            {pandoc && !pandoc.available && (
              <span className="export-group-hint">{pandoc.reason}</span>
            )}
            {pandoc?.available && (
              <span className="export-group-hint">{pandoc.version}</span>
            )}
          </h3>
          <div className="export-list">
            {pandocFormats.map((format) => (
              <ExportRow
                key={format.id}
                format={format}
                disabled={busy !== null || !pandoc?.available}
                busy={busy === format.id}
                onRun={() => void run(format)}
              />
            ))}
          </div>

          {result && (
            <p className={`export-result${result.ok ? "" : " export-result--error"}`}>
              {result.message}
            </p>
          )}

          {result?.warnings && result.warnings.length > 0 && (
            <div className="export-warnings">
              <h4 className="export-warnings-title">导出完成，但有警告</h4>
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
  format: ExportFormat;
  disabled: boolean;
  busy: boolean;
  onRun: () => void;
}

function ExportRow({ format, disabled, busy, onRun }: RowProps) {
  return (
    <button
      type="button"
      className="export-item"
      disabled={disabled}
      onClick={onRun}
      data-export-id={format.id}
    >
      <span className="export-item-label">{format.label}</span>
      <span className="export-item-desc">{format.description}</span>
      <span className="export-item-ext">{format.extension}</span>
      {busy && <span className="export-item-busy">导出中…</span>}
    </button>
  );
}

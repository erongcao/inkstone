/**
 * 文件冲突提示框。
 *
 * 文件在外部被改了，而编辑器里有没保存的改动——两边不能自动合并，
 * 也不能替用户选，所以问一句。
 */

import type { Conflict } from "@/document/conflict";

interface Props {
  conflict: Conflict;
  onUseDisk: () => void;
  onKeepLocal: () => void;
}

export function ConflictDialog({ conflict, onUseDisk, onKeepLocal }: Props) {
  return (
    <div
      className="recovery-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="文件冲突"
    >
      <div className="recovery-panel">
        <h2>文件在外部被修改</h2>

        <p className="recovery-text">
          文件 <code>{conflict.path}</code> 在你编辑期间被别的程序改过，
          而你这边还有没保存的改动。
        </p>

        <p className="recovery-text recovery-text--muted">
          两个版本都在，选一个继续。<strong>保留你的版本</strong>
          不会把磁盘上的改动抹掉——自动保存会一直暂停，直到你自己决定怎么存。
        </p>

        <div className="recovery-actions">
          <button type="button" className="btn" onClick={onKeepLocal}>
            保留我的版本
          </button>
          <button type="button" className="btn btn--primary" onClick={onUseDisk}>
            用磁盘版本
          </button>
        </div>
      </div>
    </div>
  );
}

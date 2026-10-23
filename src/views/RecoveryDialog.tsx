/**
 * 崩溃恢复提示框。
 *
 * 启动时发现磁盘上没有的改动，就问用户要不要捞回来。
 *
 * ## 为什么不做成「自动恢复」
 *
 * 自动恢复会替用户做决定：把磁盘上的版本换掉。
 * 万一磁盘上的版本才是用户想要的（比如他刚在别的编辑器里改过），
 * 自动恢复就等于用旧内容盖掉了新内容，而且用户还没意识到。
 * 问一句的代价是看一眼弹窗，收益是不会替用户做不可逆的决定。
 */

import type { RecoveryCandidate } from "@/document/recovery";

interface Props {
  candidate: RecoveryCandidate;
  onRestore: () => void;
  onDiscard: () => void;
}

/** 把时间戳说成人话 */
function formatTime(timestamp: number): string {
  if (!timestamp) return "未知时间";
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (sameDay) return `今天 ${time}`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`;
}

export function RecoveryDialog({ candidate, onRestore, onDiscard }: Props) {
  const many = candidate.unsavedCount > 1;

  return (
    <div
      className="recovery-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="恢复未保存的改动"
    >
      <div className="recovery-panel">
        <h2>发现未保存的改动</h2>

        <p className="recovery-text">
          {many ? (
            <>
              有 <strong>{candidate.unsavedCount}</strong> 个标签页在{" "}
              {formatTime(candidate.savedAt)} 还有没保存的版本。
            </>
          ) : (
            <>
              有 {candidate.unsavedCount} 个标签页在 {formatTime(candidate.savedAt)}{" "}
              还有没保存的版本。
            </>
          )}
        </p>

        <p className="recovery-text recovery-text--muted">
          {many
            ? `恢复会把这些标签页一起还原回来（当时打开的是「${candidate.title}」）。恢复后它们仍是「未保存」状态，你可以自己决定要不要写回磁盘。`
            : "恢复会把这个标签页还原回来。恢复后它仍是「未保存」状态，你可以自己决定要不要写回磁盘。"}
        </p>

        <div className="recovery-actions">
          <button type="button" className="btn" onClick={onDiscard}>
            丢弃
          </button>
          <button type="button" className="btn btn--primary" onClick={onRestore}>
            恢复
          </button>
        </div>
      </div>
    </div>
  );
}

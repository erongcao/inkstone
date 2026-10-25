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
import { t, tParts } from "@/i18n";

interface Props {
  candidate: RecoveryCandidate;
  onRestore: () => void;
  onDiscard: () => void;
}

/** 把时间戳说成人话 */
function formatTime(timestamp: number): string {
  if (!timestamp) return t("未知时间");
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (sameDay) return t("今天 {time}", { time });
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`;
}

export function RecoveryDialog({ candidate, onRestore, onDiscard }: Props) {
  const many = candidate.unsavedCount > 1;
  const time = formatTime(candidate.savedAt);

  /*
   * 多页时把页数单独加粗（原设计如此）。
   *
   * 用 tParts 把译文按 {count} 拆成三段，而不是拼字符串：
   * 拼字符串会让数字的位置写死在中文语序里，
   * 英文把数字放到句首时就拆错了。
   *
   * 单页时不走这条路径——英文的 tab 是单数，
   * 所以单数那句是**另一个 key**（见下面的 "有 1 个标签页…"）。
   * 中文渲染出来和当年一模一样，两个 key 只是为了让英文能区分单复数。
   */
  const parts = tParts(
    "有 {count} 个标签页在 {time} 还有没保存的版本。",
    { count: candidate.unsavedCount, time },
    "count",
  );

  return (
    <div
      className="recovery-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t("恢复未保存的改动")}
    >
      <div className="recovery-panel">
        <h2>{t("发现未保存的改动")}</h2>

        <p className="recovery-text">
          {many ? (
            <>
              {parts.before}
              <strong>{parts.value}</strong>
              {parts.after}
            </>
          ) : (
            <>{t("有 1 个标签页在 {time} 还有没保存的版本。", { time })}</>
          )}
        </p>

        <p className="recovery-text recovery-text--muted">
          {many
            ? t(
                "恢复会把这些标签页一起还原回来（当时打开的是「{title}」）。恢复后它们仍是「未保存」状态，你可以自己决定要不要写回磁盘。",
                { title: candidate.title },
              )
            : t(
                "恢复会把这个标签页还原回来。恢复后它仍是「未保存」状态，你可以自己决定要不要写回磁盘。",
              )}
        </p>

        <div className="recovery-actions">
          <button type="button" className="btn" onClick={onDiscard}>
            {t("丢弃")}
          </button>
          <button type="button" className="btn btn--primary" onClick={onRestore}>
            {t("恢复")}
          </button>
        </div>
      </div>
    </div>
  );
}

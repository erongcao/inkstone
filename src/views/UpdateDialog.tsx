/**
 * 检查更新的结果对话框。
 *
 * 四种结果，四种说法：
 * - 查到了新版本 → 说清版本号，给「打开下载页」
 * - 已是最新 → 说清当前版本，就完事了
 * - 还没有正式发布 → 给发布列表页
 * - 查询失败 → **把失败原因如实说出来**，并允许重试
 *
 * ## 为什么不自动下载
 *
 * 自动下载要发布签名密钥、增量包、跨平台安装器替换逻辑，
 * 而这个项目连第一个正式版本都还没发。
 * 现在做那些，等于给一个还不存在的发布流程写适配层。
 * 最简形态是「告诉用户有新版本，让他自己去下载页」。
 */

import { t } from "@/i18n";
import type { UpdateCheck } from "@/ipc/update";
import { useEscapeToClose } from "./use-escape";

interface Props {
  /** 检查结果；还在查的时候是 null */
  result: UpdateCheck | null;
  /** 失败原因；null 表示没失败 */
  error: string | null;
  /** 打开下载页 */
  onOpen: (url: string) => void;
  /** 关闭 */
  onClose: () => void;
  /** 重试 */
  onRetry: () => void;
}

export function UpdateDialog({ result, error, onOpen, onClose, onRetry }: Props) {
  const hasUpdate = result?.hasUpdate ?? false;
  const noRelease = result !== null && result.latest === "";

  // Esc 关闭
  useEscapeToClose(onClose);

  return (
    <div
      className="recovery-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t("检查更新")}
    >
      <div className="recovery-panel">
        <h2>{t("检查更新")}</h2>

        {error ? (
          <>
            <p className="recovery-text">{t("检查更新失败：{error}", { error })}</p>
            <p className="recovery-text recovery-text--muted">
              {t("请检查网络连接后重试。")}
            </p>
            <div className="recovery-actions">
              <button type="button" className="btn" onClick={onClose}>
                {t("关闭")}
              </button>
              <button type="button" className="btn btn--primary" onClick={onRetry}>
                {t("重试")}
              </button>
            </div>
          </>
        ) : !result ? (
          <>
            <p className="recovery-text">{t("正在检查…")}</p>
            <div className="recovery-actions">
              <button type="button" className="btn" onClick={onClose}>
                {t("取消")}
              </button>
            </div>
          </>
        ) : noRelease ? (
          <>
            <p className="recovery-text">
              {t("还没有正式发布的版本。当前是 {version}", { version: result.current })}
            </p>
            <div className="recovery-actions">
              <button type="button" className="btn" onClick={onClose}>
                {t("关闭")}
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => onOpen(result.url)}
              >
                {t("查看发布页")}
              </button>
            </div>
          </>
        ) : hasUpdate ? (
          <>
            <p className="recovery-text">
              {t("发现新版本 {latest}（当前 {current}）", {
                latest: result.latest,
                current: result.current,
              })}
            </p>
            {result.notes && <pre className="update-notes">{result.notes}</pre>}
            <div className="recovery-actions">
              <button type="button" className="btn" onClick={onClose}>
                {t("稍后")}
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => onOpen(result.url)}
              >
                {t("打开下载页")}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="recovery-text">
              {t("当前已是最新版本（{version}）", { version: result.current })}
            </p>
            <div className="recovery-actions">
              <button type="button" className="btn btn--primary" onClick={onClose}>
                {t("好")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

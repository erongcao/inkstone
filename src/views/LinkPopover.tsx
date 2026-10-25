/**
 * 链接浮层：敲出 `](` 之后在光标旁弹一个 URL 输入框。
 *
 * 和命令面板一样用 React 覆盖层而不是 CM6 补全——
 * URL 是自由文本，补全的候选模型在这里是负资产（理由见 editor/link-popover.ts）。
 *
 * ## 确认时插入什么
 *
 * 存的是 `](` 与光标之间那段的 URL，然后补一个 `)`。
 * 也就是说用户在浮层里输 `https://a.com` 后按 Enter，文档里得到
 * `[文字](https://a.com)`——**右括号是这里补的**，用户不需要自己敲。
 *
 * 已经有右括号（用户手快先敲了）就不重复补。
 */

import { useEffect, useMemo, useRef } from "react";
import { getActiveEditorView } from "@/editor/active-view";
import { t } from "@/i18n";
import {
  classifyUrl,
  closeLinkPopover,
  setLinkUrl,
  useLinkPopover,
} from "@/editor/link-popover";

export function LinkPopover() {
  const state = useLinkPopover();
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!state.open) return;
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [state.open]);

  // 关闭时把焦点还给编辑器。
  // ⚠️ 判据必须是 `!open`：写成 `open` 会在**打开时**也跑一遍，
  // 把焦点从浮层输入框抢回编辑器（命令面板踩过同一个坑）。
  useEffect(() => {
    if (state.open) return;
    const timer = window.setTimeout(() => getActiveEditorView()?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [state.open]);

  const kind = useMemo(() => classifyUrl(state.url), [state.url]);

  if (!state.open) return null;

  const confirm = () => {
    const view = getActiveEditorView();
    if (!view) {
      closeLinkPopover();
      return;
    }
    const url = state.url.trim();
    // 空输入 = 放弃（不要往文档里塞一个空的 `()`）
    if (!url) {
      closeLinkPopover();
      return;
    }
    const { pos } = state;
    const doc = view.state.doc;
    const at = Math.max(0, Math.min(pos, doc.length));
    // 自动配对开着时，文档里已经是 `]()`，光标在括号中间——
    // 这时**不能**再补一个 `)`，否则会得到 `](url))`
    const alreadyClosed = doc.sliceString(at, at + 1) === ")";
    const insert = alreadyClosed ? url : `${url})`;
    view.dispatch({
      changes: { from: at, insert },
      selection: { anchor: at + insert.length },
      userEvent: "input.complete",
    });
    closeLinkPopover();
    view.focus();
  };

  const cancel = () => {
    closeLinkPopover();
    getActiveEditorView()?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      confirm();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  };

  // 贴在光标下方；贴不下就翻到上方
  const below = state.anchor.bottom;
  const style: React.CSSProperties = {
    left: Math.max(12, Math.min(state.anchor.left, window.innerWidth - 420)),
  };
  if (below + 140 < window.innerHeight) style.top = below + 6;
  else style.bottom = Math.max(12, window.innerHeight - state.anchor.top + 6);

  return (
    <div className="link-popover" style={style} onKeyDown={onKeyDown}>
      <div className="link-popover__head">
        <span className="link-popover__title">
          {state.image ? t("图片链接") : t("链接地址")}
        </span>
        <span className="link-popover__hint">{t("回车确认 · Esc 取消")}</span>
      </div>
      <input
        ref={inputRef}
        className="link-popover__input"
        value={state.url}
        placeholder={t("https://example.com  或  ./relative/path.png")}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => setLinkUrl(event.target.value)}
        onBlur={() => {
          // 点面板外面 = 取消，但要先让内部点击跑完（mousedown 先于 blur）
          window.setTimeout(cancel, 120);
        }}
      />
      <div className="link-popover__foot">
        {kind === "url" && (
          <span className="link-popover__tag link-popover__tag--ok">{t("绝对地址")}</span>
        )}
        {kind === "path" && (
          <span className="link-popover__tag">{t("相对路径 / 锚点")}</span>
        )}
        {kind === "empty" && (
          <span className="link-popover__tag link-popover__tag--faint">
            {t("留空即放弃")}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * 查找 / 替换面板接线。
 *
 * 为什么不自己画一个面板：
 * - 正则、大小写、全词、`$1` 捕获组替换，CM6 原生就支持，自己重造必然漏
 * - 面板自身的交互（回车下一个、Esc 关闭、选中全部、Tab 在两个框之间跳）
 *   也是原生的，重造等于把 CM6 的搜索状态机再写一遍
 *
 * 所以这里只补 CM6 没替我们做的事：
 * 1. 把原生菜单的「查找 / 替换」接到面板上
 * 2. **把焦点明确挪到输入框**。CM6 的 `openSearchPanel` 只在「面板已经开着」
 *    的分支里才 focus 查找框；首次打开时它只 dispatch 一个 `togglePanel`，
 *    焦点还留在编辑器里——用户按完 ⌘F 再打字，字会打进正文而不是搜索框。
 *    面板的 `mount()` 里只有 `searchField.select()`，那不改变焦点。
 * 3. 「替换」时焦点落在替换框。CM6 永远聚焦查找框，
 *    对「我现在要填替换内容」这个意图来说是错位的。
 */

import { openSearchPanel } from "@codemirror/search";
import type { EditorView } from "@codemirror/view";

/**
 * CM6 把搜索面板挂在编辑器的 `.cm-panels` 容器里（`view.dom` 内），
 * 查找框与替换框分别叫 `search` 和 `replace`。
 */
const SEARCH_FIELD = '.cm-search input[name="search"]';
const REPLACE_FIELD = '.cm-search input[name="replace"]';

/**
 * 把焦点挪到面板里的某个输入框。
 *
 * 面板的 DOM 随 dispatch 同步挂上去，正常情况下第一次就能拿到；
 * 万一没拿到（面板正在切换中），下一帧再试一次，别让用户的按键落空。
 */
function focusField(view: EditorView, selector: string): void {
  const tryFocus = (): boolean => {
    const input = view.dom.querySelector<HTMLInputElement>(selector);
    if (!input) return false;
    input.focus();
    // 选中已有内容，用户直接打字就是覆盖（与浏览器查找框的行为一致）
    input.select();
    return true;
  };

  if (tryFocus()) return;
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => {
      tryFocus();
    });
  }
}

/** 打开查找面板（焦点落在查找框） */
export function openFindPanel(view: EditorView): boolean {
  openSearchPanel(view);
  focusField(view, SEARCH_FIELD);
  return true;
}

/** 打开替换面板（焦点落在替换框） */
export function openReplacePanel(view: EditorView): boolean {
  openSearchPanel(view);
  focusField(view, REPLACE_FIELD);
  return true;
}

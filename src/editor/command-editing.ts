/**
 * 命令要用到的编辑原语：包裹、行前缀、插入块。
 *
 * 单独抽一个文件是因为这三件事有**共用的陷阱**，散到各个命令里各写一遍必然各错一次：
 *
 * 1. **撤销步数**：一次「加粗」必须是**一个** undo step。
 *    拆成「删掉标记 + 插入标记 + 移光标」三个 dispatch，用户按一次 ⌘Z 只撤掉一半。
 * 2. **选区形状**：`EditorState.changeByRange` 会按每个 range 的**相对偏移**套用同一份 changes，
 *    多光标才能一起生效；自己遍历 range 手动算很容易漏掉 `anchor`/`head` 的方向。
 * 3. **程序化改动也要留名**：`Transaction.addToHistory.of(false)` 只用在**整篇替换**上
 *    （打开文件），格式化这种用户主动的操作必须留在历史里。
 */

import { EditorSelection, type ChangeSpec, type SelectionRange } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/**
 * 包裹/取消包裹。
 *
 * 三种情形：
 *   - 选区两侧**已经**是 marker → 拆掉（再按一次 ⌘B 取消加粗）
 *   - 选区非空 → 两侧各补一个
 *   - 选区为空 → 插入成对 marker，光标停在中间
 *
 * 拆包裹时要注意 marker 可能是多字符（`` ` ``、``**``、``==``、``~~``），
 * 而且拆完要把光标**收回到内容区间**，否则光标会落在 marker 之外，
 * 下一次按方向键会跳过一个字符。
 */
export function toggleWrap(view: EditorView, marker: string, placeholder = ""): boolean {
  const changes: ChangeSpec[] = [];
  const ranges: SelectionRange[] = [];

  for (const range of view.state.selection.ranges) {
    const selected = view.state.sliceDoc(range.from, range.to);
    const before = view.state.sliceDoc(
      Math.max(0, range.from - marker.length),
      range.from,
    );
    const after = view.state.sliceDoc(
      range.to,
      Math.min(view.state.doc.length, range.to + marker.length),
    );

    if (before === marker && after === marker) {
      // 已经包着了 → 拆掉
      changes.push({ from: range.from - marker.length, to: range.from, insert: "" });
      changes.push({ from: range.to, to: range.to + marker.length, insert: "" });
      const at = range.from - marker.length;
      ranges.push(EditorSelection.range(at, at + selected.length));
      continue;
    }

    const inner = selected || placeholder;
    changes.push({ from: range.from, to: range.to, insert: marker + inner + marker });
    if (selected) {
      ranges.push(
        EditorSelection.range(
          range.from + marker.length,
          range.from + marker.length + inner.length,
        ),
      );
    } else {
      // 空选区：光标停在两个 marker 之间
      const at = range.from + marker.length;
      ranges.push(EditorSelection.cursor(at));
    }
  }

  view.dispatch({
    changes,
    selection: EditorSelection.create(ranges, view.state.selection.mainIndex),
    userEvent: "input.format",
  });
  return true;
}

/**
 * 给选区覆盖的每一行加/去前缀。
 *
 * 用于标题、列表、引用。行为对齐 Typora：
 *   - 已有相同前缀 → 去掉（再按一次切回段落）
 *   - 已有别的同级前缀（`-` → `*`）→ 换掉
 *   - 都没有 → 加上
 *
 * `ordered` 有额外一层：有序列表还要**重排编号**，
 * 而且编号要连续（第二行接着第一行），不能每行都从 1 开始。
 */
export function toggleLinePrefix(
  view: EditorView,
  options: { bullet?: string; numbered?: boolean },
): boolean {
  const { bullet, numbered = false } = options;
  const state = view.state;
  const lines: { from: number; to: number; text: string }[] = [];
  for (const range of state.selection.ranges) {
    for (
      let n = state.doc.lineAt(range.from).number;
      n <= state.doc.lineAt(range.to).number;
      n++
    ) {
      const line = state.doc.line(n);
      if (!lines.some((l) => l.from === line.from)) {
        lines.push({ from: line.from, to: line.to, text: line.text });
      }
    }
  }

  // 当前**已经**是目标形态吗？是就整体去掉（取反的关键）
  const allHave = (test: (text: string) => boolean): boolean =>
    lines.every((line) => test(line.text));
  const hasBullet = bullet ? allHave((text) => text.startsWith(`${bullet} `)) : false;
  const hasNumber = numbered ? allHave((text) => /^\d+[.)] /.test(text)) : false;
  const shouldRemove = bullet ? hasBullet : hasNumber;

  const changes: ChangeSpec[] = [];
  // 有序列表的编号在去掉时要**保留**编号的起点（去掉第 3 项后，后面不该从 1 重新开始）
  let number = 0;
  for (const line of lines) {
    const lineTo = line.to;
    let text = line.text;

    if (shouldRemove) {
      if (bullet && hasBullet) {
        text = text.slice(bullet.length + 1);
      } else if (numbered && hasNumber) {
        // 保持行首对齐：`- 1.` → 内容
        text = text.replace(/^\d+[.)] /, "");
      }
      changes.push({ from: line.from, to: lineTo, insert: text });
      continue;
    }

    if (numbered) {
      number++;
      text = text.replace(/^\d+[.)] /, ""); // 换编号时先脱掉旧的
      changes.push({ from: line.from, to: lineTo, insert: `${number}. ${text}` });
    } else if (bullet) {
      text = text.replace(/^([-*+]|\d+[.)]) /, ""); // 同级前缀要换掉而不是叠加
      changes.push({ from: line.from, to: lineTo, insert: `${bullet} ${text}` });
    }
  }

  view.dispatch({ changes, userEvent: "input.format" });
  return true;
}

/**
 * 行首插入固定文本。
 *
 * **先把已有的 ATX 标题前缀剥掉再写新的**——标题级别是互斥的，
 * 在 `# 标题` 上再插 `# ` 会得到 `# # 标题` 而不是升级成 `## 标题`。
 * Typora / 多数编辑器都是这个行为。
 *
 * 只认 ATX（`#`）：Setext 标题是「上一行文字 + 下一行 ===」，
 * 改级别要动两行，不属于「行首前缀」这件事。
 */
export function prefixLines(view: EditorView, prefix: string): boolean {
  const changes: ChangeSpec[] = [];
  const state = view.state;
  for (const range of state.selection.ranges) {
    for (
      let n = state.doc.lineAt(range.from).number;
      n <= state.doc.lineAt(range.to).number;
      n++
    ) {
      const line = state.doc.line(n);
      const stripped = line.text.replace(/^#{1,6}\s+/, "");
      changes.push({ from: line.from, to: line.to, insert: prefix + stripped });
    }
  }
  view.dispatch({ changes, userEvent: "input.format" });
  return true;
}

/**
 * 让插入点成为一个**独立块**需要补几个换行。
 *
 * 不能无脑补 `\n\n`：选区前面本来就有一个空行时，再补两个会攒出四个换行，
 * 光标上方凭空多出两行空白。所以按已有内容算：
 *   - 前面什么都没有 → 0 个
 *   - 已经有空行 → 0 个（别重复补）
 *   - 只有一个换行 → 1 个
 *   - 和文字接在一起 → 2 个
 */
function blankLinesNeeded(text: string, atStart: boolean): number {
  if (text.length === 0) return 0;
  if (text.endsWith("\n\n")) return 0;
  if (text.endsWith("\n")) return 1;
  // 开头就已经是空行（`\n`）的话，一个换行就够断开
  if (atStart && text.startsWith("\n")) return 1;
  return 2;
}

/**
 * 插入一个块，并把光标放到块内的指定偏移。
 *
 * `cursorOffset` 是相对**插入文本开头**的偏移，允许落在块外面
 * （比如表格模板想让人落在最后一行之后）。落在外面时钳到合法范围。
 */
export function insertBlock(view: EditorView, text: string, cursorOffset = 0): boolean {
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc;
  // ⚠️ 后面那段必须从 `to` 开始取，**不能**从 `lineAt(to).to` 开始——
  // 光标停在段落中间时，`lineAt(to).to` 会把「本行剩下的文字」当成不存在，
  // 于是新块不会被断开，直接和后面的文字粘在一起。
  const head = doc.sliceString(0, from);
  const tail = doc.sliceString(to, doc.length);

  const prefix = "\n".repeat(blankLinesNeeded(head, from === 0));
  const suffix = "\n".repeat(blankLinesNeeded(tail, false));
  const payload = prefix + text + suffix;

  const at = from + prefix.length;
  const offset = Math.max(0, Math.min(cursorOffset, text.length));
  view.dispatch({
    changes: { from, to, insert: payload },
    selection: EditorSelection.cursor(at + offset),
    userEvent: "input.format",
  });
  return true;
}

/** 在选区两侧插入固定文本（链接的 `[]()` 之类） */
export function insertAround(
  view: EditorView,
  before: string,
  after: string,
  placeholder = "",
): boolean {
  const changes: ChangeSpec[] = [];
  const ranges: SelectionRange[] = [];

  for (const range of view.state.selection.ranges) {
    const selected = view.state.sliceDoc(range.from, range.to);
    const inner = selected || placeholder;
    changes.push({ from: range.from, to: range.to, insert: before + inner + after });
    if (selected) {
      ranges.push(
        EditorSelection.range(
          range.from + before.length,
          range.from + before.length + inner.length,
        ),
      );
    } else {
      ranges.push(EditorSelection.cursor(range.from + before.length + inner.length));
    }
  }

  view.dispatch({
    changes,
    selection: EditorSelection.create(ranges, view.state.selection.mainIndex),
    userEvent: "input.format",
  });
  return true;
}

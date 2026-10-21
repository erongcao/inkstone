/**
 * 自动配对（auto pair）。
 *
 * 规则来源（三处都核对过，不是凭记忆写的）：
 *   - Typora 官方文档 support.typora.com.cn/Auto-Pair/
 *   - 官方演示视频 media/auto-pairs/autopair2.webm（逐帧核对了 `*` 的实际行为）
 *   - Typora Markdown Reference（核对每个符号的真实语法长度）
 *
 * 分两级（见 settings/schema.ts 的 AutoPairMode）：
 *   - `basic`    括号与引号：`( [ { " '`，与多数代码编辑器一致
 *   - `markdown` 在 basic 之上追加 Markdown 符号
 *
 * 官方文档明确的一条差异（照做）：
 *   > for `~`, `=` and `^`, the ending pair will not be inserted automatically,
 *   > but when you select a word, and input characters like `=`,
 *   > then the word will be surrounded by `=` automatically.
 *
 * 也就是说 `~` `=` `^` **只在有选区时包裹**，裸输入不补闭合。
 *
 * `*` 的升级行为（官方视频逐帧核实）：
 *   第一次敲 `*` → `*|*`（斜体标记）
 *   紧接着再敲 `*` → `**|**`（升级成粗体标记）
 *   敲完内容再敲 `*` → 闭合，得到 `*斜体*` 或 `**粗体**`
 *
 * 也就是说 Typora 是**逐级升级**的：单字符是斜体，双字符是粗体。
 * 我们照抄这个行为，否则用户想写斜体却总得到粗体。
 *
 * 另外两条与 VS Code 一致的通用规则：
 *   - **跳过（overtype）**：光标右侧紧邻自动插入的闭合符时，直接越过它而不是再插一个
 *   - **包裹选区**：有选区时把选区包在中间，而不是把它替换掉
 */

import { EditorView } from "@codemirror/view";
import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import type { AutoPairMode } from "@/settings/schema";

/** 配对的某一档 */
interface PairLevel {
  /** 开标记 */
  open: string;
  /** 闭标记 */
  close: string;
}

interface PairRule {
  /** 触发字符（用户敲下的那个键） */
  trigger: string;
  /**
   * 配对阶梯，从短到长。
   *
   * `*` 是 [斜体, 粗体] 两档；`` ` `` `$` 只有一档；
   * `~` `=` `^` 是空数组——它们不自动补闭合，只在有选区时包裹。
   */
  ladder: PairLevel[];
  /** 光标处是否自动补闭合 */
  autoClose: boolean;
  /** 选区包裹用的标记；缺省取 ladder[0] */
  wrap?: PairLevel;
  /** 单词内部不配对（snake_case / 2*3） */
  skipInsideWord?: boolean;
}

/** 括号与引号（basic 级） */
const BASIC_RULES: PairRule[] = [
  { trigger: "(", ladder: [{ open: "(", close: ")" }], autoClose: true },
  { trigger: "[", ladder: [{ open: "[", close: "]" }], autoClose: true },
  { trigger: "{", ladder: [{ open: "{", close: "}" }], autoClose: true },
  { trigger: '"', ladder: [{ open: '"', close: '"' }], autoClose: true },
  { trigger: "'", ladder: [{ open: "'", close: "'" }], autoClose: true },
];

/**
 * Markdown 符号（markdown 级，追加在 basic 之上）。
 *
 * 各符号的语法长度来自 Typora Markdown Reference：
 *   - 斜体 `*斜体*` / 粗体 `**粗体**` → 阶梯 [1 档, 2 档]
 *   - 行内代码 `` `code` `` → 1 档
 *   - 行内公式 `$x$` → 1 档
 *   - 删除线 `~~删除~~` → 不自动闭合，选区包裹用 `~~`
 *   - 高亮 `==高亮==` → 不自动闭合，选区包裹用 `==`
 *   - 上标 `X^2^` → 不自动闭合，选区包裹用 `^`（Typora 的上标就是单个 `^`）
 */
const MARKDOWN_RULES: PairRule[] = [
  { trigger: "`", ladder: [{ open: "`", close: "`" }], autoClose: true },
  { trigger: "$", ladder: [{ open: "$", close: "$" }], autoClose: true },
  {
    trigger: "*",
    ladder: [
      { open: "*", close: "*" },
      { open: "**", close: "**" },
    ],
    autoClose: true,
    skipInsideWord: true,
  },
  {
    trigger: "_",
    ladder: [
      { open: "_", close: "_" },
      { open: "__", close: "__" },
    ],
    autoClose: true,
    skipInsideWord: true,
  },
  { trigger: "~", ladder: [], autoClose: false, wrap: { open: "~~", close: "~~" } },
  { trigger: "=", ladder: [], autoClose: false, wrap: { open: "==", close: "==" } },
  { trigger: "^", ladder: [], autoClose: false, wrap: { open: "^", close: "^" } },
];

/** 规则表：触发字符 → 规则 */
function buildRules(mode: AutoPairMode): Map<string, PairRule> {
  const rules = new Map<string, PairRule>();
  if (mode === "off") return rules;
  for (const rule of BASIC_RULES) rules.set(rule.trigger, rule);
  if (mode === "markdown") {
    for (const rule of MARKDOWN_RULES) rules.set(rule.trigger, rule);
  }
  return rules;
}

/**
 * 最近一次由自动配对插入的闭标记（连同它的开标记）。
 *
 * 必须记在 state 里而不是模块变量里：
 * 事务是并发且可回滚的，模块变量记不住「这段文字是我插的还是用户打的」，
 * 而这个区分正是「跳过」与「升级」两条规则的判断依据。
 */
interface AutoCloseContext {
  /** 触发字符 */
  char: string;
  /** 开标记文本（用于校验上下文是否还有效） */
  open: string;
  /** 闭标记文本 */
  close: string;
  /** 开标记区间 */
  openFrom: number;
  openTo: number;
  /** 闭标记区间 */
  closeFrom: number;
  closeTo: number;
  /** 当前处在阶梯的第几档 */
  level: number;
}

/** 写入自动配对上下文 */
const setAutoClose = StateEffect.define<AutoCloseContext | null>();

const autoCloseField = StateField.define<AutoCloseContext | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setAutoClose)) return effect.value;
    }
    if (!value || !tr.docChanged) return value;
    // 位置要随文档变化一起映射，否则用户打了一串字之后
    // 上下文里的区间就指错了地方。
    //
    //   开标记用 assoc = -1：插在它后面的内容不算进开标记
    //   闭标记用 assoc =  1：插在它前面的内容算在闭标记之前
    return {
      ...value,
      openFrom: tr.changes.mapPos(value.openFrom, -1),
      openTo: tr.changes.mapPos(value.openTo, -1),
      closeFrom: tr.changes.mapPos(value.closeFrom, 1),
      closeTo: tr.changes.mapPos(value.closeTo, 1),
    };
  },
});

/**
 * 读取并校验自动配对上下文。
 *
 * 上下文可能已经失效——用户删掉了配对、或者在别处编辑过。
 * 校验不过就当没有，宁可少配一次也不要配错位置。
 */
function readContext(
  state: EditorState,
  ctx: AutoCloseContext | null,
): AutoCloseContext | null {
  if (!ctx) return null;
  // 开闭标记必须还在原位且内容没变，否则上下文已失效
  if (state.sliceDoc(ctx.openFrom, ctx.openTo) !== ctx.open) return null;
  if (state.sliceDoc(ctx.closeFrom, ctx.closeTo) !== ctx.close) return null;
  return ctx;
}

/** 字母、数字、下划线算「单词字符」（含中文） */
const WORD_CHAR = /[\p{L}\p{N}]/u;

/** 光标是否夹在两个单词字符之间（snake_case / 2*3） */
function isInsideWord(state: EditorState, pos: number): boolean {
  const before = pos > 0 ? state.sliceDoc(pos - 1, pos) : "";
  const after = state.sliceDoc(pos, pos + 1);
  return WORD_CHAR.test(before) && WORD_CHAR.test(after);
}

/**
 * 光标右侧这个字符是否允许在其左侧插入配对。
 *
 * 规则：行尾、空白、右闭合符号都可以；
 * 右边是普通字母数字就不配对——那说明用户是在往已有文字里插符号，
 * 擅自补一个闭合符反而碍事。
 */
function canInsertBefore(ch: string | undefined): boolean {
  if (!ch) return true;
  return /[\s)\]}"'`$*_~=^>]/.test(ch);
}

/**
 * 创建自动配对扩展。
 *
 * @param mode 配对级别
 */
export function autoPair(mode: AutoPairMode = "off"): Extension {
  if (mode === "off") return [];

  const rules = buildRules(mode);

  return [
    autoCloseField,
    EditorView.inputHandler.of((view, from, to, text) => {
      // ── 守卫 1：只处理单个 ASCII 字符 ─────────────────────────
      // 粘贴走的是 doPaste（直接 dispatch），根本到不了这里；
      // emoji 之类是 2 个 UTF-16 码元，长度不为 1，自然被挡掉。
      if (text.length !== 1) return false;

      // ── 守卫 2：只读编辑器不配对 ───────────────────────────────
      if (view.state.readOnly) return false;

      // ── 守卫 3：IME 组字期间不配对 ─────────────────────────────
      // CM6 的 inputHandler 在 composition 期间同样会被调用，
      // 此时 dispatch 会打断用户的输入法组字。
      // 官方 closeBrackets 用的是同一个判断。
      if (view.compositionStarted) return false;

      // ── 守卫 4：输入范围必须正好等于当前选区 ───────────────────
      //
      // 这条是抄 CM6 官方 closeBrackets 的写法，作用是挡掉「IME 提交」：
      // 组字结束时浏览器把整段组字文本换成最终文本，DOM 变更的范围是
      // [组字起点, 组字终点]，而此时 CM6 state 里的选区是**光标**（空的），
      // 两者的 from/to 对不上 → 直接放行给默认插入逻辑，
      // 否则刚提交的中文会被我们当成「选区」再包一层符号。
      const sel = view.state.selection.main;
      if (from !== sel.from || to !== sel.to) return false;

      const { state } = view;
      const ctx = readContext(state, state.field(autoCloseField));

      // ── 有选区 → 包裹选区 ───────────────────────────────────────
      // 这是 `~` `=` `^` 唯一生效的方式（Typora 官方规则）
      if (from !== to) {
        const rule = rules.get(text);
        if (!rule) return false;
        const level = rule.wrap ?? rule.ladder[0];
        if (!level) return false;
        const selected = state.sliceDoc(from, to);
        const head = from + level.open.length;
        view.dispatch({
          changes: { from, to, insert: level.open + selected + level.close },
          selection: { anchor: head, head: head + selected.length },
          userEvent: "input.type",
        });
        return true;
      }

      // ── 规则 1：升级 ────────────────────────────────────────────
      // 光标紧贴着上一个自动配对、且开闭标记之间没有内容时，
      // 说明用户正在连敲同一个符号 → 升到下一档。
      //   `*|*` 再敲 `*` → `**|**`
      const rule = rules.get(text);
      if (
        rule &&
        ctx &&
        ctx.char === text &&
        ctx.closeFrom === from &&
        ctx.openTo === ctx.closeFrom
      ) {
        const next = rule.ladder[ctx.level + 1];
        if (next) {
          const openAdd = next.open.length - ctx.open.length;
          const closeAdd = next.close.length - ctx.close.length;
          view.dispatch({
            changes: [
              // 开标记补长（插在开标记与闭标记之间）
              { from: ctx.openTo, insert: next.open.slice(ctx.open.length) },
              // 闭标记补长（插在闭标记之后）
              { from: ctx.closeTo, insert: next.close.slice(ctx.close.length) },
            ],
            selection: { anchor: ctx.openTo + openAdd },
            effects: setAutoClose.of({
              char: ctx.char,
              open: next.open,
              close: next.close,
              openFrom: ctx.openFrom,
              openTo: ctx.openTo + openAdd,
              closeFrom: ctx.closeFrom + openAdd,
              closeTo: ctx.closeTo + openAdd + closeAdd,
              level: ctx.level + 1,
            }),
            userEvent: "input.type",
          });
          return true;
        }
      }

      // ── 规则 2：跳过（overtype）────────────────────────────────
      // 光标右侧紧邻**我们自己插入的**闭标记时，直接越过它。
      // 只认自己插入的：用户自己打的同名符号（比如行首的列表 `*`）
      // 不该被吞掉。
      if (ctx && ctx.closeFrom === from && ctx.close[0] === text) {
        view.dispatch({
          selection: { anchor: ctx.closeTo },
          userEvent: "input.type",
        });
        return true;
      }

      // 不是触发字符 → 交给默认插入逻辑
      if (!rule) return false;

      // ── 规则 3：不自动补闭合的符号（`~` `=` `^`）─────────────
      if (!rule.autoClose) return false;

      // ── 规则 4：单词内部不配对 ─────────────────────────────────
      // snake_case、2*3 这类写法里，配对会把词拆坏。
      //
      // 注意这里**没有**「行首不配对」的规则：`*` 在行首也是粗体/斜体
      // 的起点，而行首写粗体是最常见的场景。Typora 的列表是「`*` + 空格」
      // 触发的，那个冲突留给 M2 的列表功能去处理（它需要顺手清掉自动补上的
      // 那个尾随 `*`）。
      if (rule.skipInsideWord && isInsideWord(state, from)) return false;

      // ── 规则 6：右侧不是空白/行尾/闭合符时不配对 ───────────────
      if (!canInsertBefore(state.sliceDoc(from, from + 1))) return false;

      // ── 插入配对，光标落在中间 ─────────────────────────────────
      const level = rule.ladder[0];
      view.dispatch({
        changes: { from, to, insert: level.open + level.close },
        selection: { anchor: from + level.open.length },
        effects: setAutoClose.of({
          char: rule.trigger,
          open: level.open,
          close: level.close,
          openFrom: from,
          openTo: from + level.open.length,
          closeFrom: from + level.open.length,
          closeTo: from + level.open.length + level.close.length,
          level: 0,
        }),
        userEvent: "input.type",
      });
      return true;
    }),
  ];
}

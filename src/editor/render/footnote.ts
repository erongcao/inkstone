/**
 * GFM 脚注（`[^label]` 引用 + `[^label]: 定义`）。
 *
 * ## 为什么是「混合识别」而不是单一来源
 *
 * 脚注在语义上属于 remark-gfm（架构约束 C：语义归 mdast），但**位置**必须
 * 每击键都准，而 remark 全量解析 1000 行 p95 ≈ 11ms。所以这里沿用数学公式
 * 的老套路：位置与识别走 lezer / 行扫描，**语义由对拍测试钉死在 remark-gfm 上**
 * （见 `tests/footnote.test.ts`，那里逐条比对 mdast 的编号结果）。
 *
 * lezer 配了 GFM 也**不认识脚注**（`dump-lezer-tree.ts` 实测）：
 * `正文[^1]` 只是一个普通 `Link`（两个 `LinkMark`），
 * `[^1]: 定义` 是一个顶层 `LinkReference`（`LinkLabel` 以 `^` 开头）。
 *
 * 但纯 lezer 有一处**真分歧**，必须补行扫描：
 *
 *   正文
 *   [^1]: 定义
 *
 * GFM 允许脚注定义**打断段落**（mdast 给出 `def:1`），
 * 而 lezer 把这两行当成一个 `Paragraph`，只给出一个 `Link [3,7]`——
 * 它既没认出定义，还会把这个 `Link` 误当成一个引用。
 * 表格那次就是这么栽的（行扫描实现和 remark 对拍连续 4 处不一致），
 * 所以这里直接把定义检测放到行扫描上，让行扫描**先**划定标记位置，
 * 后面收集引用时把落在标记上的 `Link` 剔掉。
 *
 * ## 编号规则（全部对着 remark-gfm 的 HTML 输出实测过）
 *
 *   - 编号按**首次出现顺序**分配，不是按定义顺序
 *   - 没有定义的引用保持字面量（remark 直接输出 `[^missing]`）
 *   - 没有被引用的定义保持原样（remark 整条丢弃）
 *   - 标签只做**小写**归一；含空白（含首尾）的标签不成立
 *   - 定义允许 0–3 空格缩进，4 空格起就是缩进代码块（和 CommonMark 一致）
 *   - 重复定义：第一个胜出（后面的忽略）
 */

import type { Tree } from "@lezer/common";
import { collectSkipRanges, makeSkipTest, scanLines } from "./scan";

/** 一个脚注引用 `[^label]` */
export interface FootnoteRef {
  /** `[^label]` 的起点 */
  from: number;
  /** `[^label]` 的终点（不含） */
  to: number;
  /** 归一化后的标签（小写） */
  label: string;
  /** 编号，从 1 开始；**0 表示没有对应定义**，此时按字面量处理 */
  number: number;
  /** 目标定义的起点；没有定义时为 -1 */
  targetFrom: number;
}

/** 一个脚注定义 `[^label]: 内容`（含缩进续行） */
export interface FootnoteDef {
  /** 定义块的起点（`[` 所在位置） */
  from: number;
  /** 定义块的终点（不含），已排除尾部空行 */
  to: number;
  /** 标记 `[^label]:` 的起点 */
  markerFrom: number;
  /** 标记 `[^label]:` 的终点（不含） */
  markerTo: number;
  /** 归一化后的标签 */
  label: string;
  /** 编号；**0 表示没有任何引用**，此时保持源码可见 */
  number: number;
  /** 第一个引用的位置，用于「点定义跳回引用」；没有引用时为 -1 */
  firstRefFrom: number;
}

/** 一次扫描的结果 */
export interface FootnoteModel {
  refs: FootnoteRef[];
  defs: FootnoteDef[];
}

/** 空模型 */
export const EMPTY_FOOTNOTES: FootnoteModel = { refs: [], defs: [] };

/**
 * 定义行的形态：`[^label]:`
 *
 * 0–3 空格缩进——4 空格起在 CommonMark 里是缩进代码块，
 * 那条边界由 `collectSkipRanges` 里的 `CodeBlock` 兜底，
 * 但正则在第一道就把绝大多数误判挡掉了。
 */
const DEF_LINE = /^ {0,3}\[\^([^\]\s]+)\]:/;

/** 行内扫描只需要关心这三种字符（见 `scanRefsInText`） */
const SCAN_CANDIDATE = /[`[\n]/g;

/**
 * 从 `[^` 处解析出标签。
 *
 * @param text  文本
 * @param at    `[` 的下标
 * @returns 标签与 `]` 之后的位置；不成立时返回 null
 */
function matchLabel(text: string, at: number): { label: string; end: number } | null {
  let i = at + 2; // 跳过 `[^`
  for (; i < text.length; i++) {
    const ch = text[i];
    if (ch === "]") {
      // 标签必须非空：remark 实测 `[^]` 是字面量，不是脚注
      if (i === at + 2) return null;
      return { label: text.slice(at + 2, i).toLowerCase(), end: i + 1 };
    }
    // 含空白的标签不成立（`[^  foo  ]` / `[^a  b]` 都被 remark 判为字面量）
    if (/\s/.test(ch)) return null;
  }
  return null; // 没闭合
}

/**
 * 在一段纯文本里找出脚注引用，跳过转义与行内代码跨度。
 *
 * ## 为什么是全文档扫描而不是语法树
 *
 * 踩过的坑：`正文[^1]和[^note]。` 在**没有**脚注定义时，lezer 给出两个
 * 独立的 `Link [2,6]` / `Link [7,14]`；但文档里一旦出现 `[^1]: …` 定义，
 * lezer 就会把 `[^1]和[^note]` **合并成一个 `Link [2,14]`**（它在校验链接
 * 引用），节点形态随文档其它部分变化。拿节点形态当识别依据就不可靠了。
 *
 * 行内代码跨度可以**跨行**（CommonMark 允许 `` `foo\nbar` ``），
 * 所以未闭合的反引号串状态要跨行保留；遇到空行（段落边界）才重置。
 */
function scanRefsInText(
  text: string,
  base: number,
  out: FootnoteRef[],
  isSkip?: (pos: number) => boolean,
): void {
  /** 未闭合代码跨度的反引号串长度；0 表示当前不在代码跨度里 */
  let openRun = 0;
  /** 当前行是否已经出现过非换行字符（用来识别空行） */
  let lineHasContent = false;

  // 只关心三种字符：候选引用起点 `[`、代码跨度 `` ` ``、段落边界 `\n`。
  // 用正则驱动而不是逐字符循环——这条路径在**每击键**都跑，
  // 实测 1022 行 / 54 KB 文档：逐字符 0.40ms，正则驱动 0.11ms。
  SCAN_CANDIDATE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SCAN_CANDIDATE.exec(text)) !== null) {
    const at = match.index;
    const ch = match[0];

    if (ch === "\n") {
      // 空行 = 段落边界，未闭合的代码跨度不可能跨过去
      if (!lineHasContent) openRun = 0;
      lineHasContent = false;
      continue;
    }
    lineHasContent = true;

    // 禁区（围栏代码块 / 缩进代码块 / HTML 块）整段跳过
    if (isSkip?.(base + at)) {
      const nl = text.indexOf("\n", at);
      if (nl === -1) break;
      SCAN_CANDIDATE.lastIndex = nl;
      continue;
    }

    if (ch === "`") {
      let run = 0;
      while (text[at + run] === "`") run++;
      if (openRun === 0) {
        openRun = run; // 开始一个代码跨度
      } else if (run === openRun) {
        openRun = 0; // 闭合
      }
      // 长度不匹配的串就是普通字符（CommonMark 同此）
      SCAN_CANDIDATE.lastIndex = at + run;
      continue;
    }

    // 代码跨度内部：除了配对的反引号，其余全是字面量
    //（反斜杠在跨度里**不**转义，所以这个判断要排在转义分支前面）
    if (openRun !== 0) continue;

    // 转义：`\[` 不算引用起点
    if (at > 0 && text[at - 1] === "\\") continue;

    if (text[at + 1] !== "^") continue;
    const hit = matchLabel(text, at);
    if (!hit) continue;
    out.push({
      from: base + at,
      to: base + hit.end,
      label: hit.label,
      number: 0,
      targetFrom: -1,
    });
    SCAN_CANDIDATE.lastIndex = hit.end;
  }
}

/**
 * 收集脚注定义（行扫描）。
 *
 * 返回的 `from` 用 `[` 的位置而不是行首：缩进要留在文档里，
 * 只把 `[^label]:` 这段标记换掉。
 */
function collectDefs(source: string, isSkip: (pos: number) => boolean): FootnoteDef[] {
  const lines = scanLines(source);
  const defs: FootnoteDef[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 围栏代码块 / 缩进代码块里的 `[^x]: …` 是代码，不是定义
    if (isSkip(line.from)) continue;
    const matched = DEF_LINE.exec(line.text);
    if (!matched) continue;

    const markerFrom = line.from + line.text.indexOf("[");
    const markerTo = line.from + matched[0].length;

    // 定义块的范围：标记行 + 其后的续行（≥4 空格缩进）。
    // 空行不计入终点——`[^1]: 甲\n\n正文` 的定义只到标记行为止，
    // 而 `[^1]: 甲\n\n    第二段` 的空行后面还有缩进行，属于定义内部。
    let end = line.to;
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j];
      if (next.text.trim().length === 0) {
        j++;
        continue;
      }
      const indent = next.text.length - next.text.trimStart().length;
      if (indent < 4) break;
      end = next.to;
      j++;
    }

    defs.push({
      from: markerFrom,
      to: end,
      markerFrom,
      markerTo,
      label: matched[1].toLowerCase(),
      number: 0,
      firstRefFrom: -1,
    });
    i = j - 1; // 续行已经被吃掉，避免重复匹配
  }

  return defs;
}

/**
 * 收集脚注引用（全文档行内扫描）。
 *
 * 不走语法树的原因见 `scanRefsInText` 的注释：lezer 的节点形态会随文档
 * 其它部分（有没有脚注定义）变化，不能当识别依据。
 * lezer 只用来划**禁区**——围栏代码块 / 缩进代码块 / HTML 块里的
 * `[^1]` 是代码，不是脚注。
 */
function collectRefs(
  source: string,
  isSkipBase: (pos: number) => boolean,
  defs: readonly FootnoteDef[],
): FootnoteRef[] {
  // 定义标记的 `[` 位置：那里扫出来的 `[^label]` 是定义的标签，不是引用
  const markerAt = new Set<number>();
  for (const def of defs) markerAt.add(def.markerFrom);

  // 定义体内部**豁免**禁区：lezer 会把 `[^1]: 甲\n    见[^2]` 的续行当成
  // 缩进代码块（`CodeBlock`），但 remark 剥掉缩进后它是定义正文，
  // 里面的 `[^2]` 是货真价实的脚注引用。实测 remark 给出 `ref:2`。
  const bodies = defs.map((def) => ({ from: def.markerTo, to: def.to }));
  let bodyIndex = 0;
  // 两个游标都只前进不回退，与扫描方向一致，整体仍是 O(文档长度)
  const inBody = (pos: number): boolean => {
    while (bodyIndex < bodies.length && bodies[bodyIndex].to <= pos) bodyIndex++;
    return (
      bodyIndex < bodies.length &&
      pos >= bodies[bodyIndex].from &&
      pos < bodies[bodyIndex].to
    );
  };

  const refs: FootnoteRef[] = [];
  scanRefsInText(source, 0, refs, (pos) => isSkipBase(pos) && !inBody(pos));

  const result = refs.filter((ref) => !markerAt.has(ref.from));
  result.sort((a, b) => a.from - b.from);
  return result;
}

/**
 * 扫描文档里的全部脚注，并算好编号与互相跳转的目标位置。
 *
 * 复杂度是 O(行数 + 节点数)，实测 1022 行 / 54 KB 文档 **0.27ms**。
 * 这条路径在每击键都跑，所以禁区（collectSkipRanges 的语法树遍历）
 * 只算一次，两个扫描共用。
 */
export function findFootnotes(tree: Tree, source: string): FootnoteModel {
  // 禁区只算一次：collectSkipRanges 要整棵语法树走一遍（1000 行约 0.16ms），
  // 定义扫描与引用扫描都要用它，算两遍就是白扔三成时间。
  const isSkip = makeSkipTest(collectSkipRanges(tree));
  const defs = collectDefs(source, isSkip);
  const refs = collectRefs(source, isSkip, defs);

  // 重复定义：第一个胜出（remark-gfm 实测 `[^1]` 的第二个定义被忽略）
  const defByLabel = new Map<string, FootnoteDef>();
  for (const def of defs) {
    if (!defByLabel.has(def.label)) defByLabel.set(def.label, def);
  }

  // 编号按**首次引用**顺序，不是按定义顺序
  const numberByLabel = new Map<string, number>();
  let next = 1;
  for (const ref of refs) {
    const def = defByLabel.get(ref.label);
    if (!def) continue; // 没有定义 → 保持字面量（number 停在 0）
    let number = numberByLabel.get(ref.label);
    if (number === undefined) {
      number = next++;
      numberByLabel.set(ref.label, number);
      def.number = number;
    }
    ref.number = number;
    ref.targetFrom = def.from;
    if (def.firstRefFrom === -1) def.firstRefFrom = ref.from;
  }

  return { refs, defs };
}

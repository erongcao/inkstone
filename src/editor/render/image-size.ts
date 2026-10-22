/**
 * 图片尺寸：GFM 没有这个语法，但 Typora 与 Obsidian 都用同一套写法。
 *
 * ```
 * ![说明](图片.png =200x100)   ← 有空格
 * ![说明](图片.png=200x100)    ← 无空格
 * ```
 *
 * ## 为什么图片尺寸能做，而表格列宽不做
 *
 * 两者的关键区别是**尺寸写不写进 Markdown**：
 *   - 图片尺寸：Typora / Obsidian 都写进 `.md` → 抄它不引入第二个真相源
 *   - 表格列宽：Typora 存在自己的配置里、不写进 → 抄它就破坏红线 1
 *
 * 所以尺寸是 Markdown 的事实标准扩展，值得支持。
 *
 * ## lezer 认不认？认一半（实测）
 *
 * | 写法 | lezer 的 `Image` 节点 | 走哪条路 |
 * | --- | --- | --- |
 * | `图片.png=200x100`（无空格） | ✅ 完整，`URL` 里带着尺寸 | 剥 `URL` 尾巴 |
 * | `图片.png =200x100`（有空格） | ❌ 只到 `![说明]`，括号外全成纯文本 | 行扫描兜底 |
 *
 * 有空格那个之所以不行，是因为 **URL 不能含空格**——`=200x100` 与路径之间
 * 那个空格让 lezer 认不出这是图片。
 *
 * ## 有空格的写法为什么还要支持（行扫描的取舍）
 *
 * 因为它是**事实标准**：用户从 Obsidian / Typora 带过来的文档都长这样。
 * 不支持的话那些文档里的图片会**整块显示成源码文字**，比尺寸不生效更糟。
 *
 * 代价是引入了行扫描——这与「能用语法树表达的，就不要用行扫描再实现一遍」
 * 相悖。所以这里的扫描被刻意压到最窄：
 *   - 只在 lezer **没有**产出 Image 节点的段落文本上跑
 *   - 只匹配一个固定形状的正则，命中不了就当没有
 *   - 路径不含空格（含空格的路径要写 `<图片 图.png> =200x100`，
 *     本轮不支持，已在 AGENTS.md 记录）
 *
 * 两条路不会重复处理同一张图：有空格的写法 lezer 压根不产出节点。
 */

/** 一张带尺寸的图片 */
export interface SizedImage {
  /** 图片语法在该段文本里的起点 */
  from: number;
  /** 终点（不含） */
  to: number;
  /** 去掉尺寸后的路径 */
  src: string;
  /** 宽度（px）；只给高度时为 undefined */
  width?: number;
  /** 高度（px） */
  height?: number;
}

/**
 * 从路径尾部剥出尺寸。
 *
 * 认 `=数字` 与 `=数字x数字` 两种结尾。
 *
 * ## 两种会误伤的情况，以及各自的判据
 *
 * **1. 带查询参数的地址。** `https://cdn/a.png?w=200` 光看「结尾是 `=数字`」
 * 会被剥成 `https://cdn/a.png?w` + 宽度 200，**图片地址直接坏掉**。
 * 判据：`=` 前面有 `?` / `&` 就不是尺寸后缀。
 *
 * **2. base64 的 padding。** `data:image/png;base64,AAA=200x100` 里的 `AAA=`
 * 是 base64 自己的补位符，不是尺寸分隔符；反过来，
 * `data:...,Pg==200x100` 的 `Pg==` 也会被当成「路径 + 尺寸」。
 * 判据：尺寸被剥掉之后，剩下的**路径必须以扩展名结尾**
 * （`a.png` ✓；`data:image/png;base64,AAA` ✗）。
 *
 * 两条都是「宁可漏剥也不误剥」——漏剥的后果是尺寸不生效，
 * 误剥的后果是图片裂开。
 *
 * @returns 剥不出尺寸时原样返回
 */
export function stripImageSize(src: string): {
  src: string;
  width?: number;
  height?: number;
} {
  const match = /^(.*?)=(\d+)(?:x(\d+))?$/.exec(src);
  if (!match) return { src };

  const [, path, width, height] = match;
  if (!path) return { src };
  // `=` 前面有 `?` / `&` → 这是查询参数，不是尺寸后缀
  if (path.includes("?") || path.includes("&")) return { src };

  const trimmed = path.trimEnd();
  // 剥掉尺寸后必须还像个文件路径（以扩展名结尾），否则不剥
  if (!/\.[A-Za-z0-9]{1,8}$/.test(trimmed)) return { src };

  return {
    src: trimmed,
    width: Number(width),
    // 只写了 `=200` 时不猜高度——那会把图拉伸变形
    height: height === undefined ? undefined : Number(height),
  };
}

/**
 * 找出一段文本里「lezer 认不出」的那类带尺寸图片。
 *
 * 形状固定：`![alt](路径 =宽x高)`，`=200`（只给宽）与 `=200x100` 都认。
 * alt 允许为空（`![](...)`），路径不允许含空格（见文件头的取舍说明）。
 */
const SIZED_IMAGE = /!\[([^\]]*)\]\((\S+)\s+=(\d+)(?:x(\d+))?\)/g;

/** 在 `source[from, to)` 这段文本里找出带尺寸的图片 */
export function findSizedImages(source: string, from: number, to: number): SizedImage[] {
  const text = source.slice(from, to);
  const found: SizedImage[] = [];

  SIZED_IMAGE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SIZED_IMAGE.exec(text)) !== null) {
    const [, alt, path, width, height] = match;
    found.push({
      from: from + match.index,
      to: from + match.index + match[0].length,
      src: path,
      width: Number(width),
      height: height === undefined ? undefined : Number(height),
    });
    void alt; // alt 只用于定位，不进结果（渲染时的替代文字从别处拿）
  }
  return found;
}

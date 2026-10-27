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
 *
 * ## 为什么这个模块在**解析层**
 *
 * 因为 `=WxH` 是一条**语法规则**，而规则只能有一份——
 * 编辑器（lezer 装饰器）与导出（mdast 变换）都要用它，
 * 两边各写一份必然漂移。
 *
 * 放在解析层还顺带解决了一个分层问题：
 * 导出链路（`src/parser/html.ts`）不该反过来依赖 `src/editor/`。
 *
 * ## 导出侧（mdast 变换）
 *
 * 导出链路原本**完全没处理**这个语法，于是两种写法都出事：
 *
 * | 写法 | 导出结果（修复前） | 后果 |
 * |---|---|---|
 * | 无空格 | `<img src="图片.png=200x100">` | **图片地址坏了**（去找一个真叫这个名的文件） |
 * | 有空格 | `![说明](图片.png =200x100)` 一串字面文本 | **图片整个没了** |
 *
 * 而编辑器两种都渲染成图——那就是「屏幕与导出不一致」（架构约束 C）。
 *
 * 修法见下面的 `applyImageSizes`：它在 **mdast → HTML** 这条链路上就地变换，
 * 与 `applyAlerts` 同一个位置。
 * **不能放进解析层**——放进解析层的话，
 * 往返（mdast → Markdown → mdast）就丢了尺寸，
 * 而 Inkstone 对往返的要求是「再次解析后结构等价」。
 */

import type { Image, Parent, PhrasingContent, Root } from "mdast";

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

/* ────────────────────────── 导出侧：mdast 变换 ────────────────────────── */

/**
 * 给 mdast 套上「图片尺寸」变换。
 *
 * **就地修改**传入的树——调用方要保证这棵树是一次性的
 * （`htmlFromAst` 传的就是刚解析出来的那棵）。
 *
 * 处理两种写法：
 *
 * | 写法 | mdast 里是什么 | 这里怎么处理 |
 * |---|---|---|
 * | `![说明](图.png=200x100)`（无空格） | `image` 节点，url 带着尺寸 | 剥掉 url 尾巴，尺寸进 `width` / `height` |
 * | `![说明](图.png =200x100)`（有空格） | **纯文本节点** | 换成 `image` 节点 |
 *
 * 尺寸怎么落到 HTML 上：mdast 的 `image` 节点**没有**宽高字段，
 * 但 `data.hProperties` 会被 `mdast-util-to-hast` 的 `applyData`
 * 合进元素的属性里——这是 mdast 官方给的扩展口，
 * 所以不需要自己写 hast handler，也不需要新依赖。
 */
export function applyImageSizes(tree: Root): Root {
  transformChildren(tree);
  return tree;
}

/**
 * 递归处理 mdast 的子节点。
 *
 * 手写遍历而不是引 `unist-util-visit`：
 * mdast 的结构是固定的（`children` 数组），
 * 为这点事加一个依赖不值当。
 *
 * ## 关于那个类型转换
 *
 * mdast 的 `Parent` 接口把 `children` 声明成 `RootContent[]`，
 * 但**段落里实际放的是行内内容**（`PhrasingContent`）——
 * mdast 在这一层的类型是不精确的。
 *
 * 这里显式转换一次并写明原因，而不是把整个遍历写成 `any`：
 * 转换只发生在「读 children」与「往 children 里塞」两处，
 * 遍历逻辑本身仍然是类型检查的。
 */
function transformChildren(parent: Parent): void {
  const children = parent.children as unknown as PhrasingContent[];
  if (!Array.isArray(children)) return;

  for (let i = 0; i < children.length; i++) {
    const child = children[i];

    if (child.type === "image") {
      applySizeToImage(child);
      continue;
    }

    if (child.type === "text") {
      const replacement = splitSizedImages(child.value);
      if (replacement) {
        // 用新节点替掉整个文本节点
        children.splice(i, 1, ...replacement);
        i += replacement.length - 1;
        continue;
      }
    }

    transformChildren(child as unknown as Parent);
  }
}

/** 把 `image` 节点 url 尾部的尺寸剥掉，尺寸改成宽高属性 */
function applySizeToImage(node: Image): void {
  const { src, width, height } = stripImageSize(node.url);
  if (src === node.url && width === undefined) return;

  node.url = src;
  node.data = {
    ...node.data,
    hProperties: { ...node.data?.hProperties, ...sizeProperties(width, height) },
  };
}

/** 宽高 → HTML 属性 */
function sizeProperties(
  width: number | undefined,
  height: number | undefined,
): Record<string, string> {
  const props: Record<string, string> = {};
  if (width !== undefined) props.width = String(width);
  if (height !== undefined) props.height = String(height);
  return props;
}

/**
 * 把一段文本里的「带尺寸图片」语法拆成节点。
 *
 * 文本节点里出现的是**整个** `![alt](路径 =宽x高)`（mdast 认不出它是图片，
 * 所以它只是普通文本）。这里把它切出来，前后剩下的仍是文本节点。
 *
 * @returns 没有匹配时返回 null（调用方保持原样）
 */
function splitSizedImages(value: string): PhrasingContent[] | null {
  const out: PhrasingContent[] = [];
  let last = 0;
  let found = false;

  SIZED_IMAGE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SIZED_IMAGE.exec(value)) !== null) {
    found = true;
    if (match.index > last) {
      out.push({ type: "text", value: value.slice(last, match.index) });
    }
    const [, alt, path, width, height] = match;
    const image: Image = {
      type: "image",
      url: path,
      alt,
      title: null,
      data: {
        hProperties: sizeProperties(
          Number(width),
          height === undefined ? undefined : Number(height),
        ),
      },
    };
    out.push(image);
    last = match.index + match[0].length;
  }

  if (!found) return null;
  if (last < value.length) {
    out.push({ type: "text", value: value.slice(last) });
  }
  return out;
}

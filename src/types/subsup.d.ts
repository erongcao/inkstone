/**
 * mdast 节点类型扩展：`subscript` / `superscript`。
 *
 * 写法跟 `mdast-util-highlight-mark` 一致——在模块augmentation 里
 * 直接引用 `mdast` 自己的 `Parent` / `PhrasingContent`
 * （augmentation 会合并进原模块的作用域，所以不需要 import）。
 *
 * 为什么要自己写：`mdast` 的官方类型里没有这两个节点，
 * 而本项目的下标/上标节点是**自己**的 micromark 扩展产出的
 * （见 `src/parser/subsup.ts`），官方包里没有对应的声明。
 */

// 这一行 import 不是装饰——它决定了这个文件是「模块增强」还是「环境模块声明」。
//
// 没有顶层 import/export 时，`declare module "mdast"` 会被当成
// **ambient module declaration**：整个 mdast 模块被这份声明**替换**，
// 于是 `Node` / `Parent` / `Root` 全部消失（`has no exported member 'Node'`）。
//
// 有顶层 import 之后，它才是「模块增强」，只是在原模块上加两个接口。
// `mdast-util-highlight-mark` 的 .d.ts 也是这么写的。
import type { PhrasingContent } from "mdast";

declare module "mdast" {
  /** 下标：`~文字~` */
  interface Subscript extends Parent {
    type: "subscript";
    children: PhrasingContent[];
  }

  /** 上标：`^文字^` */
  interface Superscript extends Parent {
    type: "superscript";
    children: PhrasingContent[];
  }

  interface StaticPhrasingContentMap {
    subscript: Subscript;
    superscript: Superscript;
  }

  interface PhrasingContentMap {
    subscript: Subscript;
    superscript: Superscript;
  }

  interface RootContentMap {
    subscript: Subscript;
    superscript: Superscript;
  }
}

declare module "mdast-util-to-markdown" {
  interface ConstructNameMap {
    subscript: "subscript";
    superscript: "superscript";
  }
}

/**
 * micromark 的 token 类型。
 *
 * `micromark-util-types` 的 `TokenTypeMap` 是**开放的**——
 * 官方包的 `.d.ts` 就是这么加自定义 token 的
 * （见 `micromark-extension-highlight-mark` 的 `.d.ts`）。
 * 不加的话 `effects.enter("subscript")` 会被类型系统拦下。
 */
declare module "micromark-util-types" {
  interface TokenTypeMap {
    subscript: "subscript";
    subscriptMark: "subscriptMark";
    superscript: "superscript";
    superscriptMark: "superscriptMark";
  }
}

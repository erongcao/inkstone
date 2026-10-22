/**
 * 代码块渲染：定位围栏代码块 + highlight.js 语法高亮。
 *
 * 定位用 lezer 的 `FencedCode` 节点——它能正确处理
 * 围栏长度（```` 四反引号）、缩进、以及块内的反引号。
 * 这比行扫描准，所以优先用它。
 *
 * 高亮用 highlight.js（BSD-3-Clause）的 `lib/core` 入口：
 *   同步、常量级开销、无 wasm。
 *
 * 为什么从 Prism 换成 highlight.js（实测踩过的发布级 bug）：
 *   Prism 的语言组件是**副作用式**的——`prism-javascript.js` 执行时
 *   往**全局** `Prism` 上挂 `Prism.languages.javascript`。
 *   在 rollup 生产构建里模块执行顺序会变，结果语言注册和读取
 *   落在不同实例上，`Prism.highlight` 静默降级成纯文本
 *   （实测：dev 正常、preview 产物无 token）。
 *   highlight.js 的 `lib/core` 是一个干净的单例，
 *   `registerLanguage` 是**显式**调用，语言模块本身是纯函数，
 *   不碰任何全局对象 —— 生产构建下行为与 dev 一致。
 */

import type { Tree } from "@lezer/common";
import type { LanguageFn } from "highlight.js";
import hljs from "highlight.js/lib/core";

import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import graphql from "highlight.js/lib/languages/graphql";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import less from "highlight.js/lib/languages/less";
import lua from "highlight.js/lib/languages/lua";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import plaintext from "highlight.js/lib/languages/plaintext";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scala from "highlight.js/lib/languages/scala";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

import type { Interval } from "./scan";
import type { BlockMatch, BlockRenderer, BlockRenderResult } from "./types";

/**
 * 要注册的语言。
 *
 * 刻意**不**用 `highlight.js` 全量入口（190+ 语言，包体大）。
 * 这里列的都是实际会用到的；将来要加语言，只改这一张表。
 */
const LANGUAGE_MODULES: Array<[string, LanguageFn]> = [
  ["bash", bash],
  ["c", c],
  ["cpp", cpp],
  ["csharp", csharp],
  ["css", css],
  ["diff", diff],
  ["dockerfile", dockerfile],
  ["go", go],
  ["graphql", graphql],
  ["ini", ini],
  ["java", java],
  ["javascript", javascript],
  ["json", json],
  ["kotlin", kotlin],
  ["less", less],
  ["lua", lua],
  ["markdown", markdown],
  ["php", php],
  ["plaintext", plaintext],
  ["powershell", powershell],
  ["python", python],
  ["ruby", ruby],
  ["rust", rust],
  ["scala", scala],
  ["scss", scss],
  ["sql", sql],
  ["swift", swift],
  ["typescript", typescript],
  ["xml", xml],
  ["yaml", yaml],
];

/**
 * 幂等注册。
 *
 * `registerLanguage` 会顺带把语言定义里的 `aliases` 也注册进去
 * （highlight.js 内部就是这么做的），所以 `js` / `ts` / `py` 这类
 * 短名会自动被认出来——下面那张别名表只需要补 highlight.js
 * 自己没覆盖的写法。
 */
let registered = false;

function ensureHighlighter(): void {
  if (registered) return;
  registered = true;
  for (const [name, definition] of LANGUAGE_MODULES) {
    try {
      hljs.registerLanguage(name, definition);
    } catch {
      // 单个语言定义失败不应该拖垮整个高亮器。
      // highlight.js 在 safeMode 下会用 plaintext 顶替，
      // 我们这里直接跳过这个语言即可。
    }
  }
}

/**
 * 别名 → highlight.js 语言名。
 *
 * 只列 highlight.js 自带 aliases **没有**覆盖的常见写法，
 * 以及我们希望归一化到更合适语言的写法。
 */
const LANGUAGE_ALIASES: Record<string, string> = {
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  yml: "yaml",
  html: "xml",
  xhtml: "xml",
  svg: "xml",
  md: "markdown",
  py: "python",
  rb: "ruby",
  rs: "rust",
  kt: "kotlin",
  cs: "csharp",
  "c++": "cpp",
  "h++": "cpp",
  hpp: "cpp",
  golang: "go",
  ps1: "powershell",
  pwsh: "powershell",
  toml: "ini",
  text: "plaintext",
  txt: "plaintext",
};

/**
 * 别名 → **规范语言名** 的反向表。
 *
 * 为什么不能直接用 `hljs.getLanguage(name)`：
 * 它对别名也会返回语法对象（`getLanguage("js")` 返回 JavaScript 的语法），
 * 于是我们会以为规范名是 "js"。而规范名要用在
 * `language-xxx` class 上，必须是注册时的那个名字。
 *
 * highlight.js 不提供「别名 → 规范名」的公开 API，
 * 所以注册完之后自己扫一遍 `listLanguages()` 和各自的 `aliases` 建表。
 */
let aliasMap: Map<string, string> | null = null;

function getAliasMap(): Map<string, string> {
  if (aliasMap) return aliasMap;
  const map = new Map<string, string>();
  for (const canonical of hljs.listLanguages()) {
    map.set(canonical, canonical);
    const grammar = hljs.getLanguage(canonical);
    for (const alias of grammar?.aliases ?? []) {
      map.set(alias.toLowerCase(), canonical);
    }
  }
  aliasMap = map;
  return map;
}

/** 把语言标识归一化成 highlight.js 能认的**规范名**；认不出返回 null */
export function resolveLanguage(info: string): string | null {
  const raw = info.trim().toLowerCase();
  if (!raw) return null;
  ensureHighlighter();
  const mapped = LANGUAGE_ALIASES[raw] ?? raw;
  return getAliasMap().get(mapped) ?? null;
}

/**
 * 找出文档里所有围栏代码块。
 *
 * 注意取节点内容要用 **source 切片**，不能用 `node.toString()`——
 * lezer 的 `SyntaxNode.toString()` 实际是 `Tree.toString()`，
 * 返回的是「节点类型名列表」（如 `"CodeInfo"`）而不是文本。
 * 这是实测踩过的坑。
 *
 * ⚠️ `claimed` 是先注册的渲染器已经认走的区间。**必须让开**：
 * mermaid 与本渲染器会匹配同一个 `FencedCode` 节点（一个当图表、一个当代码高亮），
 * 不让开就会对同一段文本生成两个块级装饰，DOM 里出现两份。
 */
export function findCodeBlocks(
  tree: Tree,
  source: string,
  claimed: readonly Interval[] = [],
): BlockMatch[] {
  const matches: BlockMatch[] = [];
  tree.iterate({
    enter(ref) {
      if (ref.type.name !== "FencedCode") return;
      if (claimed.some((r) => r.from < ref.to && ref.from < r.to)) return;
      // 逐个子节点找 CodeInfo（语言）与 CodeText（内容）
      let language: string | undefined;
      let content = "";
      const cursor = ref.node.cursor();
      if (cursor.firstChild()) {
        do {
          const child = cursor.node;
          if (child.type.name === "CodeInfo") {
            language =
              child.to > child.from ? source.slice(child.from, child.to) : undefined;
          } else if (child.type.name === "CodeText") {
            content = source.slice(child.from, child.to);
          }
        } while (cursor.nextSibling());
      }
      matches.push({
        from: ref.from,
        to: ref.to,
        kind: "code",
        language,
        content,
      });
    },
  });
  return matches;
}

/** 高亮一段代码；认不出的语言按纯文本处理 */
export function highlightCode(code: string, language: string | null): string {
  if (!language) {
    return escapeHtml(code);
  }
  ensureHighlighter();
  if (!hljs.getLanguage(language)) return escapeHtml(code);
  try {
    // `ignoreIllegals` 打开：某些语言的「非法」序列（比如 Python 的
    // 裸字符串）不该让整段高亮在中途断掉。
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(code);
  }
}

/** HTML 转义（纯文本路径要用） */
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 代码块渲染器 */
export const codeBlockRenderer: BlockRenderer = {
  id: "code-block",

  find(tree, source, claimed) {
    return findCodeBlocks(tree, source, claimed);
  },

  render(match) {
    const canonical = match.language ? resolveLanguage(match.language) : null;
    const html = highlightCode(match.content, canonical);

    const pre = document.createElement("pre");
    pre.className = "cm-md-code";
    if (match.language) {
      // 显示用户写的原始标识（`ts` 就显示 `ts`），而不是归一化后的名字
      pre.dataset.language = match.language.trim().toLowerCase();
    }

    const code = document.createElement("code");
    code.className = canonical ? `hljs language-${canonical}` : "hljs language-plaintext";
    code.innerHTML = html;
    pre.appendChild(code);

    return {
      dom: pre,
      // 指纹必须覆盖所有影响渲染结果的输入
      key: `code:${canonical ?? ""}:${match.content}`,
    } satisfies BlockRenderResult;
  },
};

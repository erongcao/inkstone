/**
 * 关掉 mhchem 时，把 `\ce{…}` 降级成**字面文本**。
 *
 * ## 为什么需要它
 *
 * KaTeX **内置** mhchem：`\ce{H2O}` 直接就能渲染成化学式，
 * 不需要额外插件。所以「关掉 mhchem」不是「装没装插件」的问题，
 * 而是「要不要让它生效」的问题——
 * 而设置面板里那个开关的语义正是后者。
 *
 * ## 降级成什么样
 *
 * `\ce{H2O}` → 屏幕上显示字面的 `\ce{H2O}`（而不是化学式，也不是空白）。
 *
 * ## 用 KaTeX 的 `\verb`
 *
 * `\verb|…|` 让内容**完全按字面**渲染——反斜杠、花括号、下标符号
 * 都不会被解释。这比自己拼 `\backslash ce\{…\}` 可靠得多：
 * 后者要逐个转义 `_` `^` `&` `%` `$` `#`，
 * 而且 `\^` 在 KaTeX 里是**重音命令**（要吃参数），拿来转义尖括号会直接报错
 * （实测：`KaTeX parse error: Undefined control sequence`）。
 *
 * `\verb` 的分隔符不能出现在内容里（实测 `\verb|a|b|` 会被拆错），
 * 所以从候选里挑一个内容中不存在的。
 *
 * ## 为什么在 **TeX 预处理**这一层做
 *
 * 不是在渲染器里读全局设置——装饰器管线是**纯函数**
 * （见 `decorations.ts` 的说明：不吃 EditorState，只吃显式参数）。
 * 所以「mhchem 开不开」必须**显式传下去**，
 * 由调用方（装饰器 / 导出管线）决定。
 */

/** mhchem 的命令名 */
const MHCHEM_COMMANDS = new Set(["ce", "pu"]);

/** `\verb` 的候选分隔符（按顺序挑第一个内容里没有的） */
const VERB_DELIMITERS = ["|", "!", "#", "%", "~", ";", ":", ",", "=", "/"];

/**
 * 找到与 `open`（一个 `{`）配对的 `}`。
 *
 * 花括号可以嵌套，而且 `\{` 是转义的花括号（不算配对）。
 * 找不到配对时返回 -1（调用方按「不是 mhchem」处理）。
 */
function matchBrace(tex: string, open: number): number {
  let depth = 0;
  for (let i = open; i < tex.length; i++) {
    const ch = tex[i];
    if (ch === "\\") {
      i++; // 跳过被转义的那个字符
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 挑一个内容里不存在的分隔符 */
function pickDelimiter(content: string): string {
  for (const d of VERB_DELIMITERS) {
    if (!content.includes(d)) return d;
  }
  // 内容里什么候选都有——那就用最后一个（极少见，宁可渲染得不完美也不报错）
  return VERB_DELIMITERS[VERB_DELIMITERS.length - 1];
}

/**
 * 把 TeX 里的 mhchem 命令降级成字面文本。
 *
 * 只处理 `\ce{…}` 与 `\pu{…}`；其余原样保留。
 * 命令名大小写敏感（mhchem 只有小写形式）。
 */
export function stripMhchem(tex: string): string {
  if (!tex.includes("\\ce") && !tex.includes("\\pu")) return tex;

  let out = "";
  let i = 0;
  while (i < tex.length) {
    const ch = tex[i];
    if (ch !== "\\") {
      out += ch;
      i++;
      continue;
    }

    const match = /^\\([a-zA-Z]+)/.exec(tex.slice(i));
    if (!match) {
      out += ch;
      i++;
      continue;
    }

    const name = match[1];
    if (!MHCHEM_COMMANDS.has(name)) {
      out += match[0];
      i += match[0].length;
      continue;
    }

    // 命令名之后（允许空白）必须紧跟 `{`
    let j = i + match[0].length;
    while (j < tex.length && /\s/.test(tex[j])) j++;
    if (tex[j] !== "{") {
      out += match[0];
      i += match[0].length;
      continue;
    }

    const end = matchBrace(tex, j);
    if (end === -1) {
      out += match[0];
      i += match[0].length;
      continue;
    }

    // 整段（含命令名与花括号）都变成字面文本
    const literal = tex.slice(i, end + 1);
    const delimiter = pickDelimiter(literal);
    out += `\\verb${delimiter}${literal}${delimiter}`;
    i = end + 1;
  }

  return out;
}

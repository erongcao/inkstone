/**
 * 字数统计。
 *
 * 中文写作工具的「词数」不能照搬英文的 `split(/\s+/)`：
 * 中文没有词间空格，逐字计数才是通行做法（Word / Typora 都这样）。
 * 所以这里是 **CJK 逐字 + 拉丁按词** 的混合口径。
 */

/** CJK 及相关文字系统的码点范围（中日韩 + 假名 + 谚文） */
const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/g;

/** 拉丁「词」：字母、数字、下划线，以及词内的连字符与撇号 */
const LATIN_WORD = /[A-Za-z0-9_]+(?:['-][A-Za-z0-9_]+)*/g;

/**
 * 统计字数。
 *
 * @param text **纯文本**，不是 Markdown 源码——标记符号不该被算进去。
 *             调用方负责剥标记（见 `document-index.ts`）。
 */
export function countWords(text: string): { chars: number; words: number } {
  const chars = text.length;
  const cjk = text.match(CJK)?.length ?? 0;
  // 先把 CJK 换成空格，否则「中文English」会被当成一个拉丁词
  const latinText = text.replace(CJK, " ");
  const latin = latinText.match(LATIN_WORD)?.length ?? 0;
  return { chars, words: cjk + latin };
}

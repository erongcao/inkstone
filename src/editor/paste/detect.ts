/**
 * 判断剪贴板里的纯文本是不是「已经是 Markdown 了」。
 *
 * 粘贴时要区分两种来源，处理方式完全相反：
 *   - 从别的 Markdown 编辑器 / 代码编辑器复制 → 文本本身就是 Markdown，**原样插入**
 *   - 从网页 / Word 复制 → 文本是纯文本，要用剪贴板里的 HTML 转换
 *
 * 判据必须保守：**宁可漏判，也不要误判**。
 * 漏判的代价是「本来是 Markdown 的文本被转换了一次」，
 * 通常还能看出来；误判的代价是「网页里的富文本被当成 Markdown 塞进文档」，
 * 会直接产生一堆奇怪的符号。
 */

/** 强特征：出现这些基本可以断定原文就是 Markdown */
const MARKDOWN_PATTERNS: RegExp[] = [
  /^\s{0,3}#{1,6}\s+\S/m, // 标题：# 标题
  /^\s*([-*+]|\d{1,9}[.)])\s+\S/m, // 列表：- 项 / 1. 项
  /^\s*>\s+\S/m, // 引用：> 引用
  /^\s*(?:```|~~~)/m, // 围栏代码块
  /^\s*\|[^|\n]*\|/m, // 表格
  /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/m, // 分隔线
  /^\s*\[[ xX]\]\s/m, // 任务列表
  /\[[^\]\n]+\]\([^)\n]+\)/, // 行内链接：[文字](地址)
  /\*\*[^*\n]+\*\*/, // 粗体：**文字**
  /`[^`\n]+`/, // 行内代码：`code`
  /==[^=\n]+==/, // 高亮：==文字==
];

/**
 * 这段纯文本看起来像 Markdown 吗？
 *
 * @param text 剪贴板里的 text/plain
 */
export function looksLikeMarkdown(text: string): boolean {
  if (!text || !text.trim()) return false;
  return MARKDOWN_PATTERNS.some((pattern) => pattern.test(text));
}

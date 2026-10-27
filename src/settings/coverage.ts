/**
 * 「还没接线」的设置项清单。
 *
 * ## 这张表为什么存在
 *
 * 本项目反复踩的坑是「看起来能跑、其实没跑」。
 * 2026-10-28 一次就挖出**六个**：设置面板里的复选框能点、能存，
 * 但代码里**没有任何地方读它**——
 *
 * | 设置项 | 面板上写着 | 实际情况 |
 * |---|---|---|
 * | `editor.smartPunctuation` | 智能标点 | 没有输入处理 |
 * | `editor.strictMode` | 严格模式（严格 CommonMark） | 解析规则一点没变 |
 * | `editor.indentFirstLine` | 缩进首行 | 渲染层没接 |
 * | `editor.indentParagraph` | 段落续行缩进 | 渲染层没接 |
 * | `editor.spellCheck` | 拼写检查 | 编辑器没接这个开关 |
 * | `markdown.autoNumberEquations` | 公式自动编号 | 没有这个功能 |
 * | `general.sendAnonymousStats` | 发送匿名使用统计 | **全项目没有任何遥测代码** |
 *
 * 用户看到的是「我改了设置但什么都没变」，却无处可说。
 * 最后一栏更糟：它许了一个**隐私承诺**（收集使用统计），
 * 而应用根本不收集——一个不会兑现的承诺比没有这个开关更误导人。
 *
 * ## 规则
 *
 * 每个设置项必须二选一：
 *
 * 1. **代码里真的有人读它**——由 `tests/settings-coverage.test.ts` 守着；
 * 2. **列在这张表里**，并且在设置面板里**置灰 + 写明为什么**。
 *
 * 两条规则合起来才完整：只有第 1 条，设置项会在面板里消失；
 * 只有第 2 条，「置灰」这件事没人监督。
 *
 * ## 这张表本身也被守着
 *
 * 守卫测试会检查：
 *
 * - 表里的键**都是真实存在的字段**（防拼错）；
 * - 表里的字段**确实没被消费**（实现了就把条目删掉，别让表烂掉）；
 * - 面板里**声明为未实现的复选框确实是禁用的**（查的是运行时 DOM，
 *   不是扫源码——注释能骗过 grep）。
 *
 * ## 值为什么是中文原文
 *
 * 值是给用户看的原因，**中文原文就是翻译表的 key**
 * （见 `src/i18n/index.ts` 的设计说明）。
 * 面板渲染时再 `t()`——不能在模块作用域里翻译，
 * 那样语言一变就定死了（`pnpm i18n:check` 专门查这个）。
 */
export const NOT_IMPLEMENTED_SETTINGS: Record<string, string> = {
  "editor.smartPunctuation": "还没实现：输入时把直引号转成弯引号这类处理还没接入。",
  "editor.strictMode": "还没实现：严格模式要同时改 remark 与 lezer 两侧的解析规则。",
  "editor.indentFirstLine": "还没实现：段落首行缩进还没接入渲染层。",
  "editor.indentParagraph": "还没实现：段落续行缩进还没接入渲染层。",
  "editor.spellCheck":
    "还没实现：这个开关没有接到编辑器上（CodeMirror 6 不自带拼写检查）。",
  "markdown.autoNumberEquations": "还没实现：代码里目前没有公式编号这个功能。",
};

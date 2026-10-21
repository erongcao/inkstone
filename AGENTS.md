# AGENTS.md — Inkstone 开发约定

> 本文件是 Inkstone 仓库的**项目级约定**。任何 AI 助手或贡献者在改动本仓库前请先读它。

## 项目是什么

Inkstone（砚）是一个**开源 Markdown 编辑器**，对标 Typora 的 Live Preview 混合编辑体验。
先做 macOS，后续扩展 Windows / Linux。MIT 协议。

完整背景、竞品调研、选型依据见 `docs/plan.md` 与 `docs/typora-feature-inventory.md`。

## 三条不可动摇的架构约束

违反这三条的 PR 会被直接打回。

### 1. 单一真相源是 Markdown 文本

- 内存模型是 **CodeMirror 6 的文档**——里面装的**就是纯 Markdown 文本**，一个字符都不多
- 不引入数据库、不引入专有格式、不做"富文本文件格式"
- 任何编辑操作最终都序列化为 Markdown 写回
- 渲染效果由**装饰器（Decoration）**产生，装饰器只影响显示，不影响文档内容

### 2. 源码模式永远可达、永远无损

- 即使 Live Preview 在某个边界场景出问题，源码模式也必须是完整可用的退路
- 不允许为了"所见即所得"牺牲内容的可逆性
- 实现上，源码模式与实时预览是**同一个编辑器实例**切换装饰器，
  所以光标、滚动、撤销栈天然保持（见 `docs/plan.md` 的 M1 结论）

### 3. 解析规则唯一（2026-10-20 修订）

- **mdast 是全应用唯一的语义来源**：渲染、导出、大纲、脚注编号全部从同一棵 mdast 树派生
- **lezer 只服务于"编辑视图的实时布局"**——回答"哪里是标记、哪里是正文"，
  不产出任何语义结论（不含引用编号、不含标题层级树）
- 两者的一致性由 `tests/corpus/` 的语料库断言（同一份语料，mdast 与 lezer 的结构判定必须吻合）
- 任何模块都不得自己再实现一套 Markdown 解析逻辑

> **为什么修订**：原计划「解析规则唯一」隐含「全应用只用一个解析器」。
> 实测（`scripts/bench-parser.ts`，2026-10-20）remark 全量解析 1000 行 p95 ≈ 11ms、
> 3000 行 ≈ 29ms，已超出 16ms 的交互预算；而 lezer p95 分别是 1.05ms / 1.82ms。
> 编辑视图要求每击键即时更新，只能用 lezer 做布局；语义仍归 remark/mdast。

## 技术栈（不要随意更换）

| 层 | 选型 | 备注 |
| --- | --- | --- |
| 外壳 | Tauri 2 | 实测应用包 4.24 MiB（CM6 接入后）；Electron 方案约 200 MB，前端代码可复用但包体代价大 |
| 编辑内核 | **CodeMirror 6** | M1 实测后从 Milkdown 改选，理由见下方「M1 选型结论」 |
| 语义解析 | remark / unified / mdast | 渲染、导出、大纲、脚注编号的唯一来源 |
| 编辑视图布局 | lezer / @lezer/markdown | 增量快 10–15 倍，只回答「标记在哪」 |
| 高亮/公式/图表 | Shiki / KaTeX / Mermaid | KaTeX 而非 MathJax——同步渲染，编辑器里不抖 |
| 前端 | React 19 + Vite 8 + TypeScript 5.9 | TS 锁 5.9：typescript-eslint 8.72 尚未适配 TS 7 |

## M1 选型结论：为什么是 CodeMirror 6 而不是 Milkdown（2026-10-20）

原计划选 Milkdown 7（ProseMirror + remark）。M1 spike 用实测数据推翻了这个决定：

| 维度 | Milkdown 7 | CodeMirror 6 | 胜出 |
| --- | --- | --- | --- |
| 标记符是否入文档 | **否**。`src/mark/strong.ts` 显示 strong 是 ProseMirror mark，`**` 根本不在文本里 | **是**。文档恒为 Markdown 源码，`**` 就是普通字符 | CM6 |
| 直接编辑 `**` | 做不到 | 天然可编辑 | CM6 |
| 源码 ↔ 混合模式 | 需序列化 + 重解析 → 撤销栈分裂、光标映射难、有漂移风险 | 换装饰器，光标/滚动/undo 天然保持 | CM6 |
| 实时布局性能 | remark 1000 行 p95 ≈ 11ms（超 16ms 预算） | lezer p95 ≈ 1.05ms | CM6 |
| 中文 IME | ProseMirror 成熟 | CM6 成熟 | 平手 |

**结论**：Typora 式体验的硬性要求是「标记符是真实可编辑的文本」。这一条 Milkdown 做不到，
CM6 天然满足。其余能力两者都能做到。**因此编辑内核改用 CodeMirror 6，Milkdown 不进依赖树。**

代价：CM6 没有富文本语义，需要我们自己实现「渲染层」（公式、图表、表格），这是 M2/M3 的工作量。

### 外部验证：标杆编辑器都是这条路（2026-10-20 调研）

完整调研见 `docs/editors-comparison.md`。**四家标杆中，没有一家的文档模型是「富文本节点里不含标记符」**：

| 产品 | 文档模型 | 标记符 | 隐藏机制 | 渲染粒度 |
| --- | --- | --- | --- | --- |
| **Typora** | 真实文本层 + AST | 真实可编辑 | `.md-meta`/`.md-content` 双元素 + `.md-expand` class 切换 | **段落级 AST + 增量渲染** |
| **Ulysses** | 纯文本（Markdown XL） | **始终可见**，只弱化着色 | 不隐藏 | 整篇语法高亮 |
| **Bear** | 纯文本 | 隐藏，「通用模式」可切回 | NSTextView 自定义 | 整篇 |
| **Milkup** | ProseMirror 树 + `syntax_marker` **文本节点** | 真实文本节点 | CSS `font-size: 0` | 整篇 + 两级缓存 |
| **Inkstone** | 纯 Markdown 文本 | 真实可编辑 | `Decoration.replace` 零宽 widget | 全文 lezer |

**最有参考价值的是 Milkup**（`github.com/Auto-Plugin/milkup`）：它的 v1 版本**从 Milkdown 迁到了自研
ProseMirror 内核**，理由和我们完全一样——mark 不含标记符文本，做不到直接编辑 `**`。
但它为解决这件事付出的代价是：自研 1200 行 Parser + 自研 Serializer + 文档重建（源码模式要
`replaceWith` 整篇替换）+ `syntax-detector`/`syntax-fixer` 配对插件。**CM6 路线把这一整套成本降为 0。**

> Milkup 用 CSS `font-size: 0` 隐藏标记，代价是光标进不去标记区间，所以必须额外写插件处理
> 「用户在渲染模式下输入 `**`」的场景。我们用 `Decoration.replace` + 零宽 widget，
> 光标能落在标记区间内——**从根上避开了这个坑**（M1 spike 实测确认）。

**Typora 的两个可借鉴点**（已采纳或列入待办）：
1. **段落级 AST + 只重渲染变动节点**（见 M1 待办「lezer 增量解析」）
2. **Typora 源码模式用的是 CodeMirror 5**（官方支持页原文："Typora uses CodeMirror for
   syntax highlighting in code fences"）—— 说明「CodeMirror 作为编辑器内核」在本品类里被验证过

## 标记符显示策略：三种（2026-10-20）

对应三个标杆产品，实现上共用同一份文档、同一套装饰器管线，切换只改装饰器策略：

| 策略 | 行为 | 对标 | 设置项 |
| --- | --- | --- | --- |
| `live` | 标记隐藏，光标进入才显露 | Typora（默认） | `editor.markerDisplay` |
| `dimmed` | 标记始终可见但弱化着色，内容照样渲染 | Ulysses | 同上 |
| `source` | 纯 Markdown 原文，无任何装饰 | Typora 源码模式 / Bear 通用模式 | 同上 |

> **为什么三种都要有**：Ulysses 拿了 Apple Design Award，它的「标记符不隐藏、只弱化」
> 是一条被验证过的产品路线，且实现成本极低（`Decoration.replace` 换成一个 `Decoration.mark`）。
> Bear 的「通用模式」也证明「同一份文档切标记符显示策略」是可行交互。

## 自动配对：规则来源与关键行为（2026-10-21）

设置项 `editor.autoPairMode`，三档：`off` / `basic` / `markdown`。

规则不是凭感觉写的，三处来源都核对过：

| 来源 | 核对到什么 |
| --- | --- |
| Typora 官方文档 `support.typora.com.cn/Auto-Pair/` | 两级开关、`~ = ^` 不自动补闭合 |
| 官方演示视频 `media/auto-pairs/autopair2.webm`（**逐帧抽帧核对**） | `*` 是**逐级升级**的，不是固定配两个星号 |
| Typora Markdown Reference | 每个符号的真实语法长度（`~~` 删除线、`==` 高亮、`^` 单个上标） |

**`*` 的逐级升级**（视频第 2–3 帧逐帧确认）：

```
敲第一个 *   →  *|*        斜体标记
紧接着再敲 * →  |**        升级成粗体标记
敲完内容再敲 * → 闭合
```

所以 `*text*` 是斜体、`**text**` 是粗体，两者都能自然打出来。
固定配成 `**` 会让用户想写斜体却总得到粗体——这是刻意避开的。

**`~` `=` `^` 只在有选区时包裹**（官方文档明确）：
`==文字==`（高亮）、`~~文字~~`（删除线）、`^文字^`（上标，Typora 的上标就是单个 `^`）。

**两条自加的保护规则**（Typora 行为未知，但不加会明显碍事）：

- 单词内部不配对 —— 否则 `snake_case` 会被拆成 `snake_case_`、`2*3` 会被拆坏
- 光标右侧是普通字母数字时不配对 —— 否则往已有文字里插符号会多出一个闭合符

**刻意不做的规则**：行首 `*` 不配对。虽然行首 `*` 是列表符号，
但行首写粗体才是最常见的场景；列表是「`*` + 空格」触发的，那个冲突留给 M2 的
列表功能处理（它需要顺手清掉自动补上的尾随 `*`）。

## 代码约定

- **注释用中文**，解释「为什么」而不是「做了什么」
- 注释里保留**版本号、来源链接、API 签名**等可核验信息
- 遇到不熟悉的 API，**去 `~/.cargo/registry/src/` 读 crate 源码确认签名**，不要凭记忆写
  （Tauri 2.12 的 `Submenu::with_items` 比想象中多一个 `enabled` 参数，`MenuItem::with_id` 的 accelerator 是第 5 个参数——都是踩过的坑）
- 前端状态一律走**模块级 store + `useSyncExternalStore`**，不要在组件里 `useState` 存全局状态
  （组件间共享状态必须同一个实例，否则字数统计、脏标记会不同步——踩过）
- React 19 的 `react-dom/client` **没有默认导出**，必须 `import { createRoot } from "react-dom/client"`
- 遇到不熟悉的 **JS 库 API**，同样去 `node_modules/<pkg>/dist/index.d.ts` 读类型定义确认，
  不要凭记忆写（CM6 的 `DecorationSet` 只是类型别名、`Facet.compute` 只在依赖字段变化时才重算——
  都是踩过的坑，见下方「CodeMirror 6 踩坑记录」）

## CodeMirror 6 踩坑记录（2026-10-20 spike 实测）

全部是实测踩出来的，不要重试：

1. **`Facet.compute` 只在依赖字段变化时重算**
   文档原话：*"your function is only called again for a new state when one of those parts changed"*。
   把装饰器挂在 `EditorView.decorations.compute([livePreviewEnabled], ...)` 上，
   而 `livePreviewEnabled` 只在切换模式时变 → **装饰器只在初始化时算一次，之后永不更新**。
   正确做法：用 `ViewPlugin.fromClass` 的 `update()`，在每个事务后显式重算。

2. **`DecorationSet` 只是类型别名**（`= RangeSet<Decoration>`），不能当值用。
   真正能用的是静态方法 `Decoration.set(ranges, sort)` 和 `Decoration.none`。

3. **`Decoration.mark({class}).range(a, b)` 返回 `Range<Decoration>`**（带 from/to 的区间），
   不是 `Decoration` 本身。`Decoration.set()` 要的正是这种区间数组。

4. **`RangeSet.iter()` 返回的 `RangeCursor` 不是可迭代对象**，
   必须 `while (cursor.value !== null) { ...; cursor.next(); }` 手动推进。

5. **装饰器的 `spec` 是扁平结构**：`Decoration.mark({class: "x"})` 的 spec 就是 `{class: "x"}`，
   没有 `spec.mark.class` 这种嵌套。`Decoration.replace({widget})` 的 spec 里**没有** `replace` 键，
   靠 `widget` 字段区分。

6. **lezer 的 `tree.iterate({enter(ref)})` 给的是 `SyntaxNodeRef`**（轻量引用），
   要拿完整节点得用 `ref.node`；`ref.node.parent` 才有父节点信息。

7. **`@lezer/markdown` 的 `parser` 是预配置实例**，不是 `new MarkdownParser()`；
   GFM 扩展要 `parser.configure(GFM)`。

8. **隐藏标记必须用 `Decoration.replace` + 零宽 widget，不能用 CSS 隐藏**。
   replace 保持文档坐标不变，光标仍能落进标记区间（我们据此判断「光标进入了」）；
   纯 CSS 隐藏（`font-size:0` / `display:none`）会让光标永远进不去，做不到直接编辑 `**`。

9. **展开判定用「左开右闭」**：`node.from < cursor <= node.to`。
   光标在正文里 → 展开；紧跟结束标记之后 → 展开（浏览器把这种光标放在元素内部，与 Typora 一致）；
   紧贴开始标记之前 → 不展开（光标在结构之外）。

10. **`EditorView.inputHandler` 在 IME 组字期间也会被调用**。
    `applyDOMChangeInner` 里没有任何 composition 判断，`view.inputState.composing` 只用来计数。
    要挡住在组字时插入配对，得用公开的 `view.compositionStarted`
    （= `composing >= 0`，覆盖整个组字生命周期，不只是组字中）。
    官方 `closeBrackets` 用的就是这个判断（`android ? view.composing : view.compositionStarted`）。

11. **inputHandler 必须校验 `from === sel.from && to === sel.to`**。
    IME 提交时浏览器把整段组字文本换成最终文本，DOM 变更范围是 `[组字起点, 组字终点]`，
    而此时 CM6 state 里的选区是**光标**（空的）→ 两者对不上。
    不校验就会把刚提交的中文当成「选区」再包一层符号，把中文输入彻底搞坏。
    这条是抄 CM6 官方 `closeBrackets` 的写法，不是自己想的。

12. **CM6 默认把光标映射到插入内容之前**（assoc = -1）。
    程序化 `view.dispatch({changes})` 之后光标不会自动前进；
    只有真实输入路径（`applyDefaultInsert`）才显式把光标推到插入内容之后。
    写测试模拟击键时必须自己给 `selection`，否则光标一直停在原地。

13. **StateField 里记的位置要随文档变化映射**。
    `tr.changes.mapPos(pos, assoc)`：开标记用 `assoc = -1`（后面插的内容不算进开标记），
    闭标记用 `assoc = 1`（前面插的内容算在闭标记之前）。否则用户打几个字之后
    记录的位置就指错了地方，「跳过」和「升级」两条规则全部失效。

14. **`Compartment.reconfigure` 可在运行时换掉一组扩展**，
    自动配对级别切换就靠它——不用重建编辑器，光标、滚动、撤销栈都不受影响。
    但 `StateField.define` 每次调用会生成**新的字段实例**：
    要跨 reconfigure 保持字段身份稳定，字段必须定义在模块级，不能在工厂函数里定义。

15. **`EditorView.domEventHandlers` 的 handler 签名是 `(event, view)`**——事件在前，视图在后。
    写成 `(view, event)` 类型检查会直接报错（TS2345）。

16. **插件的 DOM handler 排在 CM6 内置 handler 前面**。
    `computeHandlers` 先 push 插件的 handler，最后才 push 内置的；
    `runHandlers` 里第一个返回 true 的 handler 会赢，并且被 `preventDefault()`。
    所以接管粘贴只要 `return true` 即可。

17. **CM6 默认的 paste 只读 `text/plain`**，
    从网页复制过来的内容会变成一坨裸 HTML 源码直接进文档。
    要处理富文本必须自己接管 `paste` 事件。

18. **turndown 的 `addRule` 是 `unshift`**——后加的规则优先级更高。
    要覆盖 GFM 插件的规则，必须在 `td.use(gfm)` **之后**再 `addRule`。

## 粘贴：HTML → Markdown（2026-10-21 实施）

用 turndown 7.2.4（MIT）而不是自己写转换器：嵌套标签的配对、空白折叠、
HTML 实体解码这些坑都很深，自己写的转换器会长期持续产出脏 Markdown。

三种来源，三种处理：

| 剪贴板内容 | 处理 |
| --- | --- |
| 只有纯文本 | 原样插入 |
| 纯文本本身就是 Markdown | **原样保留**（判据见 `src/editor/paste/detect.ts`） |
| 网页 / Word 的富文本 | 用 `text/html` 转成 Markdown（**样式净化**） |

在 turndown 之上额外做的四件事：

1. **样式净化**：剥掉 `script` / `style` / `iframe` / `object` / 表单控件 / `svg` 等标签。
   turndown 自己不处理这些；它用 `designMode` 解析 HTML，脚本不会执行。
2. **识别行内样式**：Word / Google Docs 导出的是 `<span style="font-weight:bold">`，
   不识别这套行内样式，从这些来源粘贴过来的加粗会整个丢掉。
3. **删除线用 `~~` 而不是 `~`**：GFM 插件默认输出单 `~`，Typora 的语法是 `~~文字~~`。
4. **列表用 1 个空格缩进**：turndown 默认输出 `-   项目`（3 个空格），
   CommonMark 与 Typora 的惯例是 `- 项目`。

`<mark>` 标签转成 `==高亮==`（Typora 的高亮语法）。

## 质量闸门（CI 强制，提交前本地也要跑）

```bash
pnpm typecheck      # tsc --noEmit
pnpm lint           # eslint，0 warning 容忍
pnpm format:check   # prettier
pnpm test           # vitest：round-trip + 组件交互
pnpm licenses:check # 依赖许可证白名单
cd src-tauri && cargo fmt --check && cargo clippy --all-targets
```

### round-trip 测试是本项目最重要的质量基建

`tests/corpus/` 里每个语料文件都要满足：

1. `解析 → 序列化 → 再解析` 后 **mdast 结构等价**（忽略 position）
2. 序列化结果仍是合法 Markdown
3. **往返两次后收敛**（幂等）

没有这条约束，Live Preview 会慢慢腐蚀用户文件。

### 依赖许可证白名单

只允许 MIT / Apache-2.0 / BSD / ISC / CC0 / Unlicense / Python-2.0 / Zlib / MPL-2.0。
**禁止** GPL / AGPL / SSPL / EUPL / 商业闭源。

pandoc 是 GPL-2.0，但**以独立进程调用、不链接**，与 Typora 的做法一致，不构成传染。
若将来要彻底规避，可换纯 Rust 的 comrak 做 AST 转换。

## 目录

```
src/parser/     Markdown 解析层（唯一语义来源，remark/mdast）
src/editor/     编辑内核（CM6 封装 + live-preview 装饰器插件）
src/renderer/   渲染层（高亮/公式/图表）
src/export/     导出管线
src/settings/   设置模型与存储
src/theme/      主题注册表与运行时
src/ipc/        与 Rust 侧接口
src-tauri/src/  Rust 后端（document / menu / recent）
tests/corpus/   round-trip 语料库
scripts/        开发工具脚本（bench-parser / dump-lezer-tree / check-licenses）
docs/           计划书与调研文档
```

## 当前状态

M0 已完成（2026-10-20），M1 编辑内核实施中（2026-10-21）：

- 编辑内核从 Milkdown 改选 **CodeMirror 6**（理由见上）
- Live Preview 装饰器已跑通：行内标记隐藏/展开、块级标记弱化、标题层级渲染
- 源码模式 ↔ 实时预览切换已验证**光标位置精确保留**
- 三种标记符显示策略（`live` / `dimmed` / `source`）已实现并实测
- **中文输入法已由用户在真机验证通过**（2026-10-21）——
  这是 M1 唯一可能推翻架构的阻塞项，现已解除。
  注：浏览器合成事件的 `type` 动作不等价于 IME 组字过程，只能靠真机验证。
- 自动配对已实现（`off` / `basic` / `markdown` 三档，运行时可切换）
- 撤销/重做与 Live Preview 装饰器重算的交互已补测试

M1 剩余待办：

- lezer **增量解析**（`TreeEditor`）未接，目前每次击键全量重解析；大文档下需要优化
  （Typora 的做法是「段落级 AST + 只重渲染变动节点」，见 `docs/editors-comparison.md`）
- 复制粘贴：HTML → Markdown 转换 + 样式净化（Markdown 原样保留）
- Live Preview 边界：嵌套标记（`**粗体里的 `代码`**`）
- 表格、公式、图表的渲染层尚未实现（按计划推到 M2）


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
| 高亮/公式/图表 | **highlight.js** / KaTeX / Mermaid | 高亮用 `highlight.js/lib/core` + 显式注册（**不是** Prism——生产构建下会静默失效，见「块级渲染层与代码高亮」）；KaTeX 而非 MathJax——同步渲染，编辑器里不抖 |
| 行内高亮（`==…==`） | remark 侧 `mdast-util-highlight-mark` + `micromark-extension-highlight-mark`；lezer 侧**自研** | remark 侧用上游（事实标准）；lezer 侧自研 25 行——`@lezer/markdown` 没有高亮扩展，而它的 `Subscript`/`Superscript` 只支持**单字符**标记。已知代价：上游那个包的运行时文件 `import` 了测试框架 `uvu/assert`（会被打进产物） |
| 前端 | React 19 + Vite 8 + TypeScript 5.9 | TS 锁 5.9：typescript-eslint 8.72 尚未适配 TS 7 |

## M1 选型结论：为什么是 CodeMirror 6 而不是 Milkdown（2026-10-20 实测 / 2026-10-21 正式拍板）

原计划选 Milkdown 7（ProseMirror + remark）。M1 spike 用实测数据推翻了这个决定，
**2026-10-21 用户在「A（Milkdown + Crepe）」与「B（CM6）」之间明确拍板选 B**。

| 维度 | Milkdown 7 | CodeMirror 6 | 胜出 |
| --- | --- | --- | --- |
| 标记符是否入文档 | **否**。`src/mark/strong.ts` 显示 strong 是 ProseMirror mark，`**` 根本不在文本里 | **是**。文档恒为 Markdown 源码，`**` 就是普通字符 | CM6 |
| 直接编辑 `**` | 做不到 | 天然可编辑 | CM6 |
| 源码 ↔ 混合模式 | 需序列化 + 重解析 → 撤销栈分裂、光标映射难、有漂移风险 | 换装饰器，光标/滚动/undo 天然保持 | CM6 |
| 实时布局性能 | 见下方校准声明 | lezer p95 ≈ 1.05ms | CM6 |
| 中文 IME | ProseMirror 成熟 | CM6 成熟 | 平手 |

> ⚠️ **性能论据的校准（2026-10-21）**：不能说「remark 撑不住每击键」来否决 Milkdown——
> Milkdown 载入时解析一次，之后直接编辑 ProseMirror 文档，每击键并不重解析 remark。
> remark/lezer 的性能数据只用于说明**在 CM6 路线下语义与布局必须分层**。

**结论**：Typora 式体验的硬性要求是「标记符是真实可编辑的文本」。这一条 Milkdown 做不到，
CM6 天然满足。**用户于 2026-10-21 正式拍板采用 CodeMirror 6，Milkdown 不进依赖树。**

拍板判据是本文件的三条架构红线（真相源是 Markdown 文本 / 源码模式永远无损 / 解析规则唯一）——
Milkdown 在前两条上做不到。详见 `docs/plan.md` §2.3「取舍框架与正式拍板」。

代价：CM6 没有富文本语义，需要我们自己实现「渲染层」（公式、图表、表格）和写作 UI，
这是 M2/M3 的工作量。**这个代价是已知并被明确接受的**，不要在后续实现中偷偷回退到富文本文档模型。

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
   （已用 Typora 官方演示视频逐帧核实：敲完收尾 `**` 后标记仍然可见，与右闭一致。）

9.1 **隐藏标记符是 atomic 区间**——`HiddenMarkerWidget.ignoreEvent()` 返回 `true`，
    CM6 据此把该区间标成 atomic，**光标不会停在它内部**，方向键会整个跳过。
    这是好事（折叠状态下不会误入标记），但有两个必须知道的后果：
    - 行首的 `**` 折叠时，光标按 Home 会被弹到标记之后（实测：落在位置 2 而不是 0）
    - 想编辑被折叠的标记，必须先把光标移进结构——此时标记变回真实文本、atomic 消失，
      才可以精确编辑
    所以「点击渲染后的文字」不一定落在你以为的位置，得靠方向键微调。

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

19. **lezer 生态里没有 `TreeEditor` 这个类**（2026-10-21 实测）。
    计划书原文写的「用 `TreeEditor` 做增量解析」是错的——`@lezer/common` 的
    全部导出里没有它，`@lezer/lr` / `@lezer/highlight` / `@lezer/markdown` 里也没有。
    **真正的增量入口是三个 API 的组合**：

    ```ts
    // 1. 把一棵已解析的树登记成「可复用的片段」
    let fragments = TreeFragment.addTree(tree);
    // 2. 按变更区间把片段切开：变更处挖空，其余保留
    fragments = TreeFragment.applyChanges(fragments, changedRanges);
    // 3. 解析时复用没被挖空的那部分旧树
    tree = parser.parse(newText, fragments);
    ```

    CM6 官方走的是同一条路（`@codemirror/language` 的 `ParseContext.changes`）。

20. **`TreeFragment.addTree(tree, fragments)` 不是「更新旧片段」**——
    看实现（`@lezer/common/dist/index.js`）：

    ```js
    static addTree(tree, fragments = [], partial = false) {
      let result = [new TreeFragment(0, tree.length, tree, 0, false, partial)];
      for (let f of fragments)
        if (f.to > tree.length) result.push(f);
      return result;
    }
    ```

    它**总是**新建一个「覆盖整篇」的 fragment，旧 fragment 只有超出新树长度的部分才被保留。
    所以正常情况下 fragments 列表长度恒为 1，增量的复用发生在 `parser.parse(text, fragments)` 内部。

21. **`@lezer/markdown` 的增量解析是可靠的**——900 轮随机编辑对拍，
    增量树与全量树**逐节点（类型 + 起止位置）0% 不一致**。
    复现脚本：`scripts/verify-incremental.ts`（900 轮）+ `tests/incremental-parse.test.ts`（200 轮）。
    Markdown 的块级上下文（缩进、列表层级、围栏代码块）**不会**破坏增量解析的正确性。

22. **`@lezer/common` 的 `ChangedRange` 是 type-only 导出**，必须 `import type`，
    运行时 import 会拿到 `undefined`。

23. **CM6 滚动时会用「空事务」创建 ViewUpdate 并通知插件**——
    `EditorView.measure()` 循环里 `ViewUpdate.create(this, this.state, [])` +
    `update.flags |= changed`（含 Viewport / ViewportMoved），然后 `updatePlugins(update)`。
    所以 `update.transactions.length === 0` **不代表**「什么都没发生」。
    判断是否要重算装饰器要用 `update.viewportChanged`，
    判断「是不是纯滚动」要用 `update.viewportMoved`。

24. **`StateField` 的 `update` 里没有 `tr.state` 之外的新文档访问方式**——
    `tr.state.doc` 是变更后的文档；`tr.state` 在 `update` 回调里是可用的。

25. **`EditorState.update()` 返回的是 `Transaction`，不是 `EditorState`**——
    要拿新状态得写 `state.update({...}).state`。写错会得到一个没有 `.field()` 方法的对象。

26. **unified 的「转换」和「编译」是两个阶段，不能混用**（2026-10-21 实测）：
    - `processor.runSync(tree)` 跑的是 **transformer**，返回的是**新树本身**（不是 VFile）。
      `remark-rehype` 的 transformer 直接返回 hast 树，所以 `runSync` 的返回值就是 hast 树。
    - `processor.stringify(doc)` 跑的是 **compiler**，`run` 阶段**不会**执行它。
      `rehype-stringify` 是 compiler，所以必须 `run` → `stringify` 两步。
    - `processSync(source)` 一步到位（parse → run → stringify），但会重新解析源码。

27. **rehype-stringify 的产物是字符串，`String(vfile)` 会得到 `"[object Object]"`**——
    它的 compiler 返回 VFile，但 `contents` 在某些路径下是 undefined。
    最稳的是直接用 `String(processor.stringify(hast))`（compiler 返回的就是字符串）。

28. **`arboard::set_html(html, Some(alt_text))` 在 macOS 上会同时写两种 UTI**：
    `public.html` 与 `public.utf8-plain-text`（源码 `arboard-3.7.0/src/platform/osx.rs` 的
    `set_html`：`setString_forType(html, NSPasteboardTypeHTML)` + `setString_forType(alt, NSPasteboardTypeString)`）。
    所以「复制为 HTML」一次调用就能同时给富文本和纯文本。
    **已用独立 Rust 程序实证**：写 HTML + alt 后，`get_text()` 读回 alt、`get().html()` 读回带 `<strong>` 的 HTML。
    注意 `arboard` 的 `get_html` 不存在，要用 `clipboard.get().html()`。

29. **合成键盘事件不会写入系统剪贴板**（浏览器工具的固有限制）：
    自动化里按 ⌘C 会触发 copy 事件处理，但 Chromium 不允许合成事件写剪贴板，
    `pbpaste` 读出来是空的。**剪贴板写入只能在真实用户操作下验证。**

30. **`EditorState.create()` 的 selection spec 只支持单选区**——
    `EditorSelection.fromJSON` 要求 `{anchor, head}`，多选区必须用
    `EditorSelection.create([EditorSelection.range(a, b), ...])` 显式构造。
    而且 jsdom 没有 layout，多选区会触发 CM6 视口计算崩溃
    （`TextLeaf.lineAt` 报错），所以多选区相关的测试要用 `EditorState` 而不是 `EditorView`。

31. **lezer 的 `SyntaxNode.toString()` 返回的是节点类型名列表，不是文本**——
    它其实是 `Tree.toString()`（`"CodeInfo"` 这种）。
    取节点文本必须用 `source.slice(node.from, node.to)`。

32. **块级装饰器必须走 `EditorView.decorations` facet，不能走 ViewPlugin**——
    走 ViewPlugin 会抛
    `RangeError: Block decorations may not be specified via plugins`。
    但 `EditorView.decorations.from(field, fn)` **只接受一个 StateField 作为依赖**，
    而块级渲染需要「语法树 + 显示模式 + 光标 + 全文」四个输入。
    解法是把它们合并进**同一个** `livePreviewField`（`live-preview/state.ts`），
    而不是配四个字段。

33. **`.cm-content` 的宽度是 max-content，长代码行会把整个文档撑出横向滚动条**（2026-10-22 实测）：
    CM6 baseStyle 里 `.cm-content` 是 `flex-shrink: 0` + `display: block`，
    宽度由内容决定；`.cm-scroller` 是 `display: flex`，且
    **`.cm-gutter`（行号槽）与 `.cm-content` 是兄弟节点**。
    所以给 `.cm-content` 写 `width: 100%` 是错的——它按滚动容器宽度解析，
    撑满容器后再加行号槽宽度就溢出了（实测正好多出一个行号槽的宽度）。
    正确写法（`live-preview.css`）：
    ```css
    .cm-editor .cm-content { flex: 1 1 auto; min-width: 0; }
    ```
    `min-width: 0` 不能省：flex item 的 `min-width` 默认是 `auto`（= min-content），
    不置 0 就缩不下去。
    前提是我们开了 `EditorView.lineWrapping`——文档级横向滚动本来就不该出现，
    长正文折行，长代码在 `.cm-md-code`（`overflow-x: auto`）内部滚。

## 块级渲染层与代码高亮（2026-10-22）

### 块级渲染：lezer 节点 → widget 的通用机制

`src/editor/render/` 是 M2 所有「整块」渲染的骨架（代码块 / 表格 / 公式 / 图表共用）：

| 文件 | 职责 |
| --- | --- |
| `types.ts` | `BlockRenderer` 接口：`find(tree, source)` 找块、`render(match)` 出 DOM |
| `registry.ts` | 幂等注册表（同 id 覆盖而非报错） |
| `scan.ts` | 逐行扫描工具——给 **lezer 不支持**的块结构用 |
| `table.ts` | GFM 表格（**走语法树**：`Table` / `TableHeader` / `TableDelimiter` / `TableRow` / `TableCell`） |
| `task-list.ts` | GFM 任务列表（**走语法树**：`Task` / `TaskMarker`） |
| `code-block.ts` | 围栏代码块定位（lezer `FencedCode`）+ 高亮 |

识别方式有两条路，选择标准是**「lezer 配了 GFM 之后认不认」**：
- 认 → 走语法树（表格、任务列表、围栏代码块）
- 不认 → 行扫描（**数学公式**，它不在 CommonMark 也不在 GFM 里）

### ⚠️ 曾经写错的一条结论（2026-10-22 已纠正）

此前 AGENTS.md 写的是：

> ~~`@lezer/markdown` 的 GFM 扩展不识别表格与任务列表（表格被当成普通 Paragraph）~~

**这是错的。** 根因是测错了对象：`scripts/dump-lezer-tree.ts` 用的是**裸 `parser`**，
而编辑器真正用的是 `parser.configure(GFM)`（见 `live-preview/syntax.ts`）。
配上 GFM 之后实测：

```
Table[0,37]  TableHeader[0,11]  TableDelimiter[12,27]  TableRow[28,37]  TableCell[…]
Task[41,48]  TaskMarker[41,44]
```

连带两个假结论：
- 「`- [x]` 会被 lezer 解析成 `Link` 节点」——只在裸 parser 下才出现
- 「表格与任务列表必须行扫描」——表格因此白写了一版行扫描实现，
  和 remark-gfm 对拍时连续 **4 处不一致**（续行吸收、缩进代码中断、
  列数归一化、列表/引用前缀），全部是 GFM 规则的细节，最后整块删掉改成走语法树。

**教训：验证「某个解析器认不认某个结构」时，必须用编辑器实际使用的那份配置去测，
而不是随手 import 一个裸 parser。** `dump-lezer-tree.ts` 现在也应该配 GFM，
否则它会继续误导人。

块级展开判定用**严格开区间** `from < cursor < to`：
打开文件时光标在 0，第一个代码块是收起的（与 Typora 一致）；
点击渲染块 → mousedown 把光标 dispatch 到 `from + 1` → 块切回源码。

### lezer 与 micromark 的两处**已知**分歧（记录在案，未修）

`tests/table.test.ts` 里有一组明确标注「记录在案，不修」的断言：

1. **表格后紧跟 4 空格缩进的行**：remark 判它是缩进代码块 → 表格到此为止；
   lezer 把它吸收成表格的一行。
   复现：`` `| a |\n| --- |\n| 1 |\n    x` `` → lezer `Table[0,25)`，remark 表格只到 `[0,19)`。
   不修的理由：缩进代码与「列表项内的相对缩进」在语义上互相纠缠，
   正确处理要复刻 CommonMark 的缩进解析——那正是行扫描方案翻车的原因。
2. **公式块里的表格**：lezer 不认识数学，会把 `$$\n| a |\n| --- |\n$$\n` 里的
   表格照认不误（实测 `Table[3,19)`），而 remark 判它属于公式块。
   这个好解决：`findTables` 接 `blockRanges` 参数，让已被块级渲染器占用的区间让开
   （`BlockRenderer.find` 契约的第三个参数）。

### 代码高亮：Prism → highlight.js（**发布级 bug，不是口味问题**）

先用 Prism（Typora 同款，MIT），实测翻车：

| 环境 | 结果 |
| --- | --- |
| vite dev | 高亮正常 |
| vitest | 失效 |
| **rollup 生产产物（`vite preview`）** | **静默降级成纯文本** |

根因：**Prism 的语言组件是副作用式注册到全局的**。
`prism-javascript.js` 执行时往**全局** `Prism` 上挂 `Prism.languages.javascript`，
而 `prismjs` 的 ESM interop 在不同环境下给出的是**不同对象**。
rollup 生产构建改变模块执行顺序后，「注册在一个实例、读取在另一个实例」，
`Prism.highlight` 找不到 grammar 就**静默返回纯文本，不报错**。
（附带坑：`Prism.highlight` 第二个参数是 **grammar 对象**，传语言名字符串同样静默降级。）

换成 **highlight.js `lib/core`**（`highlight.js@11.12.0`，BSD-3-Clause）：
单例由模块自己持有，`registerLanguage` 是**显式**调用，语言模块是**纯函数**，
不碰任何全局对象 → dev / 生产构建 / vitest 三处行为一致。
**生产产物已实证**：`<code class="hljs language-typescript">` 下有完整的
`hljs-keyword` / `hljs-title function_` / `hljs-attr` / `hljs-built_in` token。

注册方式（`ensureHighlighter()`，幂等）：
`lib/core` + 显式 `import xxx from "highlight.js/lib/languages/xxx"`，
**不用**全量入口（193 语言，1474 KB raw）。注册 30 个常用语言 = 269.3 KB raw。
`registerLanguage` 会顺带注册语言定义里的 `aliases`，所以 `js`/`ts`/`py` 自动可认。

`resolveLanguage()` 返回**规范名**而不是原样透传——注意
`hljs.getLanguage("js")` 会返回 JavaScript 的语法对象（它吃别名），
所以不能拿它当规范名；highlight.js 不提供「别名 → 规范名」的公开 API，
注册完自己扫一遍 `listLanguages()` 和各自的 `aliases` 建反向表。

### 包体代价（实测，raw 未压缩）

| 方案 | 语言数 | raw |
| --- | --- | --- |
| Prism 等价集（31 语言 + 核心） | 31 | 172.2 KB |
| **highlight.js 常用集（30 语言 + 核心）** | 30 | **269.3 KB** |
| highlight.js 全量 | 193 | 1474 KB |

换库代价约 **+97 KB raw / +40 KB gzip**（主 chunk 523 → 669.75 kB，gzip 225.53 kB）。
**判断：值得。** 买的是一个「生产构建里不会静默失效」的正确性，
对一个本地桌面应用来说 40 KB gzip 无关痛痒，而高亮静默失效是发布阻断级缺陷。
hljs 的语法也比 Prism 的 `clike` 派生方式准（TS 泛型 / 装饰器 / JSX / 模板字符串）。

### 亮/暗双主题

**不用 highlight.js 自带主题**（class 规则写死，跟我们的令牌对不上）。
`live-preview.css` 里把 `.hljs-*` 映射到 `--ink-code-*` CSS 变量，
亮/暗两套令牌（`tokens.css`）各给一组色值，切换主题自动跟随。

## 块级公式：KaTeX（2026-10-22）

### 按需加载

`katex/dist/katex.mjs` 单文件 **603 KB**（raw）+ `katex.min.css` 25 KB + 字体，
和 remark-rehype 是同一条理由（冷启动有 < 1.5s 的目标），所以沿用 `html-loader.ts` 的模式：
`main.tsx` 启动后 `primeMathRenderer()`，`math-loader.ts` 缓存实例，
真正 import KaTeX 的是独立的 `math-render.ts`（静态引入 KaTeX 的只有这一个文件）。

**与 HTML 渲染器的一处关键不同**：`⌘C` 拿不到 HTML 渲染器只是降级，
但公式拿不到时 `render()` 返回 null → 块级装饰器不生成 → **公式块直接显示成源码**。
所以加载完成必须主动通知编辑器重算，见下一条。

### `refreshRendering`：为什么空事务不管用

`livePreviewField.update` 在「无文档变更 + 光标没动 + 模式没变」时会 `return value`，
字段值身份不变 → CM6 认为装饰器输入没变 → **根本不重算**。
表现是公式一直停在源码形态，直到用户敲下一个字符才刷新。
所以必须有显式 effect 打破短路（`state.ts` 的 `refreshRendering`），
由 `live-preview/index.ts` 里的 ViewPlugin 订阅就绪事件后 dispatch。
（ViewPlugin 是为了拿到 `EditorView` 实例——扩展工厂只返回 Extension，拿不到。）

### 定位规则：全部对着 remark-math 实测过，不要凭直觉

`$$` 不在 CommonMark 里，lezer 不认识（实测 `$$\nx^2\n$$` 就是一个普通 `Paragraph`），
所以走 `scan.ts` 行扫描。**但规则必须跟语义层对齐**（架构约束 C），
下列几条都是用本仓库的 `parseMarkdown` 实跑出来的：

| 输入 | remark-math 的判定 | 本渲染器的处理 |
| --- | --- | --- |
| `$$\nx^2\n$$` | `math`（块级） | 块级 ✓ |
| `$$x^2\n$$`（开标记带内容） | `math`（块级） | 块级 ✓ |
| 行首单行 `$$x^2$$` | `paragraph(inlineMath)` | **按 Typora 习惯当块级渲染**（见下） |
| 行中 `结尾 $$x^2$$ 结束` | `paragraph(text, inlineMath, text)` | **不是块级** ✓ |
| **未闭合** `$$\nx^2\n\n后面` | `math`，value = `"x^2\n\n后面"` | **一路吞到文末** ✓ |
| 3 空格缩进的定界符 | `math` | 块级 ✓ |
| 4 空格缩进 | `code` | 不是块级 ✓ |
| 围栏/缩进代码块、HTML 块里的 `$$` | 不是 math | 不是块级 ✓ |

两个容易踩的点：

1. **未闭合的 `$$` 会吞掉整篇文档**。这看着很反直觉，但实测就是这样，
   和围栏代码块未闭合的行为一致。必须照做，否则编辑器显示源码、导出却按公式渲染。
2. **公共缩进会被剥掉，行内的相对缩进保留**。
   实测 3 格缩进的 `\begin{align}` 剥成 0 格，而 `y = a &= b` 与 `z   &= c`
   的对齐空格原样保留。所以只能剥**公共前缀**，逐行 `trimStart()` 会把 LaTeX 对齐环境彻底抹平。

**已知显示层分歧**：行首单行 `$$x^2$$` 被 remark-math 判为 `inlineMath`，
本渲染器按 Typora 习惯把它当**块级居中**显示。解析仍以 remark 为准（编辑器的单一真相源是文本），
差异只在显示。等 HTML 导出的公式渲染（rehype-katex）落地时要复核这处是否需要收敛。

行扫描的禁区用 lezer 划：lezer 认识代码块与 HTML 块（`FencedCode` / `CodeBlock` / `HTMLBlock`）、
不认识公式，两者互补不打架。

### 字体瘦身：只留 woff2

`katex.min.css` 每个 `@font-face` 都列了 woff2 + woff + ttf，
Vite 会把**被引用到的全部**字体打进产物：

| 格式 | 数量 | raw | 是否会被下载 |
| --- | --- | --- | --- |
| woff2 | 19 | 250 KB | ✅ 浏览器只下载列表里第一个支持的格式 |
| woff | 20 | 296 KB | ❌ 永不下载 |
| ttf | 20 | 502 KB | ❌ 永不下载 |

即 **876 KB 打进 .app 但永远用不到**。
`vite.config.ts` 的 `woff2OnlyFonts()` 插件在 `enforce: "pre"` 阶段
把 KaTeX CSS 里非 woff2 的 `src` 条目剔掉，`dist` 实测 3.7 MB → **2.9 MB**。
只针对 KaTeX 的 CSS 做改写，不做通用规则——通用规则容易误伤将来真需要 ttf 回退的字体。

（实测踩坑：插件的匹配正则写成 `/katex[\w-]*\.css/` 时**匹配不到 `katex.min.css`**——
`.` 不在 `[\w-]` 里，必须写成 `[\w.-]*`。第一版就是这样白装了一次。）

## 焦点模式 / 打字机模式（2026-10-23）

### `EditorView.decorations.from(field, get)` 的 get **拿不到 state**

焦点模式要「哪些行属于亮区」，光靠字段值（一个 boolean）算不出来——
需要 `state.doc` 和语法树。所以装饰集合放进**另一个 StateField** 里算好，
`provide` 时直接把字段值透出去。
（`livePreview/index.ts` 里 `get` 只需要 mode/cursor 那些，所以那里用 `.from` 是对的。
两种写法各有适用场景，别混。）

### ⚠️ lezer 的坑：`cursor.node` 每次访问都返回**新对象**

「同级往前找最近的标题」第一版写成 `if (node === block)`，
结果**永远不成立**——lezer 的 `SyntaxNode` 每次访问都新建对象，
引用比较对同一个节点也是 false。只能比位置（+ 类型）：

```ts
if (node.from === block.from && node.to === block.to) { ... }
```

### 「找最近的标题」不能只看紧邻的上一个兄弟

正文里两个标题之间往往隔着好几个段落，紧邻的那个是**段落**不是标题。
第一版只记 `prev`，结果标题永远点不亮。
正解是一路往前走、记住**最近遇到的那个** `ATXHeading*`。

### 弱化范围：逐行判归属，不要前后扫

最终规则是「标题 + 当前段落」**两处**点亮，标题与段落之间的内容**仍然弱化**
（整节都点亮会让这功能失效）。
只有两个区间时前后扫很容易把「中间那段算亮还是算暗」写错，
逐行 `active.some(r => line.from >= r.from && line.to <= r.to)` 一眼就对。

另外 `doc.lineAt(block.to)` 拿到的是**块自己那一行**（行尾位置仍属于该行），
「块之后」的循环必须从 `doc.lineAt(last).to + 1` 起。

### 打字机模式：不能和用户抢滚动

无条件每次都居中，会把「往上翻看之前写的内容」的人立刻拽回来。
规则：用户滚轮/拖滚动条 → 挂起，直到下一次敲键盘才恢复。
判定靠记录上一次我们自己写下的 `scrollTop`，数值对不上就是用户动的
（CM6 没暴露「这次滚动由谁触发」，只能反推——本模块唯一一处不优雅，已记档）。

`scroll` 事件**不冒泡**，所以不能挂在 `domEventHandlers` 上（那只挂 contentDOM），
必须在插件构造时直接 `view.scrollDOM.addEventListener`，destroy 里解绑。

### `Transaction` 没有 `selectionSet`

`ViewUpdate` 有 `selectionSet`，`Transaction` 上只有 `selection`
（且未变化时返回 `undefined`）。别把两者的 API 混用。

## 图片：落盘 + 相对路径 + 渲染（2026-10-23）

### 为什么不走 Tauri 的 `asset://` 协议

asset protocol 要在 `tauri.conf.json` 里配 `assetProtocol.scope`，而 scope 本质是
**一份允许 WebView 读盘的目录白名单**：放宽 = 把整个用户目录交给渲染层，
收窄 = 挡掉「文档在 A、图片在 B」这类正常用法。

选的另一条路（`src-tauri/src/asset.rs`）：Rust 读文件 → 拼 `data:` URL → 给前端。
代价是内存（base64 比原文件大 1/3），收益是**不动安全配置**，而且相对路径 /
绝对路径 / 跨目录路径走同一条代码路径，行为完全一致，浏览器降级模式也能工作。
超过 16 MB 就不内联，直接退回占位——一张 20 MB 原图不该把内存吃穿。

### 字节走 base64 文本通道，不是 `Vec<u8>`

Tauri 的 JSON IPC 会把字节数组展开成 `[104,105,…]`，一张 1 MB 的图就是
**一百万个数字**，序列化本身就是瓶颈。传 base64 文本走同一条通道，体积还更小。

### 落盘规则

| 场景 | 位置 |
| --- | --- |
| 文档已保存 | `<文档目录>/assets/` |
| 未命名文档 | `~/Pictures/Inkstone/` |

- **永远不覆盖同名文件**：`a.png` → `a-1.png` → `a-2.png`。
  直接覆盖等于悄悄毁掉用户之前放进去的东西。
- 写回 Markdown 的是**相对文档目录的正斜杠路径**（`assets/a.png`）；
  跨盘符 `strip_prefix` 失败时才退回绝对路径。
- 文件名来自拖放事件 / 剪贴板 = **外部输入**：先按两种分隔符切取最后一段，
  再把文件系统非法字符与控制字符换成 `_`。这是路径穿越（`../../etc/passwd`）的唯一防线。

### 渲染：行内 `Decoration.replace`，**不能用 block**

图片必须是行内的——`文字 ![图](a.png) 文字` 要保持同行。
用 `block: true` 的 widget 会另起一行。

`toDOM()` 是同步的，而 `data:` URL 要等 Rust 读盘，所以先渲染占位（替代文本 +
固定最小尺寸，避免图片到位时整篇文档往下跳），异步拿到 URL 后**原地补 DOM**。
结果按「文档路径 + src」缓存，缓存上限 200 条（换文档不会串味，但会无上限增长）；
**失败结果不缓存**——用户刚把图片拖进目录，刷新一下就该显示出来。

### 链接引用表惰性建

`![alt][ref]` 这种引用式图片要去文档里找 `[ref]: 地址`。
收集定义要整棵语法树走一遍（1000 行约 0.16ms），而绝大多数文档一个引用式图片都没有。
所以用闭包惰性触发，**每击键白花这个钱不值**。

### 尖括号目标要剥壳

`![a](<assets/图 1.png>)` 的 URL 区间**含尖括号**（lezer 原样切），
不剥掉的话 Rust 会去找一个名字里带 `<` `>` 的文件。
而 `![a](assets/图 1.png)`（裸空格）在 CommonMark 里就不成立——
lezer 不给 URL 节点，`imageParts` 返回 null，源码原样可见，正好是想要的行为。

### 浏览器降级要**如实报错**

`saveImage` 在浏览器里直接 reject。插一句指向不存在文件的 Markdown
会污染文档，直接违反红线 1——宁可什么都不插，也不能骗用户。

## GFM 脚注：lezer 不认，节点形态还会**随文档其它部分变化**（2026-10-23）

`src/editor/render/footnote.ts`。脚注**既不在 CommonMark 也不在 `@lezer/markdown` 的 GFM 扩展里**——
配了 GFM 也一样（`dump-lezer-tree.ts` 实测）：

```
正文[^1]。        →  Link[2,6]（两个 LinkMark）
[^1]: 定义        →  顶层 LinkReference（LinkLabel 以 ^ 开头）
```

### 坑 1：定义**打断段落**时，lezer 既不认定义，还会多给一个引用

```
正文
[^1]: 定义
```

remark-gfm 判成 `def:1`（GFM 允许脚注定义打断段落）；
lezer 把两行当成**一个 `Paragraph`**，只给一个 `Link [3,7]`——
它既没认出定义，还会把这个 `Link` 误当成引用。
所以定义检测必须走行扫描，且要记住标记位置、后面剔掉落在上面的 `Link`。

### 坑 2（更隐蔽）：同一个节点形态会**因文档别处而变**

```
正文[^1]和另一个[^note]。          ← 文档里没有脚注定义
    → Link[2,6] "[^1]" + Link[7,14] "[^note]"   两个独立节点

正文[^1]和另一个[^note]。          ← 文档里有 [^1]: 定义
[^1]: 定义
    → Link[2,14] "[^1]和另一个[^note]"          合并成**一个**节点
```

lezer 在校验链接引用，`[^1]` 命中了后面那行的定义标签，于是把两个括号结构并成一个 `Link`。
**结论：不能拿节点形态当识别依据。**
最终方案：引用改成**全文档行内扫描**（只关心 `` ` ``、`[`、`\n` 三个候选字符，正则驱动），
lezer 只用来划禁区（围栏/缩进代码块、HTML 块）。

### 坑 3：与通用行内 `Link` 处理正面冲突

`analyze()` 会把 `Link` 的两个 `LinkMark` 当链接括号藏掉、把中间套 `cm-md-link`。
脚注引用正好也落在 `Link` 节点里，两个装饰器抢同一段字符，
生产 DOM 里实测到 `cm-md-link` 覆盖了 `^1]和另一个[^note`——屏幕上出现残缺的 `^1]`。

解法：`buildLivePreviewDecorations` 里**先**算脚注，
行内标记那一轮遇到「含脚注引用的 `Link` 节点」直接 `return false` 让路。
（对应测试：`tests/footnote.test.ts` 的「脚注与通用行内 Link 处理不打架」。）

### 语义规则：全部对着 remark-gfm 的 HTML 输出实测过

| 规则 | 实测结论 |
|---|---|
| 编号顺序 | 按**首次引用**顺序，不是按定义顺序 |
| 没有定义的引用 | 保持字面量（remark 输出 `[^missing]`） |
| 没有被引用的定义 | 保持原样（remark 整条丢弃） |
| 标签归一 | 只做**小写**；含空白（含首尾）不成立（`[^  foo  ]` / `[^a  b]`） |
| 空标签 | `[^]` 不成立 |
| 定义缩进 | 0–3 空格成立，4 空格起是缩进代码块 |
| 重复定义 | 第一个胜出 |
| 定义体里的引用 | 算引用（同行尾、缩进续行都算），但要跳过定义体里的代码跨度 |
| 未闭合 / 转义 / 行内代码 | 都是字面量 |

29 条对拍用例逐条比对 mdast 还原出来的编号结果，见 `tests/footnote.test.ts`。

### 性能

`findFootnotes` 在**每击键**都跑。1022 行 / 54 KB 文档实测 **0.27ms**：

| 改动 | 耗时 |
|---|---|
| 初版（逐字符 + `collectSkipRanges` 算两遍） | 0.57ms |
| 改成正则驱动的候选点扫描 | 0.41ms |
| `collectSkipRanges` 提到 `findFootnotes` 里只算一次 | **0.27ms** |

`collectSkipRanges` 要整棵语法树走一遍（0.16ms），定义扫描与引用扫描都要用——
算两遍就白扔三成时间。同理，`decorate` 里的行内标记那一轮也要**复用**已算好的脚注，不能再扫一遍。

### 渲染形态：定义留在原文位置（Typora 做法）

不进底部脚注区。文档坐标不变 → 光标、跳转、撤销天然对得上（红线 1 的延伸）。
引用换 `cm-md-footnote-ref`（上标数字），`[^label]:` 换 `cm-md-footnote-badge`（`1.`），
整块套 `cm-md-footnote-def`（缩进 + 左侧竖线）。点引用跳定义、点编号跳回第一个引用，
走 `data-footnote-jump` + `live-preview/index.ts` 的 mousedown 分发（只移动光标，不改文档）。

## Emoji 补全：`filter: false` 不是优化，是**能不能弹出来**的问题（2026-10-23）

单测全绿、生产构建里弹层死活不出现。根因在 CM6 的二次过滤上，
读 `@codemirror/autocomplete@6.20.4/dist/index.js` 才看得出来。

### 坑 1（要命的那个）：CM6 会拿文档文本去模糊匹配 `option.label`

`sortOptions`（`index.js:793`）在 `filter !== false` 时：

```js
let pattern = state.sliceDoc(a.from, a.to), match;
let matcher = new FuzzyMatcher(pattern);
for (let option of a.result.options)
    if (match = matcher.match(option.label)) { ... }
```

我们的源 `from` 在 `:` 那一列 → `pattern` 是 `":smi"`；
而 `label` 按设计放的是**字形** `😄`。字形里永远找不到 `:smi` 的字符序列，
于是 `options.length === 0` → `CompletionDialog.build`（`index.js:857`）返回 `null` →
`showTooltip` 拿到 `null`，**一个选项都不渲染，也不报错、不打日志**。

而我们的检索和排序本来就在 `searchEmoji` 里自己做完了。所以正确写法是
**`filter: false`**：CM6 跳过模糊匹配，按 `1e9 - i` 递减打分，**原序即序**，正好保住我们的排序。

> 判据一句话：**`from` 含触发字符、或 `label` 不是匹配面，就必须关掉 CM6 的过滤。**
> 这类 bug 单测抓不到（源确实返回了 options），只有生产构建的浏览器实测能看见。

### 坑 2：`override: null` 是「不覆盖」，不是「清空」

```js
let sources = conf.override || state.languageDataAt("autocomplete", cur(state)).map(asSource);
```

`null` 落到右边——Markdown 没有语言级补全数据，拿到空数组，等于把唯一能用的源也关了。
要换掉 CM6 自带的几套源（语言数据/路径/变量名），必须给**数组**：`override: [emojiCompletion]`。

### 坑 3：源「同步」≠ 弹层「同步」

`startQuery`（`index.js:1207`）是 `Promise.resolve(active.source(context)).then(...)`——
**即使源返回非 Promise 也走微任务**；前面还隔着 `activateOnTypingDelay`（默认 100ms）的防抖。

所以「同步源」的意义只是**没有异步竞态**（结果不会被后续事务判为过期丢弃），
不是「立刻弹」。实测确认过的现象：源返回 35 条 hits，`.cm-tooltip-autocomplete` 始终不在 DOM 里。
因为 `filter: false` 时弹层全程无声，别去查 console——查了也是空的。

### 连带后果：`filter: false` 就不能给 `validFor`

上游文档写明「`validFor` must not be given when `filter` is `false`」——
它只在 CM6 二次过滤时用来判断「旧结果还成不成立」。没有它，每敲一个字符都会把结果打回
Pending 重新查询一次。这是**我们要的**：`:smi` → `:smil` 的候选集本来就该变。

代价是每次重查。我们把 `activateOnTypingDelay` 设成 0（源本身同步，1ms 内出结果，
没必要让弹层发灰 100ms），并把 `searchEmoji` 的关键字切分缓存住——
1914 行逐行 `split(" ")` 实测 **0.96ms/击键**，缓存后 **0.08ms**（约 11×）。
如果哪天不用 `filter: false` 了，这个缓存就没有意义，可以一起撤掉。

### 排序：**刻意**只做到「精确匹配 > 关键字短 > 字形码点」

试过加「命中关键字在表里的位置」当二级键，**实测更糟**：`:sm` 会把 🤦(`smh`，排第 10)
和 😤(`smug`，排第 12)顶到最前面。CLDR 没给出任何能区分「本名」与「同义词」的信号，
位置只是数据集的排列习惯。

已知局限（如实记着，别假装解决了）：CLDR 同义词是长尾的——🍏 带 `smith`、🤦 带 `smh`、
😤 带 `smug`，所以 `:sm` / `:smi` 这种**太短的前缀**首位常常不是用户想要的（`:smi` → 🤗）。
再打一两个字母就正常（`:smil` → 😀，`:笑` → 😁）。

## 未闭合围栏会让块**吞掉后续输入**（2026-10-23，验证 M2-4 时撞上的既有严重 bug）

**现象**：生产构建、空文档，敲完 `` ```js `` 三个字符后，编辑器里只剩一个空的
`<pre class="cm-md-code" contenteditable="false">`，再打任何字符都无效——
也就是**根本没法用键盘敲出一个代码块**。

**原因**：未闭合的围栏，lezer 把它**一直算到文档末尾**。于是
`cursor === match.to === doc.length`，而 `isBlockExpanded` 是严格开区间
`from < cursor < to` → 判成「不在块内」→ 块立刻收起。块 widget 是
`contenteditable="false"`，接着打的字全部丢失。

> 与 mermaid 无关。代码块是**同步**渲染的，敲完立刻复现；
> mermaid 只是被 250 ms 防抖延后了 250 ms 而已。

**补法**：块的**末行不是闭合围栏**就说明用户还没写完，此时块尾也算块内。

**这条豁免必须加 `kind === "code"` 限定**（2026-10-23 补记，
做表格工具栏时被它连累过一次）：不加的话，表格、公式块、mermaid
在文末时同样满足 `cursor === match.to`，末行又不是围栏，于是被**永久钉在展开态**——
渲染路径根本走不到，症状是「表格怎么都不渲染成表格」，而且不报错。
只有围栏代码块有「写到一半」这回事；其余块到文末就是写完了，该收起。
回归用例见 `tests/focus-mode.test.ts` 的「未闭合豁免不连累非围栏块」。
判定只看末行是否整行都是围栏字符（`/^ {0,3}(?:`{3,}|~{3,})\s*$/`）：

| 末行 | 判定 | 原因 |
|---|---|---|
| ` ```js ` | 未闭合 → 展开 | 带语言标识，那是**开**围栏 |
| ` ```js\ncode\n``` ` | 闭合 → 收起 | 末行只有围栏 |

先 `trimEnd()`：`match.to` 落在闭围栏**之后**的换行上时，末行是空串。

只补「块尾且未闭合」这一种情形；闭合围栏的原有规则（块首不展开、块内展开、
闭合块尾收起）一字未动。7 个回归用例锁死边界（`tests/focus-mode.test.ts` 末节）。

## Mermaid：包体 + 许可证 + 防抖（2026-10-23）

### 许可证：`elkjs` 是 EPL-2.0 弱 copyleft，**已签字接受**（2026-10-25）

mermaid 12.2.0 的**必需**直接依赖（在 `dependencies` 里，不在 `optionalDependencies`）
elkjs 0.9.3 是 **EPL-2.0**。这不是 GPL 那种病毒式传染——EPL-2.0 是**文件级弱 copyleft**，
约束的是「你改了 elkjs 本身吗」，作为独立库调用不产生义务。`DENIED` 里列的是
EUPL-1.1/1.2（Eclipse 的旧许可），EPL-2.0 是它的继任者、条款结构不同。

`scripts/check-licenses.mjs` 新增 **`ACKNOWLEDGED`** 一档，**刻意与 `ALLOWED` 分开**：
`ALLOWED` 是「闭着眼也没问题」，`ACKNOWLEDGED` 是「技术上可用但弱于 MIT，需要有人点头」。
混在一起半年后就没人分得清了。它不阻断 CI（出口码 0），但**每次都单独打印**、不静默。

**签字记录：2026-10-25，项目负责人曹忆嵘接受**（保留 mermaid）。
撤回方式没变：`git revert` 掉 M2-4 的提交即可整体撤下 mermaid，
`ACKNOWLEDGED` 那一档也会跟着消失。

### 包体：+5.0 MB，所以启动**不**预热

| | assets 总计 | JS 总计 |
|---|---|---|
| 不含 mermaid | 3172 KB | 2601 KB |
| 含 mermaid | 8396 KB | 7573 KB |

KaTeX 603 KB 可以在启动时空闲预热，mermaid 差一个数量级——所以改成
**「文档里真的出现 ` ```mermaid ` 围栏才发起」**（`MarkdownEditor` 的 updateListener）。

懒加载确实生效（别只看构建数字）：沿 `from"./xxx.js"` 的静态引用逐层追，
首屏只有 `index` + 一个共享 chunk = **1034 KB**，
elk(1428) / cytoscape(424) / chunk-*(849) 都不在首屏图里。

### 防抖 250 ms 是**必须的**

装饰器每击键重算。没有防抖的话，用户在图表块里打一个字符就发起一次
50–300 ms 的渲染——打字直接卡死。

### 渲染失败也要进缓存

`mermaid.render()` 对半成品语法必然抛错。缓存里存 `ok: false` + 错误文本，
而不是「失败就不写缓存」——后者会让用户每敲一个字都重新加载一次，永远等不到结果。
这条在 `tests/mermaid.test.ts` 里有专门的回归用例。

### 渲染器注册顺序

`mermaidBlockRenderer` **必须排在 `codeBlockRenderer` 之前**：两者匹配同一个
`FencedCode` 节点。为此 `findCodeBlocks` 补上了 `claimed` 参数——
它第一版忽略这个参数，会让同一段文本被生成两个块级装饰。

## HTML 输出里的公式：自己写插件，不装 rehype-katex（2026-10-23）

改之前「复制为 HTML」把公式输出成 `<code class="language-math">E=mc^2</code>`——
粘到 Word / 邮件 / 任何富文本编辑器都是一段裸 LaTeX。

### 为什么不装 `rehype-katex`

它依赖 `katex@^0.16`，本项目顶层是 `katex@0.19`（`math-loader.ts`）。
npm 的 semver **不把 `0.16` 与 `0.19` 视为同一版本**，于是 Vite 会把
**两份 KaTeX 都打进产物**——603 KB 的重复代码。

自写的插件只有几十行：`remark-math` 已经把公式变成 hast 的
`code.language-math` 节点，要做的只是读出 TeX、调 KaTeX、换回去。
另外也没装 `unist-util-visit` + `@types/hast`：hast 就是 `{children: []}`
的普通树，递归二十行就够，为「遍历一棵树」省十五行不值得引两个包。

### `<style>` 的子节点必须是 `raw` 而不是 `text`

hast 序列化 text 时做 HTML 转义，KaTeX CSS 里的子选择器（`.a > .b`）
会变成 `&gt;`——**转义后的 CSS 在 `<style>` 里不会被浏览器还原**，整张表失效。
这和「把 HTML 当字符串塞进 text 里」是一类错误，只是更隐蔽：结构还在，样式全丢。

配套地 `rehypeStringify` 开了 `allowDangerousHtml`（否则 raw 节点被忽略）。
raw 内容全部由 KaTeX 生成（`trust: false` 已禁掉 `\href` / `\url` 这类宏）。
副作用是用户写在 Markdown 里的原始 HTML 仍会被丢弃——`remark-rehype`
在更早的阶段就没了，`allowDangerousHtml` 救不回来。要保留需另加 `rehype-raw`，
那是「允许任意 HTML 进入剪贴板」的另一个取舍，**留给 M4 导出时一并决定**。

### KaTeX 样式表两条取法，互补

1. `import css from "katex/dist/katex.min.css?raw"`——生产构建里 Vite 把内容
   打成字符串，这条在真机上永远有效
2. 运行时从 `document.styleSheets` 兜底——**测试环境**（vitest 默认 stub CSS）
   会让第 1 条拿到空串，dev 下 CSS 是 `<style>` 注入的，仍能取到

两条都拿不到就返回空串：公式照样渲染成正确的 HTML 结构，只是少了排版样式。
这比让整个复制功能失败要好。

### 顺带修掉：HTML 链路不传解析选项，红线 3 被破坏

`html-loader.ts` 之前自己调 `parseMarkdown(source)` **不带选项**，
于是用户关掉「单 `$` 公式」设置之后，屏幕上不是公式、复制出去却是。

现在 `markdownToHtml` / `renderMarkdownToHtml` / `ensureMarkdownToHtml`
一律接受并透传 `ParseOptions`（签名与 `markdown-loader.ts` 对齐），
剪贴板侧用新增的 `readSettings()` 读用户真实设置——
剪贴板走 copy 事件、必须同步跑完，拿不到 `useSettings()`。

**教训**：`markdown-loader` 早就是 `(source, options?)`，**只有 HTML 链路漏了**。
凡是「同一个解析器的第二个调用点」，签名都要跟着第一个走。

## 图片尺寸：`=WxH` 走两条路，因为 lezer 只认一半（2026-10-23）

Typora 与 Obsidian 都用同一套写法，且**尺寸写进 Markdown**：

```
![说明](图片.png =200x100)   ← 有空格（社区标准）
![说明](图片.png=200x100)    ← 无空格
```

**为什么图片尺寸能做、表格列宽不做**：关键区别是尺寸**写不写进 Markdown**。
图片尺寸写进 `.md`，抄它不引入第二个真相源；列宽 Typora 存自己配置里，
抄它就破坏红线 1。

### lezer 只认无空格那个（实测）

| 写法 | lezer 的 `Image` 节点 | 走哪条路 |
| --- | --- | --- |
| `图片.png=200x100` | ✅ 完整，尺寸在 `URL` 节点里 | `imageParts` 剥尾巴 |
| `图片.png =200x100` | ❌ 只到 `![说明]`，括号外全成纯文本 | 行扫描兜底 |

有空格那个不行，是因为 **URL 不能含空格**——那个空格让 lezer 认不出这是图片。

### 有空格的写法为什么还要支持（行扫描的取舍）

它是**事实标准**，用户从 Obsidian / Typora 带过来的文档都长这样。
不支持的话那些图片会**整块显示成源码文字**，比尺寸不生效更糟。

代价是引入了行扫描，与「能用语法树表达的，就不要用行扫描再实现一遍」相悖。
所以扫描被刻意压到最窄：只在 leger **没有**产出 Image 节点的段落上跑、
只匹配一个固定形状的正则、路径不含空格。两条路不会重复处理同一张图。

### 剥尺寸时最容易误伤的两样东西

**查询参数**：`https://cdn/a.png?w=200` 会被剥成 `…?w` + 宽度 200，图直接坏。
判据：`=` 前面有 `?` / `&` 就不是尺寸后缀。

**base64 的补位**：`data:image/png;base64,AAA=200x100` 里的 `=` 是 base64 自己的。
判据：剥完剩下的路径**必须以扩展名结尾**（`a.png` ✓；`data:…base64,AAA` ✗）。

两条都是「宁可漏剥也不误剥」：漏剥的后果是尺寸不生效，误剥的后果是图裂开。

### `img.width = 260` 不如 `setAttribute`（浏览器实测）

产物里确实带着 `img.width = …` 的赋值语句，DOM 上却**查不到 width 属性**——
IDL 属性走反射，SVG 这类**没有固有尺寸**的图片上不落 attribute。
改成 `img.setAttribute("width", …)` 才正常（实测 `width="260" height="70"`）。

**jsdom 测不出这个区别**：它在 jsdom 里会正常反射。所以这条只有浏览器实测能把关，
测试里如实注明「在 jsdom 里两种写法都能过」。

## 行内 hover 提示：**纯 CSS**，不写 JS 浮层（2026-10-23）

链接 / 行内代码 / 图片的 hover 提示全部用 `content: attr(...)` 做，
一行 JS 都没有。这不是省事，是这三处**没有任何需要同步的状态**：

| | 提示什么 | 数据从哪来 |
|---|---|---|
| 链接 | 折叠后看不见的目标网址 | `Decoration.mark({attributes:{"data-href"}})` |
| 行内代码 | 两侧补出反引号 | 纯 CSS `::before/::after`，无数据 |
| 图片 | 原始路径（图加载后就看不见了） | widget 上的 `data-image-src` |

用 JS 浮层要处理的东西：什么时候开、文档变了要不要重定位、鼠标移开怎么撤、
重渲染时浮层还开着怎么办。浏览器自己的 `:hover` 已经把这些全做对了。
反过来，纯 CSS 的代价是**只能显示静态文本**——要显示图片尺寸就得 JS，因为
尺寸不在标记里、在 `<img>` 的 `naturalWidth` 上。真需要时再换，理由写在这里。

`Hideable` 因此多了 `styleAttrs` 字段。带标题的链接 `[a](url "t")` 只取 URL
节点的文本；引用式 `[a][ref]` 没有 URL 节点，**不挂属性**（挂空值会渲染出空气泡）。

行内代码的 `::before/::after` 有个前提值得记住：标记符被零宽 widget 顶替后
**是真的从 DOM 里消失了**，CSS 补不回来——但视觉上只要两侧各画一个反引号，
用户看到的就是完整源码，点击进编辑态后真反引号露出来，两边无缝衔接。

**已知未验证**：Electron screenshot 在本机持续失败（`browser_action_failed`），
所以伪元素的**最终渲染效果**本轮没能截图确认。已验证的是两侧：
DOM 上 `data-href` / `data-image-src` 确实在位（浏览器实测），
三条规则确实进了产物 CSS（`grep` 确认，未被 postcss 优化掉）。

## 表格图形化编辑：为什么不插手术、要整行重建（2026-10-23）

### 不做列宽——这不是偷懒，是红线 1

**GFM 没有列宽语法**。Typora 支持拖列宽，但它把宽度存在**自己的配置**里，
不写进 Markdown。照搬就是给同一份文档引入第二个真相源：同一份 `.md` 在
Typora 里是一种宽度、在 Obsidian 里是另一种、粘到 GitHub 又是一种。
所以只做增删行 / 增删列 / 对齐，三者都能用 Markdown 表达。

### 增删列走**整行重建**，不做定点插入

原设计是在「列文本起点」插 `| 新列 |`。看着省事，两个坑：

1. **分隔行会粘连。** `| --- | --- |` 在第一列内容起点插 `| --- ` 得到
   `| --- | --- --- |`——两个 `---` 之间没有 `|`，这张表当场失效。
2. **空格形态五花八门。** 实测（纯 lezer GFM）：列数对得上时
   `| a |  | b |`、`| a || b |`、`| a | X| b |` 全都认；
   **列数对不上时任何写法都不认**，而粘连恰恰会让列数对不上。

所以直接把受影响的行重建成规范形式 `| c | c |`（保留行首的引用/列表前缀）。
结果唯一确定、也是用户手敲的样子。代价是被编辑的行会被规整化——
这是用户主动操作的结果，而**只有点过工具栏的那些行会动**，其余行原样保留。

### 行号约定：**0 表头 / 1 分隔行 / 2+ 数据行**

`table-edit.ts` 的几何行号与 `TableMatch.rows`（不含分隔行）**差 1**，
两套编号混用是这个模块最容易出的错，所以：
- 表格工具栏 DOM、纯函数层、事务层**统一用几何行号**
- `TableMatch.rows` 只在渲染层内部用
- `removeTableRow` 的下标 2 起；1 是分隔行，不可删

lezer **不给空单元格生成 `TableCell` 节点**，数节点会少数一列——
所以按未转义 `|` 切列（`splitRow`），不看语法树。

### 工具栏：鼠标 hover 决定作用位置，坐标必须**预置**

渲染态下整张表是一个块级 widget，光标在表外，`findEditableTable` 按光标找表会扑空。
所以工具栏靠 **mouseover 记下的单元格坐标**定位，并把高亮写到 wrapper 的 `dataset`。

**坐标必须在 `tableRenderer.render` 里就预置**（浏览器实测踩到的坑）：
任何一次表格改动都会让这个 DOM 被重建，hover 写在元素上的坐标随之消失。
不预置的症状是「点完第一个按钮有反应，第二个就没反应了」，
而且**不报错**——用户只会当成功能坏了。同理 `runTableAction` 对缺失坐标
要退到文档算出的默认行列，而不是静默 return。

### 分支顺序：工具栏必须在 `data-block-from` 之前

wrapper 上带着 `data-block-from`（`BlockWidget` 写的）。顺序反了的话，
点工具栏会先把表格切回源码，按钮等于永远点不动。

### 「＋行」不能用「有数据行」当门槛

`rows.length < 3` 这种守卫看着合理，实际把「刚用命令面板插出来的空表」
（只有表头 + 分隔行）挡掉了——而那恰恰是最需要加行的时候。
门槛应该是 `< 2 || !rows[1].isDelimiter`：有分隔行就能加。

## 命令面板是 React 覆盖层，斜杠菜单才是 CM6 补全（2026-10-23）

两者用同一份命令表，但**实现工具不同**——这不是偏好，是需求不同：

| | 斜杠菜单 | 命令面板 ⌘K | 链接浮层 |
|---|---|---|---|
| 查询文本在哪 | **文档里**（`/tab`） | 面板的 `<input>` 里 | 浮层的 `<input>` 里 |
| 接受时 | 替换文档里那段文本 | **不动文档** | 往括号里插 URL |
| 允许空格 | 否（空格就该结束匹配） | 是（「插入 表格」） | 是（URL 可以带空格） |
| 焦点 | 全程编辑器 | 全程 input | 全程 input |
| 用什么 | **CM6 补全源** | React 覆盖层 | React 覆盖层 |

命令面板硬套 CM6 补全的后果是：查询词被写进文档、接受时又被替换掉、
Esc 之后文档里留下一截垃圾。CM6 的补全强绑在「文档区间 ↔ 候选」上，
命令面板一条都不满足。

斜杠菜单则完全契合：`from` 指向 `/`，`to` 指向光标，接受时整段替换。
↑↓/Enter/Esc/定位/点击遮罩关闭全部白拿。

### 踩坑：`useEffect(() => { if (open) return; focusEditor() }, [open])` 的方向

「关闭浮层时把焦点还给编辑器」如果写成 `open` 为真时 return、依赖 `[open]`，
那么**打开时也会跑一遍**——编辑器在面板输入框 `focus()` 之后又把焦点抢回去。
表现是：面板开着、输入框看着有焦点，但用户打的字全进了文档。
判据必须是 `!open`。链接浮层和命令面板都踩过，已在两处留注释。

### 踩坑：`autocompletion()` 只能有一个

从 Emoji 扩到「Emoji + 斜杠菜单」时，补全装配必须收拢到一个模块
（`completion.ts`）——两个扩展各装一次 `autocompletion()`，后者覆盖前者。
连带的是 `optionClass` 要按 `option.type` 分派（emoji / slash）。

### 命令表里 `surfaces` 的默认语义

省略 = 两处都出现。所以「视图」「文件」类命令必须显式写 `surfaces: ["palette"]`，
否则它们会出现在打 `/` 的菜单里——而块级命令反过来不能写 `surfaces: ["slash"]`，
那样它们就只在斜杠菜单里、面板里反而没了（第一版就写反了，测试立刻抓出来）。

## 行内公式定界符：`singleDollarTextMath`（2026-10-22 调研 + 实测）

### 调研：商业软件都是默认开单 `$`

| 产品 | 单 `$` 默认 | 有开关吗 | 引擎 |
| --- | --- | --- | --- |
| **Typora** | 开 | ✅ 偏好设置 → Markdown → 「内联公式」 | MathJax / KaTeX |
| **VS Code** 内置预览（1.58+） | 开 | ✅ `markdown.math.enabled` | KaTeX |
| **MarkText** | 开（`config/index.ts` 的 `math: true`） | ✅ 有 | KaTeX |
| **Obsidian** | 开 | ❌ 无（论坛反复有人要求加） | KaTeX |
| **GitHub**（2022 起） | 开 | ❌ 无 | MathJax |
| **Zettlr** | 曾试图关掉单 `$`，引发新 bug（issue #52），改为「开定界符后不跟空格、闭定界符前不跟空格」 | 实验性 | KaTeX |

`$` 与货币的冲突是**公认的老大难**，不是我们臆想的：
[Obsidian 论坛](https://forum.obsidian.md/t/add-option-to-ignore-when-pairing-markdown-symbols/14855/7)
「输入 `$3.50` 会被自动配对成 `$3.50$`」「我不认为用 MathJax 的人比用 `$` 表示货币的人多」；
Zettlr issue #52 有用户贴出 `$100,000` 与 `$50,000` 之间整段被渲染成斜体的例子。

### 关键：这个开关在上游就是一等公民

`remark-math(options)` 把选项**原样透传**给 `micromark-extension-math@3.1.0`，
后者有 `singleDollarTextMath`，官方文档原话：

> `singleDollarTextMath` boolean, default `true` — Whether to support inline math with a
> single dollar sign. **When false, only `$$x$$` and higher sequences work for inline math,
> reducing interference with regular dollar signs in text.**

**所以这不是编辑器自造的启发式，红线 C 不会破。**
（曾经考虑过「关掉 + 加中文/空白启发式」的折中方案，那才是破红线，已放弃。）

实测两种取值（本仓库的 remark 跑出来的）：

| 输入 | `true`（默认） | `false` |
| --- | --- | --- |
| `价格 $5 到 $10 元` | `inlineMath("5 到 ")` | ✅ **无公式** |
| `行内 $x^2$ 结束` | ✅ 渲染 | ❌ 不渲染 |
| **`行内 $$x^2$$`** | ✅ | ✅ **`inlineMath` 仍然有效** |
| `独占 $$…$$` | ✅ | ✅ |
| `价格 \$5 到 \$10` | ✅ 无 | ✅ 无 |

**结论：默认开（与全部商业软件一致），并把开关暴露到设置面板「Markdown → 单 $ 也当行内公式」。**
关掉后 `$$…$$` 在行内仍可当行内公式用，所以「关掉就没有行内公式」不成立。

生产产物实测：开时 `价格 5 到 10 元…` 的 `$5 到 $` 被替换成 KaTeX widget
（KaTeX 把 CJK 包进 `<mtext>` 而不是报错，所以是**静默变形**而非红字）；
关掉后三行分别变成「纯文本 / 纯文本 / 仍渲染」，与设计一致。

### 逐行定位 ≡ 全文解析（用测试保证，不靠承诺）

行内定位要拿 mdast 的位置，但 remark 全量解析 1000 行 p95 ≈ 11ms，每击键都跑不可接受。
解法是**只解析含 `$` 的那一行**。这成立的前提是「micromark 的行内公式不能跨行」——
实测 `开头 $x^2\n+ y^2$ 结尾` 全文解析也不产生 `inlineMath`。

这个等价性被写成了**可执行的断言**（`tests/inline-math.test.ts` 的对拍组）：
13 份语料 + 26 个刁钻片段（跨行 / 列表 / 嵌套列表 / 引用 / 表格单元 / 续行段落 /
代码块 / HTML 块 / 转义 / 同一行多公式 / 货币区间 / Setext 标题……），
每个 × 2 个开关值，逐个对比「逐行结果」与「全文 remark 结果」，必须 `toEqual`。

### remark 管线也必须按需加载

行内定位静态 `import` remark 会把 **137 KB** 拖进主 chunk
（实测主 chunk 672.29 → 809.10 kB），拖慢冷启动。
解法与 KaTeX 同款：让 remark 管线与 KaTeX 共用**同一个懒加载 chunk**
（`math-render.ts` 是唯一同时 import 两者的文件）。
未就绪时 `findInlineMath` 返回 `[]` 并等 `refreshRendering` 补上——
**不退回任何「轻量正则」**，那会变成编辑器自造规则，红线 C 就破了。

实测：主 chunk 回到 674.72 kB（比做行内公式前只多 2.4 kB），
KaTeX 在 `math-render-*.js`（259 KB）、remark 在 `markdown-*.js`（132 KB），都是懒加载。

34. **编辑器里曾并存两棵 Markdown 语法树**（2026-10-22 实测，已修）：
    - `syntaxTree(state)` → CM6 `markdownLanguage` 的树，**裸 parser**，不认 GFM
    - `getSyntaxTree(state)` → Live Preview 的树，配了 `GFM`
    后果不是「颜色不好看」，而是**行为不一致**：靠 `syntaxTree()` 写的编辑逻辑
    看不见任务列表（`- [x]` 根本没有 `TaskMarker` 节点）。
    根因是 `markdown({ base })` 有 `parser instanceof MarkdownParser` 校验，
    而 **pnpm 装了两份 `@lezer/markdown`**，外部配置的 parser 传不进去。
    解法见 `src/editor/markdown-language.ts`：拿 **CM6 自己的** parser 实例去
    `.configure(GFM)`（类不变，`instanceof` 过得了；扩展对象不带类身份），
    两处共用同一个 `Language`。**以后新增依赖语法树的逻辑，统一从
    `editor/markdown-language.ts` 取，不要各处自己 configure。**

35. **`resolveInner(pos, side)` 的 side 会影响节点解析**（2026-10-22 实测）：
    `side = -1`（偏左）在光标位于**文档末尾**时会解析到 Document 而不是段落；
    但换成 `side = 1`（偏右）在别的位置又更糟。
    写「光标所在结构」这类逻辑时，两种都试一下，别默认某个值。

## Live Preview 性能：实测数据与优化结论

### 基线重测（2026-10-23，M2 完成后）

`scripts/bench-decorations.ts`，同一台机器、`--offline`、语料未变：

| 文档规模 | lezer 全量解析 | 三次树遍历 | 完整管线 | 装饰器数 | 全量路径 p95 | **增量路径 p95** |
| --- | --- | --- | --- | --- | --- | --- |
| 500 行 / 13 KB | 1.12ms | 0.17ms | 0.83ms | 616 | 1.97ms | **0.62ms** |
| 1500 行 / 32 KB | 1.87ms | 0.25ms | 1.80ms | 1540 | 3.15ms | **1.73ms** |
| 4000 行 / 90 KB | 4.04ms | 0.63ms | 3.21ms | 4312 | 9.19ms | **3.53ms** |

**不要拿这组数字和 2026-10-21 记的那组直接比**——那一组是 M1 阶段的代码
（只有代码高亮 / 表格 / 公式），现在是 M2 完整（多了 mermaid、图片、脚注、
emoji、表格工具栏、hover 提示）。差值是**功能换来的成本**，不是回退。

### 成本到底在谁身上：逐个摘掉渲染器测（2026-10-23）

同一时刻的 A/B，摘掉一个渲染器后跑 4000 行的增量路径 p95：

| 摘掉 | p95 |
| --- | --- |
| mermaid | 3.46ms |
| 数学 | 3.56ms |
| 代码块 | 3.58ms |
| 表格 | 3.51ms |
| **全开（基线）** | **3.56ms** |

**没有一项与基线有可测差异。** 也就是说块级渲染器的**数量**不是成本来源，
成本在 lezer 解析本身（4.04ms / 3.53ms，与管线其余部分同量级）。
再测一次「表格工具栏改成空 div」也一样（2.60 → 2.50ms，无差异）。

结论对「要不要做局部重建装饰器」是决定性的：**先把渲染器裁掉再优化没有意义**。

### 两个「凭直觉加的优化」实测无效，已撤

- 给 `findSizedImages` 加「段落里没有 `=` 就跳过」的预筛：
  4000 行 2.60 → 2.56ms，**无可测收益**，已撤掉。
- 把表格工具栏换成空 div 再测：2.60 → 2.50ms，**无可测收益**，
  说明语料里的表格数量不足以让工具栏的 DOM 构造显现出来。
  （若一份文档里有几百张表，结论可能不同——但那是另一组测量，不该提前优化。）

留在这里是为了让下一个人不必再走一遍。

### 为什么**没有**做「装饰器按可见区缓存」

- 收益有限：裁剪到视口能省的那部分，**远小于** lezer 解析本身占的
  （上面那张分项表：解析 4.04ms vs 管线其余 3.21ms，且解析在增量路径下也降不下来）
- 代价明确：不可见区域不生成装饰器 → 滚动进视野时**标记会闪现**，
  这是明显的体验倒退。
- 收益来源判断错误：装饰器数量主要影响**构建**成本，不影响**渲染**成本——
  CM6 只为视口内的行建 DOM，视口外没有 DOM 要更新。

### 「局部重建装饰器」也暂缓（同理）

增量路径 4000 行 p95 = 3.53ms，占 16ms 交互预算的 22%。
要优化得先动 lezer 解析（增量路径里最大的单点），而不是装饰器构建。

### 基准脚本曾经跑不了（2026-10-23 修）

语料里出现图片后，`buildLivePreviewDecorations` 会构造真实 DOM
（图片 widget / 表格工具栏 / 代码高亮块），Node 里没有 `document`，
`scripts/bench-decorations.ts` 直接崩——于是上面这批数字一度**无法复现**。
现在有 `scripts/dom-stub.ts`：最小 stub（`createElement` / `dataset` /
`classList` / `style` / `appendChild`），幂等安装，遇到未实现的能力直接抛错，
不会静悄悄返回 undefined 造成一轮「基准数据不对」的排查。

### 测量台

`perf.html` + `src/dev/perf-harness.ts`：真实浏览器里测「击键 → 绘制完成」的延迟。
`perf.html` 不在 vite build 的默认入口列表里，**不会进生产包**。

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

## 剪贴板：复制为 HTML / 粘贴为纯文本（2026-10-21）

Typora 的复制行为是**同时写两种 MIME**：
- `text/plain` → Markdown 源码（粘到别的 Markdown 编辑器是对的）
- `text/html` → 渲染后的 HTML（粘到 Word / 邮件是富文本）

实现分两条路：

| 触发方式 | 机制 | 能拿到 HTML 吗 |
| --- | --- | --- |
| 按 ⌘C | 接管 CM6 的 `copy` 事件 | 渲染器就绪时才有（见下） |
| 菜单「复制为 HTML」 | 直接写系统剪贴板（`tauri-plugin-clipboard-manager`） | **总是有**（异步等渲染器） |

**copy 事件必须是同步的**——浏览器在事件处理结束的那一刻就读剪贴板数据，
不能 await。所以 `remark-rehype`（约 180 KB）只能**按需加载**
（`src/parser/html-loader.ts`）：应用启动后立刻 `primeHtmlRenderer()` 预热，
之后同步调用点就能直接拿到结果。极少数「刚启动就立刻复制」会退化成只有纯文本。

**Inkstone 内部复制粘贴的无损通道**：额外写一个自定义 MIME
`text/x-inkstone-markdown`，粘贴时优先用它。
否则剪贴板里的 `text/html`（渲染后的 HTML）会被转回 Markdown，
遇到表格、嵌套列表、代码块就会丢结构。
自定义 MIME 跨应用会被系统丢弃——这正是我们要的，
对外的语义交给 `text/plain` 与 `text/html`。

**「粘贴为纯文本」是一次性标志**：菜单动作置位，下一次 paste 只取 `text/plain`，
用完即焚。

### 粘贴来源判定优先级

| 优先级 | 剪贴板内容 | 处理 |
| --- | --- | --- |
| 1 | `text/x-inkstone-markdown` | 原样插入，逐字节无损 |
| 2 | 「粘贴为纯文本」标志已置位 | 只取 `text/plain`，忽略 HTML |
| 3 | 只有纯文本 | 原样插入 |
| 4 | 纯文本本身就是 Markdown | 原样保留 |
| 5 | 网页 / Word 的富文本 | `text/html` → Markdown（turndown + 样式净化）|

## 质量闸门（CI 强制，提交前本地也要跑）

```bash
pnpm typecheck      # tsc --noEmit
pnpm lint           # eslint，0 warning 容忍
pnpm format:check   # prettier
pnpm test           # vitest：round-trip + 组件交互
pnpm i18n:check     # 模块作用域里不许调 t()（导入时定型，语言切换就不生效）
pnpm bundle:check   # 打包元数据必须能被 Windows-1252 编码（否则 MSI 打包挂）
pnpm licenses:check # 依赖许可证白名单
cd src-tauri && cargo fmt --check && cargo clippy --all-targets
```

### 闸门不是越多越好，是「每个都拦住过一类真 bug」

九道闸门，每一道背后都有一次实打实的翻车：

| 闸门 | 拦住过什么 |
|---|---|
| `typecheck` | 类型不一致（例行） |
| `lint` | `react-hooks/set-state-in-effect` 等规则违反 |
| `format:check` | 格式漂移 |
| `test` | 功能回归；round-trip 保证 Live Preview 不腐蚀用户文件 |
| `i18n:check` | 模块常量在定义处调 `t()` → 语言切换后那部分永远停在旧语言 |
| `bundle:check` | 中文进 MSI → Windows 打包挂在 WiX（原来要等七八分钟才知道） |
| `licenses:check` | 依赖许可证进白名单外 |
| `gen:shortcuts --check` | 改了注册表忘了重新生成 `shortcuts.json` → 菜单加速键与前端不一致 |
| `cargo fmt` / `clippy` | Rust 侧格式与 lint |

### round-trip 测试是本项目最重要的质量基建

`tests/corpus/` 里每个语料文件都要满足：

1. `解析 → 序列化 → 再解析` 后 **mdast 结构等价**（忽略 position）
2. 序列化结果仍是合法 Markdown
3. **往返两次后收敛**（幂等）

没有这条约束，Live Preview 会慢慢腐蚀用户文件。

语料库目前 13 份（`tests/corpus/`），除了原有的基础语法、表格任务、数学图表、脚注 HTML、边界情况，
还覆盖了中文技术写作、各类链接与图片、引用与嵌套列表、转义与 HTML 实体、空白敏感内容、
混合块结构、Typora 扩展语法，以及一份 470 行的长文档（兼作性能压测样本）。

另有两条**语料库自身的护栏**：语料数量不得少于 10 份；所有语料合起来必须覆盖
22 种关键 mdast 节点类型（缺一种就说明语料有缺口）。

### 依赖许可证白名单

只允许 MIT / Apache-2.0 / BSD / ISC / CC0 / Unlicense / Python-2.0 / Zlib / MPL-2.0。
**禁止** GPL / AGPL / SSPL / EUPL / 商业闭源。

pandoc 是 GPL-2.0，但**以独立进程调用、不链接**，与 Typora 的做法一致，不构成传染。
若将来要彻底规避，可换纯 Rust 的 comrak 做 AST 转换。

## M3：文件管理（2026-10-23）

### 脏标记必须以「磁盘上的内容」为准

原来比的是「**上一次**的内容」——用户敲了字又删回去（内容回到磁盘上的样子），
脏标记还是 true。于是自动保存会反复触发，而一次保存本可以什么都不写。

现在多存一份 `savedContent`（「我们相信磁盘上此刻是什么」）作为唯一依据，
打开文件 / 另存为 / 保存成功三处都要同步它。

### 落盘期间又改了内容，脏标记不能被清

`saveDocument()` 的 await 还没回来时用户又敲了字，原来无条件把 dirty 清成 false，
等于把「还没保存的新改动」标成已保存——**那等于丢数据**。
现在只有内容没变过才清。

### 自动保存是防抖，崩溃恢复快照是节流

写磁盘用**防抖**（停手 `interval` 毫秒后写一次）：用户正在连着敲的时候反复写盘是白费力气。

写快照用**节流**（最多每 2 秒写一次）：快照的目的就是「随时能捞回来」，
如果也用防抖，用户连续敲十分钟不停手就十分钟没有快照，崩了全丢。

未命名草稿**不自动保存**（没有落盘目标，替用户造文件名是越权），
但**照样写快照**——它恰恰是最需要崩溃恢复的那一种。

### 恢复的判据是「内容不一样」，不是「有快照」

快照内容 == 磁盘内容 → 保存成功过，快照只是残留 → 静默清掉，不打扰用户。
这条判据顺带兜住了「自动保存成功了但快照还没清」的竞态：
那种情况靠「内容相同就静默清掉」收拾掉，不弹假警报。

**不做自动恢复**：自动恢复会替用户决定用旧内容盖掉磁盘上的新版本，
而那可能正是用户想要的。问一句的代价是看一眼弹窗。

### 文件监听为什么是轮询而不是原生 watcher

**硬的理由**：保存用的是**原子替换**（写临时文件 + rename，见 `document::write_text_file`），
每次保存都换掉 inode。原生 watcher 挂在文件上时看到的是「删除 + 新建」而不是「修改」；
挂在父目录上过滤文件名才能接住，但那样就得处理「自己保存触发的 rename」——
而抑制自触发的办法（记时间戳 / 记 inode）本质上都是**竞态**：
抑制窗口里的真实外部修改会被一起吞掉。

**软的理由**：原生 watcher 要引入 `notify` 及其一串传递依赖，
而这个项目对依赖有许可证白名单与包体预算。

轮询比的是**内容**，不是「有没有事件」：自己保存之后磁盘内容 == 我们知道的内容，
自然就不是冲突，没有误报要抑制。代价是检测延迟最多一个轮询间隔（1 秒）。

只监听**当前打开的那一个文件**——别的文件变了不影响正在写的东西，
监听整个笔记库是另一件事。

### 冲突没解决之前，自动保存是停的

否则「保留我的版本」这个选择会被自动保存当场推翻——用户说「我要我的」，
自动保存转头就把磁盘上那份抹了。所以 `externalChange` 为真时自动保存跳过这个文件，
直到用户明确保存（⌘S）或选择「用磁盘版本」。

### 多标签页：换的是整个 EditorState，不是往同一个状态里塞新文档

标签页切换时换的是整个 `EditorState`（`view.setState`），
每页各自保有自己的撤销栈与光标位置。

用 `setValue`（往当前状态里换内容）代替的话，**撤销栈会被清掉**：
用户切回上一页按 ⌘Z 会发现「什么都没得撤」——
那比没有多标签更糟。

投影必须**缓存**：`useSyncExternalStore` 要求快照在没变化时引用相等，
每次现场构造一个新对象会让 React 无限重渲染。

### 空占位页要复用

应用启动时那个空标签页，在打开文件之后不该还留在那儿（多一个空标签页看着像多开了一个文档）。
判断放在**读完文件之后**：读文件是异步的，这期间用户可能已经在那个空页上敲了字，
那时它就不是占位页了。

### 崩溃恢复存的是整个会话

不是一份文本，是**所有标签页 + 当时激活的是哪一页**。
用户开了五个页，崩了之后要能拿回五个，而不是一个——
只存当前页的话，另外四页的未保存内容就凭空消失了，那不是恢复，是部分恢复。

### 滚动定位的时序

「跳到第 N 行」的偏移必须**在切状态之后**才算——偏移是按文档内容算的，
而状态要等 React 跑完 effect 才换。所以偏移先记在 store 里（`pendingScroll`），
由编辑器换完状态之后取走执行。

## M4：导出（2026-10-25）

### 三条路径，不是三条 if-else

导出项注册表（`src/export/registry.ts`）是**格式的唯一清单**，分三种 `kind`：

| kind | 谁产出 | 为什么这样分 |
|---|---|---|
| `html` | 前端自己 | 要内嵌主题 CSS、代码高亮、可选大纲 |
| `pandoc` | pandoc 进程 | 二进制格式（docx/epub/odt）没法在前端造 |
| `pdf` | WebView 打印 | 本机无 LaTeX/wkhtmltopdf（实测全无） |

分类不是为了「以后好扩展」，而是**三者的失败模式完全不同**：
pandoc 没装是「不可用」，PDF 是「弹系统面板」，HTML 是「写文件」。
UI 必须区别对待，不能一律显示成「导出失败」。

### pandoc：独立进程调用，不是链接

pandoc 是 GPL-2.0 的 Haskell 程序，本项目是 MIT——**不能链接或内嵌**，
那会让整个应用变成 GPL 作品。以独立进程调用则合法（调用方不被传染）。
`scripts/check-licenses.mjs` 的 `EXCEPTIONS` 里已有对应条目。

### pandoc 的二进制不经 JS 边界

docx / epub / odt 是 zip 容器。走「Rust → base64 → JS → base64 → Rust」
的话，1 MB 的 docx 会在 IPC 上产生约 2.7 MB 的字符串——纯浪费。

所以命令分两段：前端弹「另存为」拿到路径 → 把 **Markdown 文本**（+ 目标路径）
传给 Rust → Rust 启动 pandoc，**Markdown 从 stdin 灌进去**，pandoc **直接写目标文件**。
二进制一个字节都不穿过 JS 边界。

### pandoc 的 Markdown 扩展要显式对齐

pandoc 默认的 `markdown` 读写器**不含** `$...$` 行内公式（那是 `tex_math_dollars` 扩展）。
本项目的解析层（remark-math）默认开启单 `$`，所以要显式加上：

```
--from=markdown+tex_math_dollars+yaml_metadata_block
```

这正是「解析规则唯一」（红线 3）在跨工具场景下的样子——
同一份内容在编辑器与 pandoc 里必须解析成同样的结构。

### pandoc 的警告必须带回给用户

实测：pandoc 转 docx/odt/epub 时遇到块级公式会警告
「Could not convert TeX math … rendering as TeX」——
也就是说 **Word 里的公式会变成一段 TeX 源码**。

用户打开文件才发现公式不对，却完全不知道原因；而这个信息 pandoc 已经告诉我们了。
所以 `convert_with_pandoc` 返回 `{ warnings }`，UI 如实显示，且**有警告时不自动关面板**。

### 导出侧的代码高亮要单独做

编辑器里的代码高亮走 CodeMirror 装饰器（`src/editor/render/code-block.ts`），
而 `markdownToHtml` 走 remark-rehype，**不做**高亮——导出的 HTML 里代码块是纯文本。

导出侧用 `highlightCodeBlocks()` 补上。它复用编辑器**同一套** highlight.js
（`highlightCode` / `resolveLanguage`），所以两边颜色一致。

**坑：HTML 实体要解码两轮。**
`remark-rehype` 把代码放进 hast 的 text 节点，序列化时 `&` 会被转义成 `&amp;`，
于是 `<div>` 变成 `&amp;#x3C;div&amp;gt;`。只解一轮拿到的是 `&#x3C;`（还是实体），
highlight.js 会把它当普通字符，输出 `&amp;#x3C;`——页面上显示成一层实体套一层。
必须解到**原文**为止（先命名实体、再数字实体）。

### 导出的 HTML 缺 KaTeX CSS = 公式显示成两份

KaTeX 输出的 HTML 里同时有视觉版（`.katex-html`）与给读屏软件用的
MathML 副本（`.katex-mathml`）。靠 `.katex-mathml { position: absolute }` 把后者藏起来。

少了这条规则，导出的文件里每条公式都显示成「KaTeX 渲染结果 + 一串裸 LaTeX」两份——
读者完全无法使用。

而 KaTeX 的 CSS 是跟着 `math-render` chunk **动态注入**的（不是 `?raw` 静态导入）。
所以导出前必须 `await ensureMathRenderer()`，保证那张样式表已经在 DOM 里。

**vitest 里 `?raw` 对 CSS 不生效**（vitest 对 CSS 资源的处理返回空模块）。
于是 `katexStylesheet()` 的两条取法在测试里都落空 → 导出的公式错乱 → **测试却通过**。
修法：`tests/setup.ts` 里把 KaTeX 的 CSS 注入 DOM，让测试环境与真机行为一致。
（`document.styleSheets` 那条兜底路径在 jsdom 里完全可用，已实测。）

### 变量系统只在「导出产物」上替换

变量形如 `${title}`、`${today}`，用在文件名模板与 HTML 的 head/body 追加内容里。

**绝不替换文档正文**——正文是单一真相源（红线 1）。
替换只发生在离开文档之后的字符串上。

未定义的变量**原样保留**（不静默清空）：静默清空会让用户以为变量生效了却查不出哪里错。

### 日期用本地时区，不用 `toISOString()`

`toISOString()` 是 **UTC**。本地时间晚上 8 点会显示成第二天，差一整天。
「今天」在晚上变成明天，是那种很难被报出来的 bug。

### front matter 覆盖导出设置：只开放安全的那几项

`readExportSettingsFromFrontMatter` 默认**关闭**。开启后也只认白名单里的键：

- `export.html.includeOutline`、`export.pdf.paperSize`
- `fileNameTemplate`、`variables`

**不开放** `openFolderAfterExport` / `openFileAfterExport`：
那是「导出完自动打开文件/文件夹」——如果一份来路不明的 .md 能让导出动作
自动打开任意路径，那是个安全洞。

**front matter 只能影响「产出什么」，不能影响「产出之后做什么」。**

未知键一律忽略（front matter 常塞着别的工具的配置：Obsidian 的 tags、Hugo 的 draft）。
校验失败（`paperSize: A3`）也只忽略该字段，不让整个导出失败——
用户不该因为 front matter 里一个笔误就导不出东西。

### YAML 解析用 `yaml` 包，不自己写

`remark-frontmatter` 只把 front matter 当成**原始文本块**放进 mdast（实测节点是
`{ type: "yaml", value: "title: …" }`），不做任何解析。

自己写 YAML 解析器是无底洞（锚点、别名、多行标量、流式映射、类型推断……），
而 front matter 里的内容是**用户写的**，必须由**完整的**解析器保证「写什么都能读出来」。
半个解析器遇上稍复杂的文件就静默丢字段——那比报错更糟。

`yaml` 包是 ISC 许可，在 `scripts/check-licenses.mjs` 的白名单里。

### 文件名清理只有一份实现

文件名可能来自两处（文档标题、文件名模板），两处都要过同一道清理。
所以清理函数住在 `registry.ts`（低层依赖），`service.ts` 反过来 import 它。

清理规则：只保留最后一段（路径分隔符切开）、去控制字符、
Windows 禁止的 `< > : " | ? *` 换 `_`、去前导的点（`.hidden` 是隐藏文件）。

**逐字符处理而不用正则**：正则里的 `\u0000-\u001f` 会触发 eslint 的 `no-control-regex`；
字符码判断没这个问题，顺带 `for...of` 按码点迭代不会把 emoji 拆成两半。

### 浏览器降级：区分「取消」与「没有对话框」

浏览器里没有保存对话框。`pickExportPath` 返回 `null` 有两种含义：

- 浏览器降级模式 → 该走下载路径把内容产出出来
- 用户取消了对话框 → 该停下，什么都不产出

混为一谈的话，浏览器里点导出什么都不会发生，而提示还写着「已取消导出」——
那是在**撒谎**。所以导出流程用 `isBrowserFallback()` 区分两者。

（早先的 bug：`pickExportPath` 在降级模式下触发了一次**空内容**下载，
而 `writeTextFile` 又下载一次——两个文件，第一个是空的。）

### PDF 走系统打印面板

本机没有 LaTeX / wkhtmltopdf / weasyprint / typst / libreoffice（实测全无）。
macOS 的 WKWebView 提供 `printOperation:`，弹出的打印面板里有「PDF → 存储为 PDF」。

流程：生成打印专用 HTML（带 `@page { size: A4 }`）→ 写临时文件 →
开临时 WebView 窗口加载它 → 页面加载完后调 `print()`。

- **用临时文件而不是 data: URL**：data URL 有长度限制（WKWebView 约 2 MB），
  带内联 CSS 的文档很容易超过
- **窗口要显示**：打印面板是系统级的，用户仍需看到「要打印的是什么」
- **`@page` 的 size 由设置里的 `pdfPaperSize` 决定**——纸张尺寸是用户选的，不能猜
- **打印版要重设宽度**：屏幕上用的是 46rem 居中窄栏，打印要占满纸张宽度

### grid 容器必须显式声明行，否则内容被裁且滚不动

M4-6 的设置面板里「添加变量」按钮点不动。查下来的根因不是按钮，是**布局**：

`.settings-body` 是 `display: grid`，但只写了 `grid-template-columns`，**没写行**。
隐式行是 `auto` 尺寸，会被 `.settings-content` 的内容撑到 623px——
而面板内容区只有 594px（`.settings-panel` 高度封顶 `min(640px, 88vh)`）。

于是：

- `.settings-content` 自己的 `clientHeight == scrollHeight`（它被行撑到了内容高度），
  `overflow: auto` **永远不出现滚动条**
- 溢出的那部分被 `.settings-panel` 的 `overflow: hidden` 裁掉
- 结果：面板底部的控件（`添加变量`）在**任何窗口尺寸下都点不到**——
  面板高度封顶 640px，而「导出」分组的内容固定需要 669px，跟窗口大小无关

修法是给唯一的行一个确定的高度：

```css
.settings-body {
  grid-template-rows: minmax(0, 1fr);
}
```

**教训**：`.settings-content { overflow: auto }` 本身是**不够**的。
滚动容器要能滚，前提是它的**高度**被外部钉死；否则它会被内容撑高，
于是「有滚动条」这件事永远不会发生，而溢出的内容被祖先的 `overflow: hidden` 静默裁掉。

同款检查：`display: grid` 只写列不写行的地方，
以及 `flex` 子项缺 `min-height: 0` 的地方（`min-height: auto` 会让 flex 子项不肯缩）。

### 原生菜单加速键与 CM6 键位表必须互斥

M4-6 给「导出…」加了 `CmdOrCtrl+E`，但**编辑器里 ⌘E 早就是「行内代码」**（`Mod-e`）。
在 macOS 上原生菜单的加速键由 NSApp 先吃掉，webview 根本收不到这个键——
撞车的后果不是两个功能一起触发，而是**后绑的那个功能彻底失效**。

同一次排查里还发现两处更早的撞车（都让功能变死）：

| 键 | 原生菜单 | 编辑器键位 | 修法 |
|---|---|---|---|
| ⌘E | 导出… | 行内代码 `Mod-e` | 导出改成 **⌘⇧E** |
| ⌘B | 显示/隐藏侧边栏 | 加粗 `Mod-b` | 侧边栏改成 **⌘⌥B** |
| ⌘⇧C | 复制为 Markdown 源码 | 复制为 HTML `Mod-Shift-c` | 复制为 HTML 改成 **⌘⌥C** |

**取舍原则**：编辑器内的高频操作（加粗 / 斜体 / 行内代码）守住 ⌘B / ⌘I / ⌘E——
它们是跨编辑器通用的肌肉记忆；低频操作（侧边栏开关、导出、复制变体）让路，
并用 ⌥ 或 ⇧ 区分开。

**规则**：往原生菜单加加速键前，先把 `src/editor/MarkdownEditor.ts` 的 keymap
和 `src-tauri/src/menu.rs` 的 accelerator 列在一起对一遍，两边不得重名。
（`⌘F` / `⌘⇧V` 这类**两边做同一件事**的不算冲突，是冗余入口。）

### 源码里不要写裸控制字节

`tests/export-service.test.ts` 里一度写着 `sanitizeFileName("a<NUL>b<0x1F>c")`——
用的是**裸字节**而不是转义写法。后果不是测试失败，而是：

- `file` 把它判成 `data`，`read` 工具拒绝打开
- git 把它当**二进制**存，diff 全变成 `Bin 8464 -> 8465 bytes`，改动不可读

正确写法是转义：`"a\0b\x1fc"`。语义完全一样，文件保持纯文本。

写文件时注意：Python 的 `"\u0000"` 写出去就是**裸 NUL 字节**，不是 `\u0000` 这六个字符。
要写转义序列，字符串本身得是 `r"..."` 或 `"\\0"`。

## M4-7：导出项可自定义（2026-10-25）

### 格式 / 设置 / 解析结果，三层要分开

新增的「导出项自定义」有三样东西，混在一起就会分叉：

| 层 | 住在哪 | 性质 |
|---|---|---|
| **格式** | `src/export/registry.ts` | 应用认识的全部输出格式（内置 9 种 + 可额外添加的 pandoc 12 种） |
| **设置** | `settings.export.items`（`ExportItemSetting[]`） | 用户填的，可能是空的，可能是半个 |
| **解析结果** | `src/export/items.ts` 的 `ResolvedExportItem` | 一定能用的——有格式、有显示名、有快捷键 |

**上层（导出面板、设置面板、导出服务）只认解析结果**，不直接读设置。
理由很直接：如果导出面板读设置、导出服务读注册表，那么「设置里写了什么」
和「实际能用什么」就会分叉——用户移除了某一项，面板不显示了，
但快捷键还能把它导出来。

### 设置列表为空 = 没有自定义；非空 = 权威有序列表

- **空列表** → 用内置默认（9 种内置项，按注册表顺序，全部可见）
- **非空列表** → 它就是**权威的有序列表**，顺序 = 面板里的显示顺序

「非空即权威」这条规则有个容易忽略的推论：**所有写操作必须先「物化」成完整列表**
（`materializeExportItems`）。否则用户只是改了一个名字，
设置文件里也会多出一堆无关条目；更糟的是，用户删了一行，
下次「改个名字」就把它复活了。

### 移除是 visible:false，不是从列表里删掉

删掉条目的话，用户就再也看不到「我原来有这一项」，
也没法把它挪回原来的位置——只能整个恢复默认，把其他自定义一起冲掉。
留着条目、只标记 `visible: false`，信息不丢：设置面板把不可见的项
列进「已移除的格式」折叠区，用户想恢复时找得到。

导出服务也要认这个语义：`visible === false` 的项被触发时
返回「该导出项已被移除」，而不是当作未知格式。

### 指向不存在格式的 id 要跳过，不要抛错

设置文件可能来自旧版本（格式被改名、被删掉）。
一个失效的 id 不该让整个应用起不来——**跳过**它。
同理，同一个 id 出现两次时取第一个，否则面板里会重复出现两行。

### 没被用户提及的内置项，补在末尾且可见

用户自定义列表之后，版本升级新增了内置格式（比如 M5 加了「导出为 PNG」）。
如果严格按用户列表来，老用户会**莫名其妙少一种格式**。
所以未被提及的内置项按默认顺序补在末尾。

### 快捷键的规范形式用 Mod，顺序自己定死

`parseShortcut` 把用户的各种写法（`⌘⇧1` / `Cmd+Shift+1` / `Mod-Shift-1` / `F5`）
统一成一种形式。两条规则：

1. **用 `Mod` 不用 `Meta`**：`Mod` 在 macOS 上是 ⌘、其它平台是 Ctrl，
   跟着平台走，同一份设置文件在三个平台上都成立。
2. **修饰符顺序固定为 `Mod-Shift-Alt-Ctrl`**：CM6 自己会重新规范化
   （对它来说顺序无所谓），但**我们**要用字符串比较来判断冲突，
   顺序必须固定，否则 `Mod-Shift-1` 和 `Shift-Mod-1` 会被当成两个键。

字母键统一转小写（CM6 的 `w3c-keyname` 约定：`event.key` 对字母本来就是小写）。
`Mod-Shift-a` 才和用户实际按下时匹配得上。

### 保留键一律拒绝绑定，原生菜单的加速键也要算进去

`RESERVED_SHORTCUTS` 有 20 条，除了 CM6 的键位，还包括**原生菜单的加速键**。
原因在 M4-6 已经踩过一次：那些键由 NSApp 处理，webview 根本收不到——
绑上去**不会生效**，也不会报错，就是静默失灵。
所以必须在设置面板里提前挡掉，并告诉用户「已被「保存」占用」。

冲突检查分两层：先查别的导出项占了没有（→ 「已被其他导出项占用」），
再查保留键（→ 「已被「加粗」占用」）。

### 快捷键输入不能边打边规范化

用户刚敲下「⌘」，规范化就把它变成「Mod-」——如果立刻写回受控输入框，
光标后面的内容会被顶掉，用户根本没法正常输入。

做法：**保留草稿，失焦才解析提交**。
解析失败或冲突时显示原因，但**不覆盖**用户已经绑定的值——
草稿和已提交值是两份东西。

### 意图总线改成判别联合

「导出指定格式」要带参数（导的是哪个格式），裸字符串装不下。
`Intent` 从 `string` 改成带 `type` 字段的对象：

```ts
export type Intent =
  | { type: "view.live" }
  | { type: "file.export"; formatId?: string };
```

TypeScript 能按 `type` 收窄出参数，命令表和 React 两侧都不会写错。

### 导出的执行上移到 App，导出面板退化成受控组件

原来是「面板自己执行导出」。改成 App 统一执行，有两个原因：

1. **快捷键触发的导出不经过面板**。用户给某个导出项绑了 ⌘⇧1，
   按下去就该直接导出，不能先弹个面板让用户再点一次。
   执行逻辑只有一处，两条路径的行为才不会分叉。
2. 面板里自动执行导出需要在 effect 里跑，
   而 effect 里同步 setState 会被 `react-hooks/set-state-in-effect` 拦下。
   放在事件处理器（意图回调 / 按钮点击）里，规则自然满足——
   靠重构满足规则，不靠 disable 注释。

于是 `ExportPanel` 变成受控组件：props 是 `busy` / `result` / `onRun`，
自己只负责渲染。

### CM6 动态 keymap 用 Compartment，且放在主 keymap 之前

和自动配对（`autoPairBox`）同一套模式：一个 Compartment，
`setExportShortcuts(bindings)` 时 `reconfigure` 换掉整组 keymap，
不重建编辑器、不丢撤销历史。

**放在主 keymap 之前**：用户显式绑定的键要压过内置键位——
他按下那个键时的意图是「导出」，不是「加粗」。

**导出项快捷键只在编辑器有焦点时生效**（CM6 的 keymap 是编辑器作用域的）。
原生菜单的加速键是全局的，两者不是一回事，别在文档里混着说。

### 下拉复位要用 key，不要写 event.target.value = ""

「恢复默认快捷键」那个下拉框，React 里不能靠 `event.target.value = ""` 复位——
那是绕过 React 直接写受控元素的值，React 下次渲染会把它打回去。
正确做法是给 `<select>` 加 `key`，让 React 重建这个元素。

## M3-2 收尾：AI 面板（2026-10-25）

### ⚠️ `view.setState()` 不触发 updateListener —— 写回必须走 `dispatch`

这是本轮最值钱的教训，差点让整个 AI 功能变成「看起来能用、实际不落盘」。

CM6 的 `EditorView.setState(next)` 干的事是：**拆掉全部 view plugin、重建整个 view**。
它**不会**触发 `updateListener`。而我们的 `onChange` 是挂在 `updateListener` 上的，
于是：

- `onChange` 不响 → 文档 store 不知道内容变了 → **脏标记不亮、自动保存不存**
- 所有 view plugin 被拆了重建 → 装饰器状态全丢
- 看起来却「一切正常」：编辑器里文本确实变了

所以写回**只能**走 `view.dispatch(spec)`：它是一次**普通事务**，
进撤销栈（⌘Z 能还原）、触发 `onChange`、能被搜索与导出看见。

由此，`acceptWriteback` 的返回值从「新状态」改成 **`TransactionSpec`**：
它只负责「算出要改什么」，**落地交给调用方 dispatch**。
（返回新状态的话，调用方几乎一定会顺手用 `setState` —— 而那正是错的。）

> 同一份代码里，`EditorSurface` 切标签页时用 `setState` 是**对的**：
> 那里确实要整体换一份状态（换状态是意图，不是编辑）。
> 区别在于：换状态用 `setState`，**编辑**用 `dispatch`。

### 写回前要核对原文

模型还在流式输出的时候，用户可能已经在改同一段文字了。
这时按开始时的偏移去替换，会**覆盖掉用户刚写的东西**。

做法：跑动作时记下切片范围与**当时的原文**；接受前比一下，
对不上就拒绝并说明原因（「原文在等待期间被改过了，请重新跑一次」）。

`PendingWriteback.original` 这个字段就是为它准备的——
不是用来做前后对比展示的，是用来做**安全检查**的。

### 编辑器的持有权留在 EditorSurface，AI 通过注册表访问

编辑器实例由 `EditorSurface` 创建并持有（多标签页各自保留撤销栈），
而 AI 面板想做**应用级浮层**。如果两边各持一份，就会出现两条持有路径，
切标签页时可能指向不同状态——「AI 改的是你看到的那个文档」这条不变量就破了。

所以：`EditorSurface` 把自己注册到 `src/ai/editor-bridge.ts` 的模块级注册表，
面板通过 `getAiEditorBridge()` 取。注册表里永远只有**当前活动的那一个**。

### thinking 模型有「推理期」，预览会长时间空白

实测本机 Ollama 的 `qwen3.8:27b-mlx`：一次改写请求 202 帧，
其中 **190 帧是推理帧、只有 10 帧带正文**。推理帧走的是 `delta.reasoning`，
我们的 `decodeDelta` 只取 `delta.content`，所以它们被正确地丢掉了——
但代价是**正文出现前有很长一段空白**。

对策：面板在 `output` 为空时显示「模型正在思考「润色」…」，
有内容后改成「正在生成…」。差别只有一行，但它决定了用户会不会以为卡死了。

### 设置里的参数不接到请求上，就是摆设

`settings.ai.maxOutputTokens` 与 `settings.ai.temperature` 之前**从来没进过请求体**——
`buildRewriteRequest` 只返回 `{system, messages}`。设置面板上两个控件摆在那儿，
改了对上游毫无影响。

现在在 `panel-store` 的 `buildRequest` 里统一补上。provider 那边会按能力位
决定发不发 `temperature`——模型不支持时根本不出现在请求体里（而不是发了让上游 400）。

### 本地端点不该强要密钥

Ollama / LM Studio / vLLM **不需要 API Key**。之前 `openai-compatible` 的
`auth()` 一律返回 `bearer`，于是 Rust 侧读不到密钥就直接报「未配置该端点的密钥」——
用户只好填一个占位值，而上游根本不认它。

改法：`billing === "local-free"` 的端点 `auth` 返回 `kind: "none"`。
密钥是有没有的问题，不是「填不填」的问题。

### 浏览器降级：SSE 解码器要有一份 TS 版

正式应用走 Rust 的 reqwest（D15：绕开 CORS + 密钥不进前端进程）。
但**浏览器开发模式**没有 Tauri 运行时，`invoke` 用不了。

本机推理服务默认带 CORS 头（实测 Ollama 回 `Access-Control-Allow-Origin`），
所以浏览器里能直连本机模型——这让「面板 → 模型 → 预览 → 写回」
整条链路在浏览器里也是通的，验收不再需要真机 + 密钥。

代价是要在前端有一份 SSE 解码器（`src/ai/sse.ts`）。
**两份实现（Rust / TS）必须按同一份规格写，并且用同一批用例**：
行尾归一化（`\r\n` / `\n` / `\r`）、按空行切帧、`data:` 行用 `\n` 连起来、
心跳与 `[DONE]` 丢掉、流结束时冲刷残余。改一边就要看另一边。

浏览器降级**只支持本地端点**：云端端点会被 CORS 挡住，
而且密钥在系统钥匙串里、前端拿不到明文——所以那边直接报错，不假装能用。

### 按钮文案要说清楚它会动哪一块

一开始写回按钮的文案是「替换选区」。但没有选区时，AI 切的是
光标所在的那**一段**或那一**节**——写「替换选区」是骗人的，
用户不敢点。

现在按上下文的种类给不同文案（替换选区 / 替换当前段落 / 替换当前章节 / 替换整篇文档）。
上下文的种类是 `ResolvedContext` 的一部分，面板直接显示它。

## M5-2：快捷键映射层（2026-10-25）

### 快捷键只有一个真相源

快捷键原本散在**五处**：

| 位置 | 形式 | 谁在用 |
|---|---|---|
| `src/editor/MarkdownEditor.ts` 的 keymap | `Mod-Shift-e` | 编辑器内（CM6） |
| `src-tauri/src/menu.rs` | `CmdOrCtrl+Shift+E` | 原生菜单（全局） |
| `src/export/items.ts` 的 `RESERVED_SHORTCUTS` | `Mod-Shift-e` | 冲突检查 |
| `src/editor/commands/builtin.ts` 的 `shortcut` | `⌘⇧E` | 命令面板显示 |
| `src/ipc/menu.ts` 的 `MenuAction` | action id | 菜单事件桥接 |

五处手抄同一批键位，于是 M4-6 出了那个 bug：
**⌘E 被原生菜单和 CM6 同时占用，NSApp 先吃掉按键，CM6 那个功能彻底失效**——
不是两个功能一起触发，是后绑的那个**静默失灵**。

现在 `src/shortcuts.ts` 是唯一真相源：

- `KEYS` 常量 → CM6 keymap、命令表共用
- `SHORTCUTS` 注册表 → 冲突检查、命令面板显示、菜单加速键，全部派生
- `MENU_ACTION_IDS` → 前端 `MenuAction` 类型与监听列表都从它派生
  （之前那个文件里**同一个清单写了两遍**：联合类型 + 数组）
- `scripts/gen-shortcuts.ts` → 生成 `src-tauri/shortcuts.json`，
  Rust 侧读它，CI 用 `pnpm gen:shortcuts -- --check` 校验没过期

### 三类作用域：editor / app / both

| scope | 谁处理按键 | 冲突后果 |
|---|---|---|
| `editor` | CM6（编辑器有焦点时） | 同一键绑两个功能 → 前面的赢 |
| `app` | 原生菜单（全局） | 同上，但 **NSApp 先吃**，webview 收不到 |
| `both` | 两边都绑（**同一个功能**） | 不是冲突——是同一个功能的两个入口 |

冲突检查必须**跨作用域**：`app` 的键会吃掉 `editor` 的同名键，
各查各的就会漏掉 M4-6 那类撞车。
而 `both` 不是冲突——同一个功能在两层各有一个入口是正常的
（原生菜单全局可用，CM6 那份是浏览器开发模式下的唯一入口）。

### 平台感知显示：Windows 上不能给用户显示 ⌘

`formatShortcut(key, platform)`：macOS 用符号（顺序按苹果惯例 ⌃⌥⇧⌘），
Windows / Linux 用单词（`Ctrl+Shift+Alt`）。

之前只有 macOS 一种写法，于是 Windows 上会把 ⌘ 显示给用户——
**那是个不存在的键**。

`currentPlatform()` 用 `navigator.userAgent` 判断，不引 `@tauri-apps/plugin-os`：
一个依赖都不加就能覆盖三种平台，而 OS 插件是整个项目里唯一的依赖增量。

### Rust 侧一个加速键字符串都不写死

`src-tauri/src/menu.rs` 现在只有动作 id，加速键从 `shortcuts::accelerator(id)` 取。
清单里没有的菜单项（比如「Markdown 语法参考」）就没有加速键。

菜单项 id 要是没登记在清单里，启动时会打一行警告——
因为那种情况下前端 `initMenuBridge` 根本不会监听它，
**点了没有任何反应，也不会有报错能指到这里**。

### 实测发现的两个静默失效（都靠读源码发现）

**一、替换的 ⌘H 从来没生效过。**
muda 的预定义项 `Hide` 就是 `CmdOrCtrl+KeyH`（`predefined.rs:655`），
而我们的「替换…」也用 ⌘H。两项撞车时 AppKit 取**菜单树里靠前**的那个——
应用菜单在前，于是「隐藏」赢，「替换」的 ⌘H 静默失效。
改成 `Ctrl-h`（mac 上 ⌃H，与 macOS 文本编辑器的「替换全部」一致；
Windows / Linux 上仍是 Ctrl+H，与原来相同）。

**二、「放大」的 `CmdOrCtrl+Plus` 解析失败，被静默吞掉。**
muda 的**物理键表**（`Code`）里没有 `Plus`（只有 `NumpadAdd`），
而 Tauri 建菜单时用的是 `.parse().ok()`——
**解析失败不报错，只是那个菜单项没有加速键**。
旧代码里「放大」正是这么写的：菜单显示得好好的，按 ⌘+ 什么都不会发生。
改用 `Equal`（⌘=），它能解析。

这两条都有测试钉住（`src-tauri/src/shortcuts.rs`）：
「每个加速键都能被 muda 解析」+「muda 的物理键表里没有加号键」。
生成器那边也拦：`CmdOrCtrl+H/Q/W/M`（macOS 系统保留键）直接报错。

### 减号需要别名

`-` 既是分隔符又是键名，分隔符优先级更高，所以减号没法直接写进规范形式。
`KEY_ALIASES` 里只有 `Minus` 一条：显示成 `-`，Tauri 加速键用 `Minus`。

## M5-3：界面国际化（2026-10-25）

手写轻量方案，**零依赖**（不引 i18next / lingui / react-intl）。
理由：需求只是「界面文案能换语言」，引入一整套 i18n 框架要付出
运行时体积、配置层、编译期宏三笔成本，换来的能力（复数规则、
日期/数字格式化、RTL）这个项目一条都用不上。

### 为什么用「简体中文原文」当 key

四百多条界面文案如果用语义化 key（`toolbar.save`），就得先给每一条起名字、
再维护一张「名字 ↔ 文案」的映射——**抽象与翻译两件事叠在一起**，
漏一条就是界面上一处硬编码，而且漏了**不报错**，只是那儿显示成 `toolbar.save`。

用原文当 key：

- 原文留在代码里，翻译表能一眼对照，**漏译一眼看得出**
- 不用给四百多条文案起名字（起名字本身就会出错）
- 缺翻译时**回退到中文原文**——界面显示中文，
  而不是显示一个用户看不懂的 key

代价：中文原文改了，key 就跟着变（翻译会失效）。
缓解办法是缺译时 `console.warn`，开发期立刻能发现。

### 简体不建字典文件

`src/i18n/locales/` 下只有 `en.ts` 与 `zh-TW.ts`。
简体**原文即译文**，所以它没有字典文件——
这不是偷懒：简体是源语言，多一份字典就多一处可能不同步的地方。

### 模块常量保留原文，在渲染点翻译

```ts
// 模块常量：保留中文原文（它就是翻译表的 key）
const LABELS = [{ id: "save", label: "保存" }];
// 渲染时：t(LABELS[0].label)
```

**不要在定义处翻译**——那会在导入时定型，语言改了也不跟着变。
所以命令表的 `label`、设置项的 `label`、主题名等模块常量都保留中文原文。

### 语言存在哪

设置里的 `general.language`（`src/settings/schema.ts` 早就定义好了，
但一直**没有接到任何东西**——下拉框能选，选了不生效）。
i18n 模块不自己存一份，它读的就是设置 store，
所以「设置面板改语言 → 界面立刻变」不需要任何同步代码。

响应式做法：`App` 里 `useLocale()` 订阅一次 → 语言一变整棵树重渲染 →
渲染期调用的 `t()` 自然拿到新语言。项目里没有 `React.memo`，这条可行。

### 占位符原样保留

`自动保存失败：{error}` 译成 `Autosave failed: {error}`——
**错误信息本身不翻译**，因为那是运行时的事实（文件名、报错原文），不是界面文案。

### 原生菜单在系统控件上，前端 `t()` 管不到

macOS 的菜单栏是 AppKit 控件，文字不经过 webview。
所以 Rust 侧另有一张 22 行菜单文案表（简 / 繁 / 英），
前端通过 `set_locale` 命令通知 Rust 重建菜单
（`AppHandle::set_menu`）。

### `tParts()`：句子里的某个值要单独加粗

恢复对话框里页数要加粗（`<strong>{count}</strong>`）。
如果拼字符串，数字的位置就写死在中文语序里了，英文把数字放到句首就拆错。

`tParts(text, values, emphasis)` 拆的是**译文**：

| | 原文 | 拆出的三段 |
|---|---|---|
| 中文 | `有 {count} 个标签页在 {time} 还有没保存的版本。` | 前=`有 `，值=`3`，后=` 个标签页在 10:30 …` |
| 英文 | `{count} tabs still have unsaved versions from {time}.` | 前=``，值=`3`，后=` tabs still have…` |

### 消歧：同一个中文原文在不同语境里意思不同

`关闭` 既是「关掉」也是「不启用」；`编辑` 既是分区名也是动作。
一个 key 只能有一个译文，所以要挑一个地方改：

| 原文 | 改后 | 原因 |
|---|---|---|
| `关闭` | `不配对` | 自动配对的第三档不是「关掉」，是「只不配对括号」 |
| `编辑`（设置分区） | `编辑器` | 与「编辑」这个动作区分 |
| `文件` | 统一译作 `Files` | 英文里 Files / Documents 含义不同，别混 |

### 有意不翻的

AI 提示词（`src/ai/actions.ts` 的 prompt、设置里的 system prompt）、
样例数据（笔记库）、文档占位内容、emoji 别名与数据、搜索关键词、`src/dev/**`。

### ⚠️ 实测发现的五个静默失效

这一层最大的风险不是「翻译得不好」，而是**漏了还不报错**。
回退逻辑是对的（缺译 → 显示中文原文），所以漏译在界面上
只是「那一处没翻」，开发期根本不会有人发现。

**一、两份字典的键集漂移（最严重的一个）。**

`zh-TW.ts` 当初是用 358 条的采集集生成的，
之后 `en.ts` 补到了 415 条——**两份字典的键集就这么悄悄漂移了**，
繁体界面有 50 多个位置露着简体。没有任何报错。

**二、拼接出来的文案永远对不上字典。**

`src/ai/endpoints.ts` 的 MiniMax endpoint note 是三段字面量拼的：

```ts
note:
  "海外账户用 api.minimax.io，中国大陆账户必须改成 api.minimaxi.com（多一个 i）。" +
  "按量 API Key 与 Token Plan 订阅 Key 用**同一个端点**，只是计费到不同账户资源，" +
  "两者不能互换。Anthropic 兼容协议（anthropic 子路径）可解锁 interleaved thinking。",
```

字典里登记的却是**后两段**（少了第一句）——
运行时拼出来的是完整三句，跟 key 对不上，
于是这条 note 在英文/繁体下**一直是中文**。

**三、残留键。**

`HTML 追加内容（<body> 末尾）`（代码里用的是 `&lt;` 转义版）、
`上传中`（整个 `src/` 里都没有这个字符串）——
都是早期采集时留下的陈旧条目。

**四、模块常量在定义处翻译 → 导入时定型。**

`src/views/Sidebar.tsx` 原来这么写：

```tsx
const PANELS = [
  { id: "outline", label: t("大纲") },   // ← 模块顶层，导入时求值
  ...
];
{/* 渲染时 */}
{t(panel.label)}                           // ← 再查一次，已经是英文了
```

模块第一次被加载时是什么语言，`label` 就永远是那个语言。
实际表现是：应用在英文界面下启动过之后，
**侧边栏三个页签在任何语言下都显示英文**（Outline / Files / Search）。

这个 bug 的恶劣之处在于**它跟导入时机绑定**：
单元测试跑起来时语言是简体，于是模块里定的是中文，测试全绿；
只有真机在别的语言下启动过才暴露。

**五、插值漏译。**

`src/views/EditorSurface.tsx` 的工具栏按钮：

```tsx
title={t("显示策略：{mode}（点击切换）", { mode: modeLabel })}
```

而 `modeLabel` 是 `MARKER_DISPLAY_MODES[i].label`——**中文原文**
（它就是翻译表的 key），没先 `t()` 就插进去了。
表现是：按钮正文是英文，鼠标悬停的提示里夹着一句中文。

字典层测试全绿（因为字典里确实有那条 key），
只有**真正渲染出来**才看得见。

### 四道测试闸门

| 闸门 | 守什么 | 位置 |
|---|---|---|
| `tests/i18n.test.ts` | 两份字典键集一致 / `t()` 字面量都在字典 / 无陈旧键 / **拼接链整串在字典** / 繁体无简体残留 / 占位符集合一致 | 字典层 |
| `tests/i18n-ui.test.tsx` | **把 App 渲染出来**：英文界面不许出现汉字；繁体界面不许出现简体；繁体界面不许出现与英文完全相同的句子 | 界面层 |
| `scripts/check-i18n-scope.ts` | **模块作用域里不许调 `t()`**（定义处翻译 = 导入时定型） | 静态 |
| `pnpm i18n:check` | 上一条的命令行入口，已接进 CI | CI |

界面层那两条的实现要点：
- 要**连属性一起查**（`title` / `aria-label` / `placeholder` / `alt`）——
  光看 `textContent` 的话，藏在 `title` 里的中文根本不在文本里
- 「繁体不许出现与英文相同的句子」这条抓的是「**该翻没翻**」：
  英文界面上看不出问题，只有切到繁体才发现那句话没变

静态那条用 TypeScript 的语法树判断「这个 `t()` 在不在函数里」——
正则分不清模块顶层的对象字面量和函数体里的对象字面量。

## M5-4：检查更新（最简形态）（2026-10-25）

### 只做到「打开下载页」

自动更新听起来是个 feature，实际上是一整套发布基础设施：
发布签名密钥、增量包、跨平台安装器替换逻辑、失败回滚。
而这个项目**连第一个正式版本都还没发**——
现在做那些，等于给一个还不存在的发布流程写适配层。

所以最简形态：查 GitHub Releases → 告诉用户 → 给一个下载页链接。

### 分工：Rust 取数据，TypeScript 比版本

Rust 侧（`src-tauri/src/update.rs`）只做一次 HTTP GET，
只取 `tag_name` / `html_url` / `body` 三个字段。

**版本比较放在 TS 那边**（`src/ipc/update.ts` 的 `compareVersions`），
因为它能被 vitest 直接测到——
「1.10.0 比 1.9.0 新」这种坑，字符串比较会**反过来**
（`"1.9" > "1.10"`），正是要靠测试钉住的地方。

### 两条入口，一条执行路径

- 原生菜单「帮助 → 检查更新…」
- 命令面板「应用 → 检查更新…」

菜单动作走 `onMenuAction("check-update")`，
命令面板走意图总线 `app.check-update`，
两条都落到 App 里的 `runUpdateCheck()`。

### 浏览器里也能用

`pnpm dev` 的浏览器模式没有 Tauri 运行时，
这时直接 fetch GitHub 的公开 API（它带 `Access-Control-Allow-Origin: *`），
所以这个对话框在浏览器里也能真跑起来验收，而不是只能画个壳。

### 顺手修好的一个死菜单项

「项目主页」之前是**注册了但没人处理**的菜单项——点了没反应。
`MENU_ACTION_IDS` 里有它，前端 `initMenuBridge` 也在监听它，
但 `App.tsx` 里没有对应的 `onMenuAction`。

M5-2 的 `action()` 只检查「id 在不在清单里」，
**管不到「有没有人真的处理它」**——这是那套机制的盲区。
这次把它接上了。

「Markdown 语法参考」与「快捷键一览」同样是没接的死菜单项，
已在 M5-5 接上（详见下文 M5-5 段）。

## M5-5：三平台 CI 实跑 + 两个死菜单项（2026-10-26）

### Windows 打包挂在 WiX：MSI 的代码页装不下中文

第一次三平台 CI 实跑，Ubuntu 与 macOS 的打包都过了，**两个 Windows job 全红**：

```
main.wxs(111) : error LGHT0311 : A string was provided with characters
that are not available in the specified database code page '1252'.
```

Rust 侧编译是过的——挂的是**编译之后**的打包环节，
所以一轮 CI 要等七八分钟才看得到结果。

根因不在 Rust，也不在 Tauri 的 bug：**MSI 数据库的代码页是 1252，装不下中文**。
Tauri 的 WiX 模板把 `fileAssociations[].description` 原样写进每个扩展名：

```xml
<ProgId Id="Inkstone.md" Advertise="yes" Description="{{association.description}}">
```

七个扩展名 → 七个 `<ProgId>` → **正好七个 LGHT0311**（行号 111/116/121/126/131/136/141，
间隔 5 行，与模板里 `{{#each ext}}` 的循环结构对得上）。

能改的地方比想象的多：

- `bundle.shortDescription` / `longDescription` **不在** WiX 模板里
  （只在 macOS 的 Info.plist 与 Linux 的 .desktop 出现，那两处是 UTF-8），
  所以它们**可以继续用中文**；
- `fileAssociations[].description` 是**全局**字段，
  `BundleConfig` 里**没有按平台区分的余地**，也没有「改 MSI 代码页」的选项
  （`WixConfig` 只有 `language` / `template` / `fragmentPaths` 这些）；
- 于是唯一能做的就是：**进 MSI 的字符串必须是 1252 能编码的**。

判据不是「纯 ASCII」——`©`、`…`、`—` 这些 1252 **装得下**，
不必为了保险把它们也换掉。真正的判据是「能被 Windows-1252 编码」，
`scripts/check-bundle-ascii.ts` 用 `TextDecoder("windows-1252")` 反查字节表来判。

**这道闸门的价值在于它跑在秒级**：原来的失败要等七八分钟才知道，
现在 `pnpm bundle:check` 在本地与 CI 的前端 job 里立刻拦下。

### 三个死菜单项：语法参考 + 快捷键一览 + 侧边栏复选项

M5-4 接好了「项目主页」，但「Markdown 语法参考」与「快捷键一览」还挂着——
**注册了、菜单里看得见、点了没反应**。

M5-2 的 `action()` 只检查「id 在不在清单里」，
**管不到「有没有人真的处理它」**——这是那套机制的盲区，
Rust 侧的测试也管不着（它只保证「前端收得到」，不保证「前端会做」）。

第三个数得自己找：「视图」菜单里的**「显示侧边栏」复选项**。
它比前两个更隐蔽——在 GTK 上菜单系统会**自动翻转**它的勾选状态，
所以点下去勾是变了，但侧边栏纹丝不动：
菜单里出现一个「勾了但什么也没发生」的框，
比没有这个勾选框更糟（用户会以为侧边栏已经收起来了）。

复选项要接成**状态的显示**而不是摆设，就得有**两个方向**：

- **Rust → 前端**：用户点了复选项，菜单系统发一个菜单事件，前端切换状态；
- **前端 → Rust**：侧边栏状态变了（快捷键、面板折叠），
  前端通过 `set_sidebar_checked` 命令把真实状态推回去。

第二个方向是**权威的**：各平台对「点了复选项要不要自己翻转勾选」的处理并不一致
（GTK 会自动翻转，AppKit 不会），与其依赖平台行为，
不如让前端把真实状态推回去。

这里有个 Tauri 的坑：**`Menu::get` 不递归进子菜单**，
而复选项在「视图」子菜单里面。子菜单的 id 默认是 muda 随机生成的、
每次重建菜单都不同，按 id 找根本找不到——
所以给「视图」子菜单一个**稳定 id**（`SubmenuBuilder::with_id`），
分两步找：先按 id 拿子菜单，再从子菜单里拿复选项。

查找失败一律静默返回 `Ok`：菜单还没装上（前端比菜单先启动）不是错误。

两个**面板**的定位刻意不同：

| 面板 | 内容来源 | 为什么这样 |
|---|---|---|
| 快捷键一览 | **从注册表生成**（`SHORTCUTS` + `MENU_CHROME`） | 手抄的清单一定会漂移；一个「和你实际按的键不一样」的速查表，比没有更糟 |
| Markdown 语法参考 | 一份**数据文件**（`src/reference/markdown-syntax.ts`） | 写的是 **Inkstone 支持什么**，不是「Markdown 规范怎么说」 |

速查表里**不写还没实现的语法**（比如 `==高亮==`）——
用户照着写而屏幕上什么都不发生，比不写更糟。
所以表里每一行都是实测过的：表格能编辑、脚注能跳转、公式走 KaTeX、mermaid 会渲染成图。

**为什么速查表不渲染成「预览」**：渲染路径有两套——
编辑器里的实时预览是 CodeMirror 装饰器，导出走 remark → rehype。
两套输出的样式不完全一样，给出「导出时的样子」反而会让人以为编辑器里也是那样。
速查表要的是**可靠**，不是好看。

### 两条入口：原生菜单 + 命令面板

和「检查更新」一样的结构：
原生菜单走 `onMenuAction`，命令面板走意图总线（`app.show-shortcuts` /
`app.show-markdown-reference`），两条都落到 App 里的 `setHelpPanel()`。

命令面板这一条不是可有可无的：**原生菜单只在 Tauri 里存在**，
浏览器构建（`pnpm dev:web`）下菜单是空的——
没有第二条入口，这两个功能在浏览器里就完全触达不到（也就没法真跑验收）。

### 速查表逮住的一个真 bug：`⌘Equal`

「快捷键一览」一做完就暴露了 `formatShortcut` 的一个显示错误：

```
放大    ⌘Equal    ← 错，用户按的是键盘上印着 "=" 的那个键
```

`Equal` 是键的**物理名**，不是给人看的写法。修法是给 `KEY_ALIASES` 加一条别名
（`Equal: { display: "=", accel: "Equal" }`）。

但**加速键那一侧必须仍然是 `Equal`**——muda 的物理键表里**没有 `Plus`**，
`CmdOrCtrl+Plus` 解析失败，而 Tauri 建菜单时用的是 `.parse().ok()`，
**解析失败会被静默吞掉**，菜单项直接没有快捷键还不报错。
所以这两个别名是**方向相反**的两件事：
显示要 `=`，加速键要 `Equal`。

### 词典那条测试也得跟着改

速查表的数据是**多行**的（代码块、表格、mermaid、块级公式），
在源码里是 `"```js\nconst a = 1;\n```"` 这种带转义的字面量，
运行时才是真正的换行。

`tests/i18n.test.ts` 的「字典里没有用不到的条目」原来直接拿**运行时键**
去比**源码文本**，多行的键一个都匹配不上——把 4 条多行示例判成了「陈旧键」。

改法不是放宽判据，而是**把两种写法都算「用到了」**：
原文，或它的转义形式（转义形式才是源码里真实的写法）。

### 数据驱动的文案，字典层测试抓不到

速查表与快捷键表的文案**不是源码里的 `t("…")` 字面量**——
它们来自数据文件与注册表。所以 `tests/i18n.test.ts` 那条
「`t()` 的字面量都在字典里」**抓不到它们**，漏译在这里是静默的：
英文界面里夹一段中文示例，不报错。

于是 `tests/help-panels.test.tsx` 补了两道：
把数据逐条对着两份词典查一遍，再把面板真的渲染出来查 DOM 里有没有漏网的语言。



```
src/parser/     Markdown 解析层（唯一语义来源，remark/mdast）
src/editor/     编辑内核（CM6 封装 + live-preview 装饰器插件）
  └ render/     块级渲染层（M2：代码块 / 表格 / 公式 / 图表 共用的机制）
src/renderer/   渲染层（高亮/公式/图表）
src/export/     导出管线（M4：注册表 / 变量 / front matter / HTML / PDF）
src/ai/         AI 能力（provider / 端点预设 / 上下文切片 / 写回契约 / 面板 store / SSE）
src/settings/   设置模型与存储
src/i18n/       界面国际化（手写轻量：t / tParts / 字典模块 / 原生语言同步）
src/reference/  Markdown 语法速查表的数据（帮助菜单用）
src/theme/      主题注册表与运行时
src/ipc/        与 Rust 侧接口
src/shortcuts.ts 快捷键**单一注册表**（KEYS / SHORTCUTS / 平台感知显示 / Tauri 加速键）
src/document/   文档生命周期（自动保存 / 崩溃恢复 / 外部修改冲突）
src/dev/        开发期测量台与 AI mock（不进生产包）
src-tauri/src/  Rust 后端（document / menu / recent / fs / search / watch / pandoc / print / shortcuts / i18n）
tests/corpus/   round-trip 语料库
scripts/        开发工具脚本（bench-parser / bench-decorations / verify-incremental / dump-lezer-tree / check-licenses / check-i18n-scope / check-bundle-ascii / gen-shortcuts）
perf.html       Live Preview 性能测量台（vite dev 下访问 /perf.html）
docs/           计划书与调研文档
```

## `==高亮==`：一个语法要动**两套**解析器（2026-10-26）

Typora 的行内高亮 `==高亮==`。补它的时候撞上五件事，都值得记下来。

### 1. remark 与 lezer 各写一遍，**判据必须一致**

红线 3 要求「解析规则唯一」——但「唯一」指的是**规则本身只有一份**，
不是「只有一套实现」：语义归 remark/mdast，编辑布局归 lezer（见上文红线 3 段）。
所以这个语法**两边都要有**：

| | 用什么 | 为什么 |
|---|---|---|
| remark 侧 | `mdast-util-highlight-mark` + `micromark-extension-highlight-mark` | 事实标准（各 400 万+ 月下载），mdast 节点与 toMarkdown 齐全 |
| lezer 侧 | **自研 25 行** `MarkdownConfig` | `@lezer/markdown` 没有高亮扩展；而 `Subscript`/`Superscript` 只支持**单字符**标记（`~x~`/`^x^`），`==` 是双字符，用不了 |

lezer 侧照抄 `@lezer/markdown` 的 GFM `Strikethrough`——
**flanking 规则两边都派生自同一份 GFM 模板**（`micromark-extension-highlight-mark`
的源码本身就是 GFM 删除线模板的忠实改写），所以判据天然一致。

一致性不能靠「看着对」：`tests/highlight.test.ts` 里钉了 **12 条 lezer↔remark 对拍断言**。

### 2. 顺手修掉一个**比不渲染更糟**的 bug：单个 `~` 被吃成删除线

写高亮时发现的：`remark-gfm` 默认 `singleTilde: true`，把**单个** `~` 也当删除线
（GFM 规范并不允许，这是 GitHub 的宽松行为），而 lezer 只认成对 `~~`。

两层对不上，后果是**屏幕与导出不一致**：

- `~下标~`：编辑器里显示字面文本，**导出变成 `<del>下标</del>`**
- 化学式 `H~2~O`（语料库 `12-typora-extensions.md` 里就有）：导出变成 `H<del>2</del>O`

「屏幕是字面量、导出是删除线」比「压根不渲染」更糟——用户会以为文档被改了。
现在 remark 侧显式 `{ singleTilde: false }`，且 `markdown.ts` 与 `html.ts` **两处都要改**
（只改一处等于没改：导出走的是 `html.ts` 那条链路）。

顺带解释了另一件事：Typora 的 `~x~` 语义是**下标**不是删除线，
这是「要实现下标就得先处理 `~` 与 `~~` 的仲裁」的由来（成本最高的那个，故排在后面）。

### 3. `<mark>` 走 `remark-rehype` 的 `handlers`，不是 `toHastExtensions`

`mdast-util-to-hast` v13 **没有** `toHastExtensions` 机制。
扩展入口是 `remark-rehype` 的 `options.handlers`（见 `src/parser/highlight.ts`）。

另外 `mdast-util-highlight-mark` 的 mdast 节点**不带** `data.hName`
（老的 `remark-mark-highlight` 带）——所以不接 handler 的话，
`defaultUnknownHandler` 会给它生成一个 `<div>`。

### 4. 速查表不要用**黑名单**维护，改成拿解析器交叉验证

速查表原本有一条断言：「表里不许出现 `==`」——因为那时 `==` 还没实现。
这种黑名单会漂移：实现了一行忘了改断言会红；或者有人加了行，断言还绿着。

现在改成**交叉验证**：表里有 `==高亮==` → **解析器必须切出 `highlight` 节点**；
表里没有 `~下标~` / `^上标^` → 解析器也不该切出来。
「表说什么」和「解析器做什么」互为对方的判据，谁漂了都立刻红。

### 5. 命令不能**撒谎**：格式标记提成数据表 + 守卫测试

命令面板里出现一个**不生效**的格式命令，比没有这个命令更糟——
用户点了以为成功了，屏幕上什么都没变，他只会以为编辑器坏了。
`==高亮==` 就是这么活了很久：命令在、标记也在，但解析层不认。

于是把 7 个格式命令的标记提成导出的 `FORMAT_SPECS` 数据表，命令从它派生，
守卫测试断言的**就是命令实际用的那份数据**：

- 每个标记 → 解析器必须切出对应节点（真的会被渲染）
- 暂时不实现的（`~下标~`、`^上标^`）→ 必须在显式的 `KNOWN_PENDING` 清单里，
  **每条写明原因**；一旦有人实现了，测试强制要求更新清单

## 设置面板里的**摆设开关**（2026-10-26 排查 `==高亮==` 时撞上）

`settings.markdown` 一共 **12 个**开关，真正接线的**只有 1 个**：

| 开关 | 实际效果 |
|---|---|
| `inlineMathSingleDollar` | ✅ **真的接线**：透传给 `remark-math` 的 `singleDollarTextMath`，编辑器与导出天生一致 |
| `inlineMath` / `mermaid` | ⚠️ 只改**状态栏上那句文字**（「数学已启用 · 图表已启用」）。`src/editor/` 里**没有任何代码读设置**——渲染是无条件的 |
| `blockMath` / `autoNumberEquations` / `mhchem` / `githubAlerts` / `footnotes` / `highlight` / `subscriptSuperscript` / `frontMatter` / `tables` / `taskLists` | ❌ **完全没人读**。勾一下什么都没发生 |

这些字段从 schema 立项那天就在（照着 Typora 的「Markdown 扩展」面板列的），
设置面板也画出了复选框——但后面没接。
「设置里的参数不接到请求上，就是摆设」这条原则最早是为 AI 面板写的，
这里同样适用。

**为什么当时没有顺手修**（2026-10-26 的判断，留给后续拍板）：

要让它生效，得先回答三个设计问题，每一个都会动到架构：

1. **parser 实例怎么切**。`@lezer/markdown` 的扩展是**配置期**决定的，
   运行时只能**换掉整个 parser**（CM6 的 `language` facet 要用 Compartment 换；
   Live Preview 那棵树也得跟着换——它现在直接用模块级的 `gfmMarkdownParser`）。
   换 parser = 全量重解析。
2. **语法速查表要不要跟着变**。速查表现在是**静态数据**，
   而且「表里有什么」与「解析器切出什么」互为判据（见上文第 4 条）。
   开关一关，表里就不该再列 `==高亮==` → 表得变成**按设置算出来的**，
   而它现在是带 i18n 的静态数据文件。
3. **格式命令要不要受限**。关掉高亮后，「高亮」命令还该不该插 `==`？

所以这是一件**独立的功能**（「Markdown 扩展开关真正生效」），
不是某个功能的收尾。

→ **2026-10-26 已实施**，三个设计问题都拍板了，详见下一节。

## Markdown 扩展开关：13 个复选框，12 个真接线（2026-10-26 建立 / 2026-10-27 补齐最后两个）

上一节记的那个「摆设开关」，本轮全部接上线了。

### 先纠正一个数字

`settings.markdown` 是 **13 个**字段，不是 12 个——
本轮实现时逐一核对过（`autoNumberEquations` / `subscriptSuperscript` 也在里面）。

13 个里有 **12 个**进了 `src/parser/features.ts` 的开关模型（真的接线），
剩下 **1 个**对应的功能**还不存在**，设置面板里**置灰并写明原因**：

| 置灰的开关 | 为什么没做 |
|---|---|
| `autoNumberEquations`（公式自动编号） | 代码里**根本没有**编号功能。它的默认值是 `false`——它是个**许愿** |


（2026-10-27 更新：`subscriptSuperscript` 当初也在「置灰」名单里，
因为 remark 侧没有对应的解析规则。现在 remark 侧补上了自研的 micromark 扩展，
它也变成真开关了——见后文「下标 / 上标」那节。）

把它们放进 `MarkdownFeatures` 等于给「还没实现的功能」发一张通行证。
不放，设置面板里就置灰——**置灰比许愿诚实**。

### 唯一真相源：`src/parser/features.ts`

一份 `MarkdownFeatures`（12 个字段），四处派生：

```
settings.markdown ──featuresFromSettings──┐
                                          ├──► MarkdownFeatures ──► 语义层（remark）
                              featuresKey ─┤                  ├──► 编辑布局层（lezer）
                                          │                  ├──► 渲染层（装饰器）
                                          └──────────────────┴──► 导出与剪贴板
```

`featuresKey` 是 12 个 0/1 拼成的字符串——解析器与语法分析器都按它缓存，
所以最多 2¹² 种组合，而且**同一组合永远命中同一个缓存**。

### 三个层次，「不生效」的样子不一样

| 层 | 开关关掉后 |
|---|---|
| remark（语义） | 不再产出对应节点（表格 / 任务 / 脚注 / 高亮…） |
| lezer（编辑布局） | 不再认对应标记（表格 / 任务 / 高亮） |
| 渲染层 | 不渲染（公式不渲染成 KaTeX、图表不渲染成 SVG） |

三层同时关 → 用户看到的是「这段语法不被识别，显示为字面文本」，
导出也是字面文本。**屏幕与导出必须一致**（架构约束 C）。

### GFM 拆开是**零成本**的

`remark-gfm` 是一次性挂上五样东西（自动链接 / 脚注 / 删除线 / 表格 / 任务列表），
**没有单独的开关**——想关「表格」就只能把 GFM 拆开自己装。

而这五样东西本来就是 `remark-gfm` 的**传递依赖**，早就在 pnpm store 里了：

```
micromark-extension-gfm-{autolink-literal,footnote,strikethrough,table,task-list-item}
mdast-util-gfm-{autolink-literal,footnote,strikethrough,table,task-list-item}
```

把它们提升为**直接依赖**即可（`pnpm add` 报 `downloaded 0`，不下载任何新包，
许可证还是同一批 MIT）。顺序**原样照抄** `remark-gfm`（自动链接 → 脚注 → 删除线 → 表格 → 任务列表）——
micromark 的 text 构造是按顺序叠加的，换顺序会改变某些输入的判定。

**实测包体代价**（前端产物，同一份代码只差本轮改动，两次 `pnpm build` 对比）：

```
baseline  8,064,500 bytes
new       8,077,679 bytes
增量      +13,179 bytes ≈ 12.9 KB（占 8.06 MB 的 0.16%）
```

GFM 那 10 个子扩展**一点都没涨**——它们本来就被 `remark-gfm` 打进产物了，
提升为直接依赖只是让 import 路径合法化。真正新增的是
`remark-github-blockquote-alert`（约 3 KB）与本轮自己写的代码。

### 踩到的四个坑（都是「看起来能跑，其实没跑」）

**坑一：lezer 的 `configure` 是加法，`base` 里**已经**自带 GFM。**

`base` 是 `@codemirror/lang-markdown` 的 `markdownLanguage.parser`，
而它不是裸的 CommonMark——CM6 那边的定义是：

```js
const extended = commonmark.configure([GFM, Subscript, Superscript, Emoji, …])
const markdownLanguage = mkLang(extended)
```

也就是说 `base` 里**已经有** Table / TaskList / Strikethrough / Autolink。
而 lezer 的 `configure` 只会**追加**，没有「替换掉已有解析器」的概念——
所以「表格开关关掉」如果只是「不往里加 Table」，**根本关不掉**。

真正能摘掉一个解析器的只有 `MarkdownConfig.remove`（按**解析器名**置空）：

```ts
const remove: string[] = [];
if (!features.tables) remove.push("Table");
if (!features.taskLists) remove.push("TaskList");
base.configure({ remove, … });
```

也不能改成「从裸 CommonMark 重新搭」：`base` 上还挂着 CM6 的
`headingProp`（标题折叠靠它）、`indentNodeProp`、`languageDataProp`——
那些定义在 `@codemirror/lang-markdown` 的模块作用域里，**没有导出**，拿不到。

**坑二：unified 的变换器只在 `run()` 阶段执行，而 `parseMarkdown` 只调 `parse()`。**

早先把「关掉的公式还原成原文」做成 remark 插件（`remarkMathOff`），
它**一次都没跑过**——测试是绿的，因为**没有测试断言它生效**。
「插件挂上了」不等于「插件跑了」。

现在改成普通函数 `restoreDisabledMath(tree, source, options)`，
由 `parseMarkdown` 在解析完立刻调用：调用关系是显式的，跑没跑一眼看得见。

**坑三：`resolveFeatures` 原来用 `{...DEFAULT_FEATURES, ...partial}` 展开。**

形状传错时（该扁平的地方多套了一层 `{ features: {...} }`），
那个嵌套对象被当成一个叫 `features` 的开关塞了进去，
于是真正要改的 `inlineMathSingleDollar` **根本没被改到**，
而功能「看起来是关掉的」——排查了很久。

现在**只挑已知键**，其余原样丢掉。丢掉未知键之后，
至少结果只受已知开关影响；形状错了会立刻表现为「开关没生效」，
而不是悄悄塞进垃圾键。

**坑四：`export/html.ts` 原来调 `markdownToHtml(source)` **不传 options**。**

也就是说**导出完全不跟随用户的开关**——
用户关掉「表格」，屏幕上不是表格、导出却是表格。
这是本轮顺手修掉的既有缺口（架构约束 C 的一个实际破口）。

### 公式关掉必须做在**解析层**

`remark-math` 只有一个开关（`singleDollarTextMath`），
**没有**「行内公式」「块级公式」分开的开关——而设置面板里这两个是分开的。

只关行内公式时，`remark-math` 仍然要挂（块级还要用），
于是 `$x$` 会被解析成 `inlineMath` 节点——
**定界符 `$` 在 mdast 里是不存在的**（节点只有 `value: "x"`）。

直接不渲染它，导出会变成 `<code>x</code>`——**用户的 `$` 没了**。
那比「不解析」更糟：文档内容被悄悄改掉了。

解法：用 node 的 position 把原文切回来。
`inlineMath` / `math` 节点的 position **完整覆盖定界符**（实测）：

| 源码 | position 切出来的原文 |
|---|---|
| `$x^2$` | `$x^2$` |
| `$ x^2 $`（带空格） | `$ x^2 $` |
| `$$\ny = mc^2\n$$` | `$$\ny = mc^2\n$$` |

把节点换成一个**内容等于原文**的文本节点，效果就等于「这个公式根本不被识别」。

### mhchem 做成**真开关**

KaTeX **内置** mhchem：`\ce{H2O}` 直接就能渲染成化学式，不需要额外插件。
所以「关掉 mhchem」不是「装没装插件」的问题，而是「要不要让它生效」的问题。

关掉之后 `\ce{…}` 应该显示成**字面文本**——不是空白，不是报错，
更不是「悄悄变成别的意思」。做法是用 KaTeX 的 `\verb|…|`（**完全按字面**渲染）。

不自己拼 `\backslash ce\{…\}`：后者要逐个转义 `_` `^` `&` `%` `$` `#`，
而且 `\^` 在 KaTeX 里是**重音命令**（要吃参数），拿来转义尖括号会直接报错
（实测 `KaTeX parse error: Undefined control sequence`）。

标志**显式传下去**（`MathRenderOptions.mhchem` → `renderMath` 唯一收口 →
编辑器 / 块级 / 复制 / 导出四处一致），**不在渲染器里读全局设置**——
装饰器管线是**纯函数**（不吃 EditorState，只吃显式参数）。

### GitHub 提示块：变换放在**导出期**，不放解析层

上游 `remark-github-blockquote-alert`（MIT，336 万月下载）是**破坏性**的：
它把 `[!NOTE]` 从正文里删掉，再往引用块里插一个「图标 + 标题」段落。

放进解析层的话，往返（mdast → Markdown → mdast）就**丢了标记**——
而 Inkstone 对往返的要求是「再次解析后结构等价」。

所以它属于**表现层变换**（与公式的 `rehypeMath` 同性质），
发生在「mdast → HTML」这条链路上。语义层因此保持干净：
mdast 里它就是**普通引用块**，标记还在正文里。

判定规则抄了一份（上游没导出它的正则），两边**对拍**：
上游认的是「引用块里**第一个匹配上的**段落，其第一个文本节点以 `[!TYPE]` 开头」——
注意是「第一个**匹配上的**」而不是「第一个段落」，
`> 引用\n>\n> [!NOTE]` 上游会认成 alert。

lezer 不认识 alert（`[!NOTE]` 在它眼里是个 Link 节点，和脚注一样），
所以编辑器侧按「引用块 + 段落」扫一遍。

**编辑器侧的渲染**：底色用 **`Decoration.line`** 而不是行内 mark——
mark 只盖住文字那么宽，底色到文字末尾就断了，提示块看起来像一小截彩色文字；
行装饰挂在 `.cm-line` 上，底色能铺满整行 ✓
（行装饰一次只管一行，所以逐行挂）。
`>` 引用符号用零宽 widget 顶替藏掉——提示块已经有标题徽章了，
再留个 `>` 只会让人以为是普通引用块。

### 速查表与格式命令也跟着开关走

**速查表**：每条示例带一个 `feature` 标签，开关关着时**那条示例消失**；
一组全被过滤掉时整组也消失（留个空标题更糟）。
数据模型从 `samples: string[]` 改成 `samples: SyntaxSample[]`。

**格式命令**：`FormatSpec` 加 `feature` 字段，
关掉高亮后「高亮」命令**不进命令面板、不进斜杠菜单**——
命令面板里出现一个**不生效**的格式命令，比没有更糟：
用户点了以为成功了，屏幕上什么都没变。

### 运行时怎么切

| 东西 | 怎么换 |
|---|---|
| remark 处理器 | `getProcessor(options)` 按 `featuresKey` 缓存，天然按需重建 |
| lezer parser | `getMarkdownParser(features)` 同样按 `featuresKey` 缓存 |
| CM6 `language` facet | Compartment `languageBox` 换（源码模式的语法高亮） |
| Live Preview 的树 | `setMarkdownFeatures` effect → **整篇重解析** |

**必须换 parser**（不是可选项）：parser 换了，`TreeFragment` 不能复用——
`TreeFragment` 是与 parser 绑定的，拿旧 parser 的片段喂新 parser 会得到错误的树。

初始开关通过一个 **facet** 传给 `StateField.create`
（`StateField` 没有「初始值」配置项，而 facet 的值在状态创建前就算好了）。
早先的做法是「创建后再派发一次 effect」——那会让第一棵树用**默认 parser** 解析一遍，
然后立刻整篇重解析：多余的解析，而且中间那一帧的装饰器是按错的规则算的
（表格已经渲染出来了，下一帧才消失）。

切标签页时新建的状态也要跟上当前开关（facet 里记的是**编辑器创建时**的开关），
所以 `createState` 会比对一次，不一致就补一次 effect。

### 已知缺口

这三项在 2026-10-27 全部修掉了（见上文「屏幕与导出的四个破口」），
这里保留原来的记录，因为**它们是怎么被发现的**比结论更有价值：

- 提示块规则的一处已知分歧：文档里若有 `[!NOTE]: https://…` 这样的链接定义，
  mdast 会把 `[!NOTE]` 解析成 linkReference（上游插件不认），
  编辑器侧仍会认 → 记在 `src/editor/render/alert.ts` 的文件头
- `tests/incremental-parse.test.ts` 里那条「大文档下增量解析显著快于全量解析」
  的基准**名不副实**：
  - 增量路径是 `state.update({changes}).state` × 10，但每次都从**同一个 base state**
    出发（结果没赋回去），所以测的是「base + 1 处改动」，不是「连续 10 次编辑」
  - 全量路径是 `parseSyntax(mutated)` × 10，只解析，**不含**状态更新与装饰器重算
  - 两条路径**不是同类对比**
  断言本身是方向性的（`incremental <= full`），所以它一直绿着。
  本轮只修了里面的 lint 错误（去掉多余的 `.state`），**没有改它的语义**——
  要真做成增量基准，得把两条路径改成同类对比，是独立工作量。
- lezer 的 `Subscript` / `Superscript` 节点**不解转义**——
  内容里的 `\~` 在编辑器里显示成 `\~`（反斜杠可见），
  而 mdast 侧转义已解开，导出是 `~`。
  这是 lezer 的固有行为，**普通文本里的转义也一样**（`\*` 显示成 `\*`），
  不是本功能引入的偏差；要改得连普通转义一起改，是独立工作量。

**教训**：「已知缺口」里躺着的每一条，迟早都要还。
而还债的顺序应该按**成因**排，不按**症状**排——
本轮三条里有两条是同一个成因（编辑器与导出的解释不一致），
一起修才不漏。

## `tests/` 纳入类型检查：一个藏了 36 处问题的盲区（2026-10-27）

`tsconfig.json` 的 `include` 原来只覆盖 `src`——
`pnpm typecheck` 报「全绿」时，**测试代码从来没被类型检查过**。

实测把 `tests` 加进 `include` 之后，暴露 36 处错误，分布在 18 个文件。
其中有几处是**真 bug**，被测试的「绿」掩盖了很久：

| 位置 | 问题 | 为什么测试还是绿的 |
|---|---|---|
| `mermaid.test.ts` / `table-edit.test.ts` | `ensureSyntaxTree(state, gfmMarkdownLanguage, 10_000)` —— 第二个参数是**位置**，不是 Language | 靠「`Language >= number` 恒为 false」这个巧合退化成「解析整篇」，结果碰巧是对的 |
| `image.test.ts` | `import type { Range } from "@codemirror/view"` —— 该符号声明了但没导出 | 整个文件根本没用到它 |
| `settings.test.ts` | `updateSettings({ editor: { fontSize: 18 } })` —— `fontSize` 在 `appearance` 分节 | 写进 `editor` 会往持久化内容里塞一个 schema 里没有的键 |
| `table-toolbar.test.ts` | `querySelector(...)?.dataset` —— `Element` 没有 `dataset` | 运行时那个元素确实是 `HTMLElement` |
| `alerts.test.ts` | `remarkAlert()(tree)` —— 上游把插件标成 `Plugin`（`this: Processor`），运行时返回的是纯 transformer | 运行时能跑，只是类型不对 |

其余是类型收窄（mdast 的 `Point.offset` 是可选的、`Parent` 才有 `children`）
与未使用变量（含 `deferred` / `parkAtEnd` 这类重构后遗留的死代码）。

**教训**：`noUnusedLocals` 这类规则只在**被包含的范围**内生效。
「闸门全绿」不等于「全绿」——先确认闸门**覆盖了什么**。

### 同一个盲区还有第二个：lint 也没覆盖 `tests/`

`pnpm lint` 原来是 `eslint src --max-warnings 0`——
命令行只给了 `src`，所以测试代码**从来没被 lint 过**。

改成 `eslint src tests` 后只暴露 **1 处**：
`tests/incremental-parse.test.ts` 里一个纯表达式语句
（`state.update({...}).state;` —— 取了 `.state` 却不用）。
另 1 处是 `importOriginal<typeof import("…")>()` 这种
「`import()` 类型注解」，改成 `import type * as FsModule from "…"`。

**两道闸门的覆盖范围现在是对齐的**：`tsconfig.json` 的 `include` 有 `tests`，
`eslint` 的 `files` 也有 `tests`。

**第三道（格式）还没跟上**：`prettier` 的 glob 是 `"src/**/*.{ts,tsx,css}"`——
**只扫 `src`，不扫 `tests`**（实测 `tests/` 下有 40 个文件不合 prettier 规范）。
所以「格式闸门全绿」这句话对测试代码不成立。
这一条与上面两处是**同一个盲区**（闸门覆盖范围小于代码范围），
但修它的代价是**重排 40 个测试文件**——那个 diff 会把功能改动埋掉，
所以留作独立一件事，不夹带进功能提交里。

## 下标 / 上标：remark 侧只能自己写（2026-10-27）

`~下标~` 与 `^上标^`（Pandoc 风格）在设置面板里躺了很久，一直是**置灰**的：
lezer 侧有现成扩展，remark 侧没有对应解析规则，
只开一半会破「解析规则唯一」那条红线（屏幕上是下标、导出却是字面文本，
或者反过来）。

### 生态里没有能用的现成包

查过三个，三个都不行：

| 包 | 为什么不能用 |
|---|---|
| `remark-sub@1.0.1` | 正则写的是 `_` 而不是 `~`（名字与实现对不上）；而且把命中的 text 节点整个改成 `html` 节点，**往返必然丢原文** |
| `remark-supersub@1.0.0` | `split(/\^/)` 文本扫描，不判空白也不判成对闭合，`^a b^` 会被它当成上标 |
| `remark-sub-super@1.0.21` | remark 9 时代的老 API（`this.Parser.prototype.inlineTokenizers`），remark 11 早没了 |

所以语义层这一半只能自己写：`src/parser/subsup.ts`（约 380 行）。

### 规则是一份**写下来的规格**，不是各写一套碰运气

lezer 侧的判定在 `@lezer/markdown` 的 `parseSubSuper` 里，
本项目的 tokenizer **逐条照抄**它，规格写在那份文件的文件头：

| # | 规则 | 例子 |
|---|---|---|
| ① | 开标记后紧跟同一个标记 → 不认（那是删除线 `~~`） | `~~x~~` 是删除线 |
| ② | 必须有闭合标记，且在同一行内 | `~x` 不是下标 |
| ③ | `\` 后的字符被转义，不当作闭合标记 | `~\~x~` 的内容是 `~x` |
| ④ | 内容里不能有空白 | `~a b~` 不是下标 |

`tests/subsup.test.ts` 里有 29 组**两层对拍**用例
（lezer 与 remark 对同一段文字必须给出同样的结论），
这是红线③的可执行版本。

### micromark 侧的三个实现要点

1. **挂在 `text` 的码点表上**，与 GFM 删除线（也挂 `~`）同一个位置。
   micromark 合并扩展时**后挂的 construct 插到前面**，
   所以要用 `add: "after"` 才能排在删除线之后（与 lezer 的注册顺序一致）。
2. **内容不做嵌套解析**。lezer 的 `parseSubSuper` 是**字符级**的：
   `~a*b*c~` 在 lezer 眼里是一个 Subscript，内容 `a*b*c`。
   本项目的 tokenizer 同样按字符消费，不走 micromark 的行内解析，
   也不挂 `insideSpan`（那是「自定义 construct 的内容区要再解析一遍」的机制，
   挂上会允许嵌套下标，与 lezer 不一致）。
3. **转义自己处理**。micromark 的 `characterEscape` 是个**独立 construct**：
   交给它，我的 tokenizer 就得结束，「内容」也就断了。
   所以自己消费 `\` + 下一个字符，但**产出标准的 token 名**
   （`characterEscape` / `escapeMarker` / `characterEscapeValue`），
   mdast 侧就不用写任何自定义 handler。

### 往返靠 `unsafe` 兜住

内容里的 `~`（或 `^`）必须转义，否则 `~a~b~` 序列化回去会被解析成
「下标 a」+「文本 b~」，结构就不等价了。
`subSupToMarkdown` 里那两条 `unsafe` 规则就是干这个的
（跟 `mdast-util-highlight-mark` 把 `=` 标成 unsafe 同一回事）。

### 包体代价：+2.5 KB

前端产物实测 **8,403,577 → 8,406,184 bytes（+2,607 ≈ 2.5 KB，0.031%）**。
自研的 micromark 扩展几乎不增加包体——micromark 核心本来就在包里。

新增的 5 个依赖全是**传递依赖提升为直接依赖**（`pnpm add` 报 `downloaded 0`），
许可证都是 MIT：`micromark-util-symbol` / `micromark-util-character` /
`micromark-util-types` / `mdast-util-from-markdown` / `mdast-util-to-markdown`。

### 一个类型陷阱：`.d.ts` 里没有顶层 import 就会**替换**整个模块

`src/types/subsup.d.ts` 里写 `declare module "mdast" { … }`，
如果那个文件**没有顶层 import/export**，TypeScript 会把它当成
**ambient module declaration**——整个 `mdast` 模块被这份声明**替换**，
于是 `Node` / `Parent` / `Root` 全部消失：

```
error TS2305: Module '"mdast"' has no exported member 'Node'.
```

加一行 `import type { PhrasingContent } from "mdast";` 就变成「模块增强」了。
`mdast-util-highlight-mark` 的 `.d.ts` 也是这么写的（它有顶层 import）。

## 粘贴时把 `<sub>` / `<sup>` 转成下标 / 上标（2026-10-27）

下标 / 上标补齐之后，发现**粘贴**这条路上还缺一环：
turndown 的规则表里**没有** `<sub>` / `<sup>`，
默认行为是「丢掉标签、只留内容」——实测 `H<sub>2</sub>O` → `H2O`。
从网页或 Word 复制过来的上下标，就那么在粘贴时没了。

### 转换的前提：转出来的语法必须**自己认得出来**

直接写「`<sub>` → `~…~`」是不行的——
`~a b~` 按规则 ④ **不是**下标（内容里不能有空白），
而 `~a~b~` 会因为内容自带标记而提前闭合。
这两种情况如果照转，用户会在编辑器里看到一对**看得见的波浪号**，
而导出时又认不出来（架构约束 C：屏幕与导出必须一致）。

所以判据放在 **`src/parser/subsup.ts`**（与解析规则同源，不另起一份）：

```ts
export function canWrapSubSup(content: string): boolean
```

五条判据（逐条对应文件头那四条规则）：

| # | 判据 | 为什么 |
|---|---|---|
| ① | 内容非空 | `~~` 不是下标（规则 ①） |
| ② | 不含空白 | 规则 ④：`~a b~` 不是下标 |
| ③ | 不含 `\` | 规则 ③：转义会让 remark 侧丢掉被转义的那个字符 |
| ④ | 不含 Markdown 活跃字符 | 内容区是字符级的，包进去会变成字面文本 |
| ⑤ | 不含标记本身 | 会提前闭合：`~a~b~` → 下标 a + 文本 `b~` |

判据 ④ 值得单说：**下标 / 上标的内容区是字符级的**（不解析嵌套语法），
所以 `**x**` 包进去之后不会变成粗体，而会变成下标里躺着一对看得见的星号。
与其产出这种「认得出来但很难看」的结果，不如**不包**——
内容留在外面至少还能被当成正常的 Markdown 解析。

`tests/subsup.test.ts` 里有一条**判据与解析器的一致性**用例：
判据说「能包」的内容，包起来之后必须真的被解析成下标 / 上标，
而且内容一字不差（remark 与 lezer 两侧都查）。

### 认不出来时退回**纯内容**，而不是原始 HTML

退路有两个，选了「纯内容」：

| 退路 | `<sub>a b</sub>` 的结果 | 问题 |
|---|---|---|
| 保留原始 HTML | `<sub>a b</sub>` | Inkstone 的实时预览**不渲染行内 HTML**（只有表格单元格走 `renderInlineHtmlSync`），屏幕上会显示成字面的 `<sub>a b</sub>`，而导出时又渲染成了下标 → **屏幕与导出不一致** |
| **退回纯内容**（选它） | `a b` | 下标语义丢失，但屏幕与导出一致，文字干净可读 |

内容里本来就有 Markdown 语法时（`<sub><em>x</em></sub>`），
纯内容是 `*x*`——斜体保住了，比包进一个认不出来的标记里强。

### 不按设置里的「下标 / 上标」开关分叉

粘贴的是**外部内容**，而开关管的是**本项目文档**的解析口径。
与 `<mark>` → `==…==` 同理（那条也没分叉）。

### 同一件事的另一种来源：行内样式

Word / Google Docs 的上下标**不一定**用 `<sub>` / `<sup>` 标签，
也可能是 `<span style="vertical-align: super">`。
所以 `styledSpan` 那条规则（本来管加粗 / 斜体 / 删除线）也补了上下标，
用的是**同一条判据**。

放在三条样式判断的**最后**：那时 `out` 可能已经裹上了 `**…**`，
而 `*` 是活跃字符 → `canWrapSubSup` 拒绝 →
「既是粗体又是上标」的内容**不转**（转了会变成一对比看得见的星号）。

### 已知缺口：Word 私有的 `mso-vert-align`

Word 的 HTML 里还有一种写法是 `mso-vert-align: super`（`-ms-` 私有属性）。
本轮**没有**覆盖它——手上没有真机 Word 可以验证它到底写成什么，
而写一条没核实过的规则正是本项目反复踩的坑（「看起来能跑，其实没跑」）。
等哪天真机 Word 复制一段带上下标的文字，看一眼剪贴板里是什么，再补这一条。

**2026-10-28 更新**：真机 Word 的剪贴板拿到了（见下一节），
但那次复制的段落**不含上下标**，所以这条缺口**仍然开着**——
只是现在知道 Word 的 HTML 长什么样了（见下节），
下一次只要复制一段带上下标的文字就能对上了。

## 真机 Word 的剪贴板：开头多出 8 个空格（2026-10-28）

用户从真机 Word 复制了一段到剪贴板，把它整个喂进
`htmlToMarkdown`——转换出来的 Markdown **开头有 8 个空格**。

### 根因不是「Word 写得脏」，是 turndown 的一个例外

turndown 是把输入包进 `<x-turndown>` 再用 DOM 解析器解析的，
而 **DOM 解析器会把 `<head>` 的内容摊平进这个元素**。
于是 Word 那些 `<meta>` / `<link>` / 条件注释全成了根元素的子节点。

真正咬人的是**它们之间的空白文本节点**：

1. 那些空白被 turndown 塌成**一个个空格**（一个文本节点 → 一个空格）；
2. turndown 的 `blankRule` 本来会删掉「纯空白」的文本节点，
   但它有个例外——**同层级有 void 元素时就不删**
   （`<meta>` / `<link>` / `<br>` / `<img>` 都是 void）。
   Word 的 head 里全是 void 元素 → 空白全被留下。

实测 Word 15 的真实输出：head 里 4 个 `<meta>` + 3 个 `<link>` +
若干条件注释与样式表 → **8 个空格**。

### 这 8 个空格不是装饰

- 粘到**行首**：4 个以上的行首缩进在 Markdown 里是**缩进代码块**，
  用户粘进去会看到自己的内容变成了代码块；
- 粘到**行中间**：行尾多出空格 = **硬换行**（两个空格就够了）。

### 修法：只取 `<body>`，并摘掉首尾的空白节点

```ts
const doc = new DOMParser().parseFromString(html, "text/html");
const body = doc.body;          // head 的样板整个不要
trimEdgeBlankText(body);        // 首尾的空白文本节点摘掉
service.turndown(body);         // turndown 支持直接吃 DOM 节点
```

三步各有各的理由：

| 做法 | 为什么 |
|---|---|
| 只取 `body` | `<head>` 里只有元信息（meta / link / title / 样式表 / 条件注释），**没有正文内容**。摘掉它，那些 void 元素就不在了 → `blankRule` 的例外不再触发 |
| 摘掉首尾空白节点 | 只取 body 还不够：正文里只要有 `<img>` / `<br>`，body 里就有 void 元素 → 例外照样触发 |
| 交给 turndown 一个 **DOM 节点** | turndown 本来就要 clone + 塌缩空白（`RootNode`），给它节点而不是字符串，**解析次数不变**（还是一次） |

顺带的好处：head 里那 33KB 的 Word XML 条件注释**连解析都不必了**。

### 一条要记的教训：对照脚本要跟被测代码走同一条路

第一版对照脚本用的是**裸 turndown**（只 `use(gfm)`，没有项目自己的净化规则），
于是得出「样式表的内容也会漏进结果」——**那是测量假象**，
项目的 `JUNK_TAGS` 本来就挡得住。

真相是：项目实际只有「开头 8 个空格」这一个破口。

**判据**：对照实验必须跟被测代码走**同一条路**（同样的规则集、同样的选项），
否则你量的是另一个东西。

### 测试

`tests/fixtures/word-clipboard.html` 是**真机 Word 15 复制到剪贴板的 HTML**
（结构原样保留：head 里的 meta / link / 条件注释 / 样式表、
body 里的 `mso-` 行内样式与 `<o:p>` 标记；
**可见文字换成了中性占位文字**，不含任何个人笔记内容，
本机路径也换成了通用占位）。

`tests/paste.test.ts` 里 6 条新测试，其中 **5 条在旧实现下会红**——
写完一定要**故意退回旧实现跑一遍**确认它们不是假绿。

## 屏幕与导出的四个破口（2026-10-27）

这一轮把「屏幕与导出必须一致」（架构约束 C）上的四个实际破口堵上了。
四个的共同形状都是：**同一段文字，编辑器与导出给出不同的解释**。

### 1. 转义：编辑器显示 `\*`，导出是 `*`

lezer 的 `Escape` 节点覆盖「反斜杠 + 被转义的字符」，
而语义层（remark）的转义是**解开**的——
所以编辑器里显示 `a \* b`、导出却是 `a * b`。

修法：装饰器管线多认一种节点类型，**把反斜杠藏掉**（被转义的字符照常显示），
光标进入该转义时恢复原文（与行内标记一个规矩：左开右闭）。

这件事**不是下标 / 上标引入的**——普通文本里的 `\*` 一直对不上。
同一个成因分两处修就会漏，所以一起修掉了。

行内代码与链接地址**不受影响**：CommonMark 的代码跨度不解析转义，
lezer 那边也确实不产出 `Escape` 节点（实测 `InlineCode` 里没有 `Escape`）——
不是靠判断躲过去的，是本来就不在那儿。

### 2. 提示块：文档里有 `[!NOTE]: https://…` 时两边结论不同

上游 `remark-github-blockquote-alert` 的规则是
「段落的**第一个子节点**必须是 text 节点，且以 `[!TYPE]` 开头」。

而 mdast 在文档里**有**对应链接定义时，会把用到的 `[!NOTE]` 解析成
`linkReference` 节点——那不是 text 节点，于是上游**不认**这个提示块。
我们这边按**原文**扫，照认 → 屏幕上是彩色提示块、导出是普通引用块。

修法：编辑器侧先收集文档里的**链接引用定义**标签
（lezer 的 `LinkReference` → `LinkLabel`），命中就跳过该段落
（与上游「第一个子节点必须是 text 节点」对齐）。
标签要按 micromark 的 `normalizeIdentifier` 归一化（折叠空白 + 转小写），
否则大小写不同就查不到。

没有定义的 `[!NOTE]` 不受影响：mdast 把它当**普通文本**，上游照认，我们照认。

### 3. 对话框不响应 Esc

八个模态对话框里只有命令面板能按 Esc 关掉。

为什么之前改不了：对话框**不会**把焦点从编辑器抢走
（抢走的话，用户接着打字就打到别处了），
所以焦点经常不在对话框里——挂在容器上的 `onKeyDown` 收不到事件。
只能挂 `window`。

但裸的全局监听有个坑：面板可能**同时**开着
（AI 面板 + 设置面板、命令面板 + 帮助面板），
一次 Esc 会把它们**一起关掉**——那不是「关闭」，是「清场」。

所以用「后进先出」的栈：只有**最上面**的那个响应 Esc。
栈的顺序靠挂载顺序（对话框都是条件渲染的，关掉就卸载）；
命令面板是常驻挂载的，用 `enabled` 参数在 `open` 时才入栈。

**谁不该响应 Esc**（这是判断，不是遗漏）：

- **恢复 / 文件冲突这类「要你做决定」的对话框**：
  Esc 没有「取消」语义，静默关掉等于替用户选了「丢弃」——那会丢内容。
  它们宁可 Esc 无反应。
- **非模态的 AI 面板**：用户正在输入框里打字时按 Esc，
  关掉整个面板会丢掉草稿。那里的 Esc 语义应该是「收起浮层」。
- **导出面板在导出进行中**：关了面板，导出结果回来就没人接了。

### 4. 增量解析的基准名不副实（改完第一版还在 CI 上翻了一次）

原来那条「大文档下增量解析显著快于全量解析」有三重问题：

1. 增量路径是 `state.update({changes}).state` × 10，但每次都从**同一个 base state**
   出发（结果没赋回去）——测的是「base + 1 处改动」，不是「连续 10 次编辑」
2. 全量路径是 `parseSyntax(mutated)` × 10，只解析，
   **不含**状态更新与装饰器重算
3. 两条路径**不是同类对比**

改成同类对比后（同一串编辑、位置从后往前排，两边改的是同一处），
**在 CI 上翻了**：增量 385.33ms vs 全量 359.20ms——方向反了。

原因有两层：

- **共同的工作被算进了比较**：两条路径都要重算装饰器，
  而 jsdom 里装饰器重建比解析**贵一个数量级**——
  于是「增量 vs 全量」的差异被埋在噪声里（只剩 7% 的余量）
- **先跑的那条路径白背 JIT 预热**：第一轮就把编译成本算进增量那边

于是又改了一版：

- **只比「把新文档的语法树弄出来」这一件事**——
  装饰器重算是两边**同样**的工作，比较时排除掉（它归「局部重建」那一节分析）
- **预热两轮**，再**交替顺序**跑 5 轮，取**最小值**
  （最小值最接近「没被 GC / 调度打断」的那一次）

改完的余量：增量 **0.67ms** vs 全量 **8.01ms**——**12 倍**，不再是 flaky。

**教训**：性能基准断言的余量要比噪声大一个数量级，否则它测的是噪声。
「两条路径要公平」只是第一步——**把共同的工作排除掉**才是关键。
（第一版正因为把装饰器重算算进了两边，才从 12 倍的余量掉到 7%。）

## 「装饰器局部重建」：先量收益，再决定做不做（2026-10-27）

M2 留的最后一个性能项。这轮**没有**做，原因是量完之后发现
「收益上限」比想象中小得多——先说清楚为什么。

### 现状的实测数据

`scripts/bench-decorations.ts` 现在会多打一张表（理想化假设：
只重建变动的那一个块，装饰器成本降到 1%）：

| 规模 | 一次击键（增量路径） | 其中「重建全部装饰器」 | 局部重建后 | 占 16ms 预算 |
|---|---|---|---|---|
| 500 行 / 14 KB | 0.57ms | 0.50ms | 0.07ms | 4% → 0% |
| 1500 行 / 34 KB | 1.22ms | 1.09ms | 0.14ms | 8% → 1% |
| 4000 行 / 88 KB | 3.11ms | 2.81ms | 0.32ms | 19% → 2% |
| 8000 行 / 176 KB | 7.91ms | 6.34ms | 1.63ms | 49% → 10% |

结论：**4000 行以内根本不是瓶颈**（不到预算的 1/5）；
要到 8000 行才占到一半预算。

### 但「理想化」那一列是**上界**，现实收益要小得多

拆开看 8000 行那 6.34ms 的装饰器成本：

| 组成 | 耗时 | 局部重建能省吗 |
|---|---|---|
| 遍历语法树（一次 iterate） | ≈ 1.3ms | **能**——不变的部分不用再看 |
| `analyze()` + 构造 Decoration / widget 对象 | ≈ 5ms | **基本不能** |

第二项是主体，而它**省不掉**：装饰器对象的区间带**绝对位置**，
改动之后后面所有块的区间都要平移——
于是对象必须重建，widget 也得重建
（`ImageWidget` / `AlertTitleWidget` / `FootnoteRefWidget` / `BlockWidget` … 都把位置存进去了，
点击处理要用）。

所以真正的收益分成两档：

- **只跳过树遍历**（widget 仍带绝对位置）：省约 1.3ms / 6.34ms ≈ 20%
- **做到位**（widget 改成位置无关、点击处理挪到视图层）：才拿到表里那个数

第一档的收益在 8000 行时是 7.91ms → 约 6.6ms（49% → 41% 预算）——**不值得**。
第二档才值得，但要动**每一个 widget 类**加点击处理的重构。

### 剩下的四个硬约束（要动手前得先解决）

1. **脚注编号是文档级的**：引用 `[1]` 的编号取决于定义在全文里的次序，
   加一条定义会让**所有**引用的编号变 → 脚注装饰不能按块缓存
2. **链接引用表是文档级的**：`![a][ref]` 的地址来自全文的 `[ref]: url` 定义
3. **块的边界会变**：插入一行 ``` 可能让后面几千行都变成代码块；
   围栏、表格、引用块的边界都不是局部的
4. **上一个状态存哪**：装饰器是 `@codemirror/view` 的东西，
   而 `livePreviewField` 在 `@codemirror/state` 层——
   要跨击键复用上一次的装饰器集合，得先决定它住在哪
   （字段里 / 视图插件里 / 模块级缓存），
   而「Block decorations may not be specified via plugins」这条 CM6 限制
   又挡掉了「用 ViewPlugin 提供块级装饰器」这条路

### 我的建议

**先不做**，把 M2 的这个性能项改成「有触发条件再做」：

- 触发条件：真实用户反馈**大文档**（> 8000 行）打字掉帧
- 触发时要做的话：先做第二档（widget 位置无关化），
  否则省下的那 20% 不值当
- 无论做不做，上面那四个硬约束都得先在代码里有对应处理，
  不能靠「局部大概不会互相影响」

对照本项目一贯的做法：先量，再决定；
「看起来是性能问题」不等于「是性能问题」——
4000 行以内它连预算的 1/5 都不到。

## 四个死菜单项：源码模式 + 三个缩放（2026-10-27）

上一节（M5-5）修掉了三个死菜单项，本轮又挖出**四个**：
`toggle-source-mode`、`zoom-in`、`zoom-out`、`zoom-reset`。

它们和上一节那三个是**同一个病**，只是更隐蔽：

| 菜单项 | 加速键 | 点了会发生什么 |
|---|---|---|
| 源码模式 | ⌘/ | 什么都不发生 |
| 放大 | ⌘= | 什么都不发生 |
| 缩小 | ⌘- | 什么都不发生 |
| 实际大小 | ⌘0 | 什么都不发生 |

上一节已经写下了病根：

> M5-2 的 `action()` 只检查「id 在不在清单里」，
> **管不到「有没有人真的处理它」**——这是那套机制的盲区。

本轮把这条盲区**补上了**：先交叉比对 Rust 侧建出来的菜单项 id
与前端 `onMenuAction` 的订阅点（22 个 id，21 个有处理者，
缺的那 4 个就是本轮的死者），再逐个接线。

### 接线原则：菜单与命令面板**同源**

死菜单项的根子不是「少写了四行代码」，而是**同一个动作有两套入口、只有一套是通的**：

- 命令面板里早就有「源码模式」这条命令（走意图总线 `view.source`），
  而原生菜单那条路**断着**；
- 缩放则是**整条链路都没有**：菜单项有、加速键有、
  但既没有命令也没有实现——设置面板里倒是有「外观 → 字号」，
  改的就是同一个 `appearance.fontSize`。

所以接线不是「给菜单写四段逻辑」，而是**把它们接到同一处**：

```
原生菜单 ──┐
           ├─→ 意图总线 ─→ App ─→ 改设置 / 切模式
命令面板 ──┘
```

缩放也因此第一次有了**命令面板入口**（`view.zoom-in` / `zoom-out` / `zoom-reset`），
与原生菜单的三个菜单项、快捷键表里的三行，落到同一件事上。

### 缩放为什么按**预设档位**走，而不是 ±1px

设置面板的字号是一个**下拉框**（`FONT_SIZE_PRESETS = [13,14,15,16,17,18,20,22]`），
不是自由输入框。

缩放如果 ±1px，就会跳到下拉框里**根本不存在的值**——
用户再去设置面板一看，那个值不在列表里（`<select>` 会回退成第一项），
字号突然跳回 13。所以缩放 = **在预设里上/下一档**，
到头就停（不回绕）。

改的是 `appearance.fontSize`，也就是 `--ink-font-size`——
它挂在 `html` 上，所以**整个应用**都跟着变（像浏览器的页面缩放），
不只是编辑区。

### 命令面板里搜「缩放」搜不到——**显示名 ≠ 用户会打的字**

接线接完了，浏览器实测时才发现第二个问题：
在命令面板里打「缩放」，**一条都搜不到**。

因为菜单文案用的是系统惯例（「放大 / 缩小 / 实际大小」），
而用户在这个功能的中文名是「缩放」——
**显示名与用户会搜的词不是一回事**。

修法是往 `keywords` 里补「缩放」「字号」，
而不是把 label 改成「缩放」——
label 要跟着菜单文案走（同一个动作在两处的叫法应该一致），
`keywords` 才是给搜索用的。

命令面板的匹配是**分档**的：label 前缀 > label 子串 > keyword 前缀 > keyword 子串 > 散落子序列，
keyword 命中要 **+100** 分。所以 keyword 里的词是「兜底入口」，
不会把 label 的精确匹配挤下去。

### 一个容易踩的坑：意图处理器读的是**过期快照**

意图处理器写在 `useEffect` 里，闭包捕获的是当次渲染的 `settings`。
如果缩放读的是闭包里的 `settings.appearance.fontSize`：

```
按一次 ⌘=  →  16 → 17   ✅
再按一次 ⌘=  →  17 → 17   ❌ 还是 17（闭包里还是那个旧的 16）
```

因为 `update()` 触发的重渲染**未必**在两次按键之间落地，
闭包里的值还是旧的。

修法是读 **store 的当前值**（`readSettings()`）——
`updateSettings()` 是**同步**改模块级 state 的，所以第二次一定读到 17。

这不是「顺手写对了」，而是**必须有测试守着**：
`tests/app.test.tsx` 里那条「连续两次放大是放两档，不是一档」就是它。

### 守卫：菜单动作的覆盖度（`tests/menu-coverage.test.tsx`）

病根是「清单 ↔ 处理者」这条边没人守。现在补上了：

| 环节 | 谁在守 |
|---|---|
| `menu.rs` 建的菜单项 ↔ `shortcuts.rs` 的 `MENU_ITEM_IDS` | Rust 测试（手工同步的清单） |
| `MENU_ITEM_IDS` ↔ `shortcuts.json` 的 `actions` | Rust 测试 |
| `shortcuts.json` ↔ `src/shortcuts.ts` 的 `MENU_ACTION_IDS` | `pnpm gen:shortcuts --check` |
| **`MENU_ACTION_IDS` ↔ 前端真的有人处理** | **← 本轮新增** |

守卫查的是**运行时注册表**（`subscribedMenuActions()`），不是扫源码。

一开始写的是扫源码（grep `onMenuAction("…")`），
**被注释骗了**：把处理者注释掉，grep 照样能搜到 → 守卫照样绿 →
而那个菜单项在真实运行时还是死的。

换成运行时注册表之后，注释骗不过它了。
守卫还带一条**自检**（注册数不为零），防止「App 根本没挂上」造成的假绿。

实测：删掉 `zoom-out` 的处理者 → 守卫立刻报
`这些菜单动作注册了却没人处理：zoom-out`。

### 顺带记一笔：为什么 `actionId` 字段一直没人读

`src/shortcuts.ts` 的 `SHORTCUTS` 表里有一列 `actionId`，
除了 `src/shortcuts.ts` 自己，**没人读它**。

原因是它本来就不是运行时路径：加速键由 `scripts/gen-shortcuts.ts`
从注册表**生成**到 `src-tauri/shortcuts.json`，Rust 侧读那个文件。
`actionId` 的实际作用是「让生成脚本知道这个功能对应哪个原生菜单动作」，
不是「前端靠它派发」。所以它一直没人读是**正常的**，
不是又一个断掉的链路。

## 当前状态

M0 已完成（2026-10-20），**M1 已收官（2026-10-21）**，M2 写作体验实施中（2026-10-22）：

- 编辑内核从 Milkdown 改选 **CodeMirror 6**（理由见上）；
  **2026-10-21 用户正式拍板选 B**，判据是三条架构红线
- Live Preview 装饰器已跑通：行内标记隐藏/展开、块级标记弱化、标题层级渲染
- 源码模式 ↔ 实时预览切换已验证**光标位置精确保留**
- 三种标记符显示策略（`live` / `dimmed` / `source`）已实现并实测
- **中文输入法已由用户在真机验证通过**（2026-10-21）——
  这是 M1 唯一可能推翻架构的阻塞项，现已解除。
  注：浏览器合成事件的 `type` 动作不等价于 IME 组字过程，只能靠真机验证。
- 自动配对已实现（`off` / `basic` / `markdown` 三档，运行时可切换）
- 撤销/重做与 Live Preview 装饰器重算的交互已补测试
- 复制粘贴已实现：HTML → Markdown（turndown + 样式净化）、纯 Markdown 原样保留
- **lezer 增量解析已落地**：击键成本降 3 倍
  （4000 行 4.58ms → 1.53ms；浏览器实测 6798 行 dispatch p95 = 2.90ms），
  900 轮随机编辑对拍与全量解析 **0% 不一致**
- **剪贴板已收官**：⌘C 同时写 `text/plain`（Markdown 源码）+
  `text/html`（渲染后 HTML）+ 内部 MIME `text/x-inkstone-markdown`（逐字节无损）；
  「粘贴为纯文本」用一次性 StateField 标志，用完即焚

M2 已完成：

- **M2-1 块级渲染层骨架**：`src/editor/render/`，代码块已能渲染 + 点击切回源码
- **M2-2 代码高亮**：highlight.js `lib/core` + 30 语言显式注册，
  生产产物已实证 token 正常（换库理由见上）
- **M2-3 块级公式**：KaTeX 按需加载 + `refreshRendering` 触发重算；
  定位规则逐条对着 remark-math 实测对齐（含「未闭合吞到文末」「剥公共缩进保相对缩进」）；
  生产产物已实证 align 对齐环境 / 上标 / 错误标记三种形态
- **M2-3b 行内公式**：定位用**逐行 remark 解析**（只解析含 `$` 的行），
  等价于全文解析这件事由 52 个**对拍用例**保证（13 份语料 × 2 开关值 + 26 片段 × 2）；
  定界符策略用上游 `singleDollarTextMath`，做成设置项「单 $ 也当行内公式」，默认开

- **M2-5 表格 + 任务列表**：表格渲染；任务列表点击勾选写回源码
- **M2-6 大纲面板 + 字数统计**：走 mdast + 250ms 防抖，CJK 友好
- **M2-8 列表续行 / 有序列表自动编号**：Enter 带列表符号、Tab/Shift-Tab 缩进
- **M2-9 脚注**：编号渲染 + 双向跳转（定义留在原文位置，Typora 做法）；
  lezer 不认脚注且节点形态会随文档别处变化，改走行扫描——三条坑见上
- **M2-10 图片**：拖放 / 剪贴板粘贴 → Rust 存盘到 `<文档目录>/assets/`；
  不用 Tauri `asset://`（scope 本质是 WebView 可读目录白名单），字节走 base64 文本通道
- **M2-11 焦点模式 / 打字机模式 + Emoji 补全**：
  焦点用 `Decoration.line`（块级 widget 内部能整体弱化，字符样式做不到）；
  Emoji 1914 条含 716 条中文别名，按需 `import()` 独立 chunk；
  `filter: false` 是**能不能弹出来**的问题而非优化，理由见上

M2 全部完成。**M2-4 Mermaid 图表**已做（按需加载的独立 chunk），
HTML 导出的公式渲染也已做（HTML 导出内嵌 KaTeX，见下文 M4 段）。
M2 只剩一项**未做**：装饰器**局部重建**（段落级增量渲染）——
2026-10-27 量过收益后决定暂缓，理由与触发条件见上文
「『装饰器局部重建』：先量收益，再决定做不做」。

M3 进行中（文件管理）：

- **目录浏览 API**（Rust）：自然序排序、目录在前、只列一层
- **侧边栏文件树**：按需展开（不递归）、树根跟随当前文档、搜索根跟树根走
- **全局搜索**（Rust）：1001 个文件 **12.9ms**（预算 200ms，用掉 6.5%）；
  命中上限 500 / 文件上限 5MB / 文件数上限 20000；列号按**字符**算（CJK 友好）
- **快速打开 ⌘P**：模糊匹配**文件名**（不匹配完整路径），空查询列最近文件
- **查找 / 替换**：原生菜单 + 命令面板 + ⌘F 三入口统一到命令表；
  CM6 的 `openSearchPanel` 首次打开时不挪焦点，自己接管（见上文 M3 段）
- **自动保存 + 崩溃恢复**：防抖保存 / 节流快照，两个真 bug 一并修掉（见上文 M3 段）
- **文件监听 + 冲突提示**：轮询检测外部修改，三种情形分别处理（见上文 M3 段）
- **多标签页**：文档 store 改成标签页模型（对外仍是「当前页」的投影，既有消费方一行没改）；
  每页独立的撤销历史（换整个 EditorState）、独立的脏标记；
  崩溃恢复存整个会话

M3 全部完成（2026-10-23）。M4（导出）进行中（2026-10-25）：

- **导出项注册表**（`src/export/registry.ts`）：HTML / PDF / pandoc 七种格式，
  按 `kind` 分三条路径（前端产出 / pandoc 进程 / WebView 打印），
  三者失败模式不同，UI 分别对待
- **pandoc 桥**（`src-tauri/src/pandoc.rs`）：独立进程调用（GPL 不传染），
  二进制不经 JS 边界（Markdown 从 stdin 进、pandoc 直接写目标文件）；
  显式对齐 `tex_math_dollars` 扩展；pandoc 的警告如实带回给用户
  （实测：转 Word 时块级公式会降级成 TeX 源码）
- **HTML 导出**（`src/export/html.ts`）：单文件自包含网页，内嵌主题 CSS +
  代码高亮（复用编辑器同一套 highlight.js）+ KaTeX 公式 + 可选大纲 +
  可追加 head/body
- **导出变量系统**：`${title}` `${author}` `${today}` 等，只在**导出产物**上替换，
  绝不碰文档正文；未定义的变量原样保留
- **YAML front matter 覆盖导出设置**：默认关闭；开启后只开放安全的那几项，
  不开放「导出后自动打开文件/文件夹」（安全边界）
- **PDF 导出**：本机无 LaTeX/wkhtmltopdf（实测全无）→ 走 macOS 系统打印面板
  （临时 WebView 窗口 + `print()` + `@page { size }`）
- **导出面板 UI**：⌘⇧E / 原生菜单「文件 → 导出…」/ 命令面板三入口；
  pandoc 未安装时那一组显示为不可用并说明原因（不藏起来，也不点了才报错）
- **验收**：同一份文档导出 HTML 与 DOCX，内容语义一致——已用真实 pandoc 实证
  （标题/粗体/斜体/代码/公式/表格全部保真）
- **验收（浏览器 UI，2026-10-25）**：逐项走通 + 产物 63 KB 在浏览器里目视核对
  （大纲/标题/粗斜体/删除线/列表/引用/代码高亮/行内与块级公式/表格/任务列表/页脚全对）；
  过程中修掉三个真 bug：设置面板 grid 行未钉死、原生菜单加速键与 CM6 撞车、测试文件混入裸控制字节
- **已知缺口**（非 M4）：`==高亮==` 解析层不支持，编辑器与导出**一致**地显示为字面量；
  但「高亮」命令与 `settings.markdown.highlight` 开关目前无效
  → **解析层与命令已于 2026-10-26 补齐**（见上文「`==高亮==`」段）；
  **开关仍未接线**（见下文「设置面板里的摆设开关」）

**M4 全部完成（2026-10-25）**。M4-7「导出项可自定义」是最后一项：

- **三层分离**：格式（注册表）/ 设置（`export.items`）/ 解析结果（`ResolvedExportItem`）；
  上层只认解析结果，「设置里写了什么」与「实际能用什么」不会分叉
- **增删重排改名**：设置面板的「导出项」分区；移除用 `visible: false`
  而非删除条目（条目信息不丢，设置面板能列进「已移除」一栏）
- **绑定快捷键**：规范形式 `Mod-Shift-1`（`Mod` 跟平台走）；
  20 条保留键全部拒绝绑定，**原生菜单的加速键也在表里**（NSApp 吃掉，webview 收不到）
- **可添加的额外 pandoc 格式 12 种**（html5/gfm/commonmark/docbook/pptx/asciidoc/
  org/context/texinfo/man/dokuwiki/json），全部用本机 pandoc 3.8 实测转换过；
  id 带 `pandoc:` 前缀，避免与内置 id 撞车
- **意图总线改成判别联合**（对象带 `type`），「导出指定格式」能带参数
- **导出执行上移到 App**，面板退化成受控组件——快捷键触发的导出不经过面板，
  执行逻辑只有一处；顺带避开 `react-hooks/set-state-in-effect`
- **CM6 动态 keymap 用 Compartment**，放在主 keymap 之前（用户显式绑定压过内置键位）
- **验收（浏览器 UI）**：改名 / 重排 / 移除 / 恢复 / 添加 / 绑快捷键 / 冲突提示
  逐项实测；导出面板最终态确认（改名与顺序生效、RTF 已消失、pandoc:gfm 已加入）


**AI 面板已完成（2026-10-25）**。把已有的 2100 行 AI 后端接成了用户能用的功能：

- **面板**（`src/views/AiPanel.tsx` + `src/ai/panel-store.ts`）：
  改写（润色 / 扩写 / 缩写 / 翻译 / 正式语气）+ 总结（一句话摘要 / 大纲 / 标签 / 要点）；
  入口三个：工具栏「AI」按钮、命令面板（`ai.open` / `ai.rewrite` / `ai.summarize`）、意图总线
- **上下文实时显示**：选区 / 当前段落 / 章节「标题」/ 整篇文档，按 mdast 切片（红线 3）
- **写回前核对原文**：用户改过就拒绝覆盖；接受走**普通事务**（可 ⌘Z 撤销）
- **浏览器降级**：无 Tauri 运行时时走前端 fetch，**只支持本地端点**；
  前端有一份 SSE 帧解码器（`src/ai/sse.ts`），与 Rust 那份按同一份规格写
- **本地端点免密钥**（`billing: local-free` → `auth.kind: none`）
- **补上了两个摆设**：设置里的 `maxOutputTokens` 与 `temperature` 之前从没进过请求体
- **验收（真实本机模型）**：Ollama `qwen3.8:27b-mlx` 端到端走通——
  改写「流式 → 预览（文档不动）→ 替换段落 → ⌘Z 撤销还原」，
  总结「流式 → 预览 → 追加到文末」

**M5 跨平台进行中（2026-10-25）**：

- **M5-1 开仓地基**：公开仓库 `erongcao/inkstone` 已建并推 main；
  README 重写、CHANGELOG、release workflow（tag 触发，三平台产出，draft release）；
  CI 首跑暴露「Rust job 漏了 pnpm 引导」→ 已修（`pnpm: command not found`）
- **M5-2 快捷键映射层**：`src/shortcuts.ts` 成为**唯一真相源**，
  五处手抄的键位全部改为派生（详见上文 M5-2 段）；
  顺带修掉两个**静默失效**：「替换」的 ⌘H 被系统「隐藏」吃掉、
  「放大」的 `CmdOrCtrl+Plus` 解析失败被吞掉
- **M5-3 界面国际化**：手写轻量 `t()`，零依赖；
  三种语言（简 / 繁 / 英），M5-3 落地时 426 条文案、M5-5 后 486 条；
  语言存在 `settings.general.language`（那个字段早就存在但**一直没接线**）；
  原生菜单另有一张 Rust 侧文案表，`set_locale` 命令通知重建；
  顺带修掉五个**静默失效**：两份字典键集漂移（繁体露简体 50 多处）、
  拼接文案对不上字典、陈旧键、**模块常量在定义处翻译**（页签永远是英文）、
  **插值漏译**（按钮正文英文、悬停提示中文）（详见上文 M5-3 段）；
  四道闸门：字典层测试 / 界面层渲染测试 / 模块作用域静态检查（已进 CI）
- **M5-4 检查更新**（最简形态）：查 GitHub Releases → 告诉用户 → 给下载页链接；
  版本比较放在 TS 那边（能被 vitest 直接测），Rust 只做一次 HTTP GET；
  原生菜单 + 命令面板两个入口，浏览器里也能直接 fetch 验收；
  顺带修好「项目主页」这个**注册了却没人处理**的死菜单项（详见上文 M5-4 段）
- **M5-5 三平台 CI 实跑**：首跑 Ubuntu + macOS 打包全绿、两个 Windows job 挂在
  **WiX 的 1252 代码页**（文件关联的中文描述进不了 MSI）→
  描述改英文，并新增 `bundle:check` 闸门（秒级拦住，详见上文 M5-5 段）；
  同轮接上「Markdown 语法参考」与「快捷键一览」两个死菜单项
  （速查表从注册表生成 / 语法表是一份实测过的数据），
  顺带修掉 `formatShortcut` 把「放大」显示成 `⌘Equal` 的错（应为 `⌘=`）
- 词典条数：426 → **486**（M5-5 新增 60 条：速查表数据 + 两个面板的外壳文案）

**`==高亮==` 已补齐（2026-10-26）**：

- Typora 同款行内高亮。remark 与 lezer **两侧**都实现了
  （lezer 侧自研 25 行扩展，flanking 判据与 remark 一致，12 条对拍断言钉住）
- Live Preview 渲染、HTML 导出 `<mark>`、round-trip 保持 `==高亮==` 原样、
  「高亮」格式命令、语法速查表——全部生效（此前是「命令在、解析层不认」）
- 顺带修掉一个**比不渲染更糟**的 bug：`remark-gfm` 默认把单个 `~` 也当删除线，
  `~下标~` 屏幕是字面量、**导出却是 `<del>下标</del>`**；现与 lezer 对齐
- `~下标~` / `^上标^` 当初也不做（要动 `~` 与 `~~` 的仲裁）——
  **已于 2026-10-27 补齐**（见下文「下标 / 上标」段）

**Markdown 扩展开关已全部接线（2026-10-26）**：

- `settings.markdown` 的 **13 个**开关里，**12 个**真的生效
  （表格 / 任务列表 / 脚注 / 高亮 / front matter / 行内公式 / 块级公式 /
  mhchem / mermaid / GitHub 提示块 / 单 `$` 定界符 / 下标上标）；
  剩下 1 个（公式自动编号）对应功能**还不存在**，
  设置面板里**置灰并写明原因**
  （下标上标原本也在置灰名单里，2026-10-27 补齐了 remark 侧）
- 开关贯穿三层：remark 语义、lezer 编辑布局、渲染与导出——
  关掉一个，那套语法在屏幕与导出里**一致地**变成字面文本
- GFM 拆开**零成本**：10 个子扩展本就是传递依赖，提升为直接依赖（`downloaded 0`）
- 顺带修掉一个既有缺口：`export/html.ts` 原来**不传**解析选项，
  导出完全不跟随用户的开关（架构约束 C 的实际破口）
- 新增 GitHub 提示块（上游 `remark-github-blockquote-alert`，MIT）
- 速查表与格式命令也跟着开关走
- 四个「看起来能跑、其实没跑」的坑记在
  「Markdown 扩展开关：13 个复选框，12 个真接线」一节

**下标 / 上标已补齐（2026-10-27）**：

- `~下标~` 与 `^上标^`（Pandoc 风格）真正生效。
  remark 侧**自研** micromark 扩展（生态里三个候选包全不行），
  规则与 lezer 自带的 `Subscript` / `Superscript` **逐条对齐**，
  29 组**两层对拍**用例钉住
- 编辑器 / 导出 / 剪贴板 / 速查表 / 格式命令全部接线；
  设置面板里从置灰变成可勾选的真开关
- 包体代价 **+2.5 KB**（0.031%）

**`tests/` 纳入类型检查（2026-10-27）**：

- `tsconfig.json` 的 `include` 原来只覆盖 `src`——
  `pnpm typecheck` 报「全绿」时**测试代码从来没被类型检查过**
- 暴露 36 处错误，其中几处是**真 bug**
  （`ensureSyntaxTree` 把 Language 当位置传、`Range` 从没导出的模块里 import、
  `fontSize` 写进错误的设置分节、`dataset` 用在 `Element` 上）
- 教训：「闸门全绿」不等于「全绿」——先确认闸门**覆盖了什么**
- 补了一条：lint 也没覆盖 `tests/`，现在 `eslint src tests --max-warnings 0`

**粘贴时的下标 / 上标已补齐（2026-10-27）**：

- turndown 默认**没有** `<sub>` / `<sup>` 规则，会丢掉标签只留内容
  （实测 `H<sub>2</sub>O` → `H2O`）——从网页 / Word 复制过来的上下标在粘贴时没了
- 转换的前提是「转出来的语法必须**自己认得出来**」，
  判据 `canWrapSubSup` 放在 `src/parser/subsup.ts`，与解析规则**同源**
- 认不出来时退回**纯内容**（不保留原始 HTML——
  实时预览不渲染行内 HTML，保留会造成屏幕与导出不一致）
- 上下标的**另一种来源**也覆盖了：`<span style="vertical-align: super">`
  （Word / Google Docs 不一定用 `<sup>` 标签），用同一条判据
- 已知缺口：Word 私有的 `mso-vert-align` 没覆盖（手上没有真机 Word 可核实）
- 新增 16 条测试：转换、退路、判据与解析器的一致性对拍、真实 paste 事件

**Word 粘贴的开头缩进修掉了（2026-10-28）**：

- 拿到了**真机 Word 15 的剪贴板 HTML**（用户从 Word 复制了一段），
  整段喂进 `htmlToMarkdown` → 结果**开头多出 8 个空格**
- 根因：turndown 解析时把 `<head>` 的内容摊平进根元素，
  而**元素之间的空白文本节点**会被塌成一个个空格；
  turndown 的 `blankRule` 又在**同层级有 void 元素时**不删空白节点
  （Word 的 head 里全是 `<meta>` / `<link>`）
- 那 8 个空格：粘到行首是**缩进代码块**，粘到行中间是**行尾硬换行**
- 修法：只取 `<body>` 交给 turndown + 摘掉首尾空白节点
  （只取 body 还不够：正文里有 `<img>` / `<br>` 时例外照样触发）
- 测试：`tests/fixtures/word-clipboard.html` 是真机 Word 的剪贴板 HTML
  （结构原样保留，可见文字与本机路径都换成占位），
  6 条新测试里 **5 条在旧实现下会红**（写完故意退回旧实现验过）
- 顺带纠正一条**之前记错**的：Word 私有的 `mso-vert-align` 缺口**仍然开着**
  ——这次复制的段落不含上下标，只是现在知道 Word 的 HTML 长什么样了

**死菜单项已修完（2026-10-28）**：

- 本轮挖出**四个**死菜单项：`toggle-source-mode` / `zoom-in` / `zoom-out` / `zoom-reset`
  ——注册了、加速键也登记了，但前端**没人订阅**，点了没反应也不报错
- 病根：`action()` 只检查「id 在不在清单里」，
  **管不到「有没有人真的处理它」**（M5-5 记过这个盲区，本轮补上）
- 接线原则是「菜单与命令面板**同源**」：统一接到意图总线，
  两条入口落同一处。缩放因此第一次有了命令面板入口
- 缩放按 `FONT_SIZE_PRESETS` 的**预设档位**走（设置面板的字号是下拉框，
  ±1px 会跳到列表里不存在的值），改的是 `appearance.fontSize`
  （`--ink-font-size` 挂在 `html` 上，整个应用跟随）
- **守卫**（`tests/menu-coverage.test.tsx`）：查**运行时注册表**而不是扫源码——
  扫源码会被注释骗。另带一条自检防假绿
- 浏览器实测：放大 → `--ink-font-size: 17px`；实际大小 → `16px`；
  源码模式 → 工具栏切到「源码模式」
- 顺带一个实测才发现的坑：命令面板里搜「缩放」**一条都搜不到**
  （菜单文案是系统惯例的「放大 / 缩小 / 实际大小」）——
  **显示名 ≠ 用户会搜的字**，keywords 补上「缩放」「字号」
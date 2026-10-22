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

## Live Preview 性能：实测数据与优化结论（2026-10-21）

### 成本分布（`scripts/bench-decorations.ts`）

| 文档规模 | 语法节点 | lezer 全量解析 | 三次树遍历 | 完整管线 p95 | 装饰器数 |
| --- | --- | --- | --- | --- | --- |
| 500 行 / 13 KB | 1097 | 0.93ms | 0.19ms | 0.99ms | 638 |
| 1500 行 / 32 KB | 2741 | 1.47ms | 0.27ms | 1.84ms | 1595 |
| 4000 行 / 90 KB | 7673 | 3.25ms | 0.87ms | 4.36ms | 4466 |

**解析占 64%~72%**，是管线里最大的单点成本 → 所以先做增量解析。

### 优化后的实测（真实浏览器，`perf.html`）

| 场景 | 装饰器 | dispatch 同步 p95 | 击键→下一帧绘制 p95 |
| --- | --- | --- | --- |
| 小文档 83 行 | 150 | 0.40ms | 10.10ms |
| 中文档 1018 行 | 1800 | 0.70ms | 10.00ms |
| 大文档 6798 行 | 12000 | 2.90ms | 7.20ms |

node 侧的管线成本对比（同一次击键）：

| 规模 | 全量解析路径 | 增量解析路径 |
| --- | --- | --- |
| 500 行 | 1.13ms | **0.31ms** |
| 1500 行 | 1.91ms | **0.52ms** |
| 4000 行 | 4.58ms | **1.53ms** |

### 已实施的优化

1. **增量解析**（`src/editor/live-preview/syntax-tree.ts`）——3 倍加速
2. **三次 `tree.iterate()` 合并成一次**——省掉 2/3 的遍历成本（4000 行省 0.83ms）。
   合并时用三个桶分别收集，最后按「行内 → 块级 → 标题」的顺序合并，
   **与重构前三次独立遍历的推送顺序完全一致**，因此重叠样式的叠放结果不变。
3. **`INLINE_MARKERS.find()` 换成 Map 查找**——每节点一次线性查找改成 O(1)。

### 为什么**没有**做「装饰器按可见区缓存」

计划书里写了这一项，实测后**决定不做**，理由：

- 收益有限：裁剪到视口最多再省 ~2.5ms（6800 行 2.90ms → 约 0.4ms），
  而 2.90ms 只占 16ms 交互预算的 18%，用户无感知。
- 代价明确：不可见区域不生成装饰器 → 滚动进视野时**标记会闪现**，
  这是明显的体验倒退。
- 收益来源判断错误：装饰器数量主要影响**构建**成本，不影响**渲染**成本——
  CM6 只为视口内的行建 DOM，视口外没有 DOM 要更新。
  实测也印证：12000 个装饰器的大文档，击键→绘制延迟与小文档**没有差异**。

**正确的做法是 M2 的「段落级增量渲染」**：不是裁剪装饰器，
而是文档变更时只重建受影响区间的装饰器（`DecorationSet.map` + 局部重建），
所有区域始终有装饰器，因此没有闪烁。

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
pnpm licenses:check # 依赖许可证白名单
cd src-tauri && cargo fmt --check && cargo clippy --all-targets
```

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

## 目录

```
src/parser/     Markdown 解析层（唯一语义来源，remark/mdast）
src/editor/     编辑内核（CM6 封装 + live-preview 装饰器插件）
  └ render/     块级渲染层（M2：代码块 / 表格 / 公式 / 图表 共用的机制）
src/renderer/   渲染层（高亮/公式/图表）
src/export/     导出管线
src/settings/   设置模型与存储
src/theme/      主题注册表与运行时
src/ipc/        与 Rust 侧接口
src/dev/        开发期测量台（不进生产包）
src-tauri/src/  Rust 后端（document / menu / recent）
tests/corpus/   round-trip 语料库
scripts/        开发工具脚本（bench-parser / bench-decorations / verify-incremental / dump-lezer-tree / check-licenses）
perf.html       Live Preview 性能测量台（vite dev 下访问 /perf.html）
docs/           计划书与调研文档
```

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

M2 剩余待办：Mermaid 图表、表格 + 任务列表交互、
大纲面板 + 字数统计、斜杠菜单 / 命令面板 + 链接浮层、列表续行 / 自动编号、
脚注、图片拖放、焦点模式 + Emoji。
另：装饰器**局部重建**（段落级增量渲染）仍未做，是 M2 的性能项；
HTML 导出的公式渲染（rehype-katex）也还没接。


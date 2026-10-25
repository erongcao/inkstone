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

## 目录

```
src/parser/     Markdown 解析层（唯一语义来源，remark/mdast）
src/editor/     编辑内核（CM6 封装 + live-preview 装饰器插件）
  └ render/     块级渲染层（M2：代码块 / 表格 / 公式 / 图表 共用的机制）
src/renderer/   渲染层（高亮/公式/图表）
src/export/     导出管线（M4：注册表 / 变量 / front matter / HTML / PDF）
src/settings/   设置模型与存储
src/theme/      主题注册表与运行时
src/ipc/        与 Rust 侧接口
src/document/   文档生命周期（自动保存 / 崩溃恢复 / 外部修改冲突）
src/dev/        开发期测量台（不进生产包）
src-tauri/src/  Rust 后端（document / menu / recent / fs / search / watch / pandoc / print）
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

M2 只剩：**M2-4 Mermaid 图表**。
另有两项未做：装饰器**局部重建**（段落级增量渲染，是 M2 的性能项）；
HTML 导出的公式渲染（rehype-katex）。

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


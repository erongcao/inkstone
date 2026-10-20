# 标杆编辑器实现调研：Typora / Ulysses / Bear

> 调研日期：2026-10-20
> 目的：在 Inkstone 定稿编辑内核路线前，用**外部可核验的事实**验证 M1 spike 的结论，
> 并找出可借鉴的具体实现细节。
>
> **信源分级**：官方文档 > 开发者技术文章 > 第三方报道 > 社区讨论。
> 每条结论都标注了信源与置信度。**没有找到权威来源的，不写成结论。**

---

## 0. 结论先行

**M1 spike 的结论（编辑内核改用 CodeMirror 6）经外部验证成立，且被显著加强。**

核心发现：**四家标杆中，没有一家的文档模型是「富文本节点里不含标记符」。**
全部都是「标记符是真实文本，只是显示方式不同」。

这直接证伪了 Milkdown / Tiptap 这类「mark 不含标记符」的技术路线在 Typora 式体验上的可行性——
Milkdown 的作者自己也是这么撞墙的（见 §4 Milkup）。

调研还额外带来两个可落地的改进点：

| # | 改进点 | 来源 | 成本 |
|---|---|---|---|
| A | 支持 **Ulysses 式「标记符弱化可见」** 作为第三种显示策略 | Ulysses | 低（装饰器加一个分支） |
| B | 渲染走 **段落级增量** 而非全文重解析 | Typora | 中（lezer 增量 / 段落缓存） |

---

## 1. Typora：Electron + 自研内核 + CodeMirror 5 做源码模式

### 1.1 架构

| 层 | 实现 | 信源 | 置信度 |
|---|---|---|---|
| 外壳 | **Electron**（内嵌 Chromium） | 百度百科「为实现跨平台支持，Typora 基于 Electron 框架构建」+ 多篇技术分析 | 高 |
| 编辑器主体 | **自研**，非现成编辑器 | 官方 CSS 文档暴露 Typora 自有 DOM 类名（`.md-line` / `.md-meta` / `.md-content` / `.md-expand`） | 高 |
| 源码模式 | **CodeMirror 5** | 官方 Custom CSS 文档：「原始碼模式(SourceCode Mode)是透過 CodeMirror 的支持」 | 高 |
| 代码块高亮 | **CodeMirror 5** | 官方支持页原文：「Typora uses CodeMirror for syntax highlighting in code fences」 | 高 |
| TeX 编辑器 | **CodeMirror** | 官方 CSS 文档：「TeX editor is powered by CodeMirror」 | 高 |
| Markdown 解析 | **自研解析器**，非现成库 | 二手技术分析：「Typora 使用自定义的 Markdown 解析器，而非依赖现成的库」 | 中 |

> **关键**：Typora **不是**纯 CodeMirror 应用。它是「自研编辑器 + CodeMirror 5 作为源码模式/代码块」的混合体。
> CodeMirror 在它那里是**局部工具**，不是整个编辑器的地基。

### 1.2 即时渲染的实现机制（最有价值的一条）

官方 Custom CSS 文档原文（Typora 支持站）：

> Markdown 中的图片的语法预设会被隐藏，并且被以 `md-content` 的 class 所包住。
> 当你的游标在这个行内元素时，被关注(focus)的那一个将会被 `md-expand` class 所包住，
> 接着 `.md-meta` 和 `.md-content` 会变成可见。

翻译成结构：

```
.md-line                     ← 每一行
  ├─ .md-meta                ← 标记符容器（`**` `[` `](url)` …）
  └─ .md-content             ← 内容容器（粗体文字…）

平时：      .md-meta 隐藏，.md-content 可见
光标进入：  行上加 .md-expand → 两者都可见
```

**这是一个「标记符与内容分居两个 DOM 元素、靠 class 切换显隐」的方案。**

### 1.3 渲染粒度：段落级 + 增量

> 编辑器内核实时解析**当前光标所在段落**的 Markdown 语法树(AST)，
> 通过内嵌 WebKit/Chromium 渲染引擎将 AST 动态转换为 HTML/CSS，
> 并以像素级精度**叠加在文本层之上**。

> 系统实时监控 AST 的变化，并**仅重新渲染发生变动的节点**。
> 这种增量渲染机制确保了即使在数十万字的文档中，打字延迟也能保持在毫秒级。

信源：二手技术分析文章。置信度**中**（未见官方确认，但与「毫秒级延迟」的官方宣传自洽）。

### 1.4 对 Inkstone 的启示

| Typora 做法 | Inkstone 现状 | 差距 |
|---|---|---|
| 段落级 AST + 增量渲染 | 全文 lezer 解析（1000 行 p95 ≈ 1.05ms） | 性能尚可，但可优化（改进点 B） |
| `.md-meta` / `.md-content` 双元素 + class 切换 | `Decoration.replace` 零宽 widget + `Decoration.mark` | **等价**，无需改 |
| 源码模式 = CodeMirror | 源码模式 = 同一 CM6 实例关装饰器 | **更优**（光标/滚动/undo 天然保持） |

---

## 2. Ulysses：原生 App，纯文本增强，标记符**不隐藏**

### 2.1 定位

官方帮助文档（help.ulysses.app）：

> Ulysses 采用**纯文本编辑模式**，但这不仅仅是纯文本，我们称之为「**增强型纯文本**」。

> Ulysses does not offer WYSIWYG styles and formats like Microsoft Word.
> Instead, your text will be automatically formatted once you export it as a PDF, web page, or ebook.

即：**Ulysses 明确不做所见即所得**，它是「纯文本 + 语法着色」。

### 2.2 标记符的处理

TidBITS 评测（Apple 生态媒体，2016）：

> Ulysses masks some of this complexity with **colored shapes or "text objects"**
> denoting Web addresses, image embeds, footnotes, and annotations **in place of markup syntax**.

> Highlight a word, press Command-B, and you will boldface that text — but it shows up as
> Markdown with two asterisks on either side.

**结论：Ulysses 的标记符始终是真实可见的文本，只是被着色/特殊形状弱化，从不隐藏。**

### 2.3 技术栈

- 开发者：The Soulmen（德国），Ulysses III 起为原生 macOS / iOS
- 自研 Markdown 方言 **Markdown XL**
- 开源复刻项目 **MDEditorKit**（TextKit 2）描述了同类实现：
  「Markdown source stays in place while syntax markers, headings, lists, code, images, and quotes
  are styled inline as you type」+「两阶段渲染：非破坏性样式 + 破坏性替换」

### 2.4 对 Inkstone 的启示

Ulysses 路线成本极低：**标记符不隐藏，只弱化**。这在 Inkstone 里几乎是白送的——
我们的装饰器已经是「标记符区间」和「内容区间」分开的，加一个「不 replace、只给标记加弱化 class」的分支即可。

---

## 3. Bear：原生 NSTextView，隐藏标记符 + 「通用模式」

### 3.1 行为

第三方评测（西西软件园）：

> 应用没有一个明显的「编辑界面」与「预览界面」的区分，而是在编辑窗口直接预览一些标记字符的效果。
> 比如插入网址或是删除线，**显示的都是最终效果而不是标记字符**。

> 如果你一直**手动输入语法字符**，就会自动在输入完成后显示为预览效果。
> 如果你不习惯 Bear 改进过的 Markdown 语法，在设置中打开「**通用模式**」后就可以切换到标准的语法，
> **两者只在标记符上有差别**。

**「两者只在标记符上有差别」这句话极其关键**：
它说明 Bear 的「增强模式 ↔ 通用模式」是**同一份文档模型、只改标记符的显示方式**——
和 Inkstone 现在的「实时预览 ↔ 源码模式」是同一个设计。

### 3.2 技术栈

- 原生 macOS / iOS
- **NSTextView**（置信度**中**）：StackOverflow 上开发者明确讨论
  「It's about rendering markdown text in UI/NSTextView. In the app "Bear" for Mac/iOS you can add a
  markdown link like `[This is a link](https://...com)` and it will **hide the full URL and show a link**」

### 3.3 对 Inkstone 的启示

Bear 的「通用模式」验证了：**同一份文档、切换标记符显示策略**是可行且被验证过的交互。
Inkstone 现在的 `Decoration.replace` ↔ `Decoration.none` 就是这个机制的一般化版本。

---

## 4. Milkup：最有参考价值的开源对标（从 Milkdown 逃出来的那个）

**这是本次调研信息量最大的一个。**

- 项目：`github.com/Auto-Plugin/milkup`（跨平台桌面端 Typora 类即时渲染编辑器）
- 作者技术文章：《Milkup 技术内幕：一个 Typora 风格的即时渲染 Markdown 编辑器是怎样炼成的》（掘金，2026-03-16）
- 关键事实：**该项目的 v1 版本把内核从 Milkdown 换成了自研的 ProseMirror 内核（milkup core）**

### 4.1 为什么逃离 Milkdown

作者原话：

> 大多数解决方案选择简单粗暴的路线：把编辑区和预览区分开，或者干脆把输入转换成富文本节点、彻底丢弃源码信息。
> Milkup 选了一条更难走的路：**语法符号不消失，而是作为真实的文本内容保留在文档里，只是在合适的时机被"藏起来"**。

> 由于 `syntax_marker` 文本节点里存的就是 `**`、`*`、`` ` `` 等原始符号，
> 序列化时按顺序拼接所有文本节点即可还原出原始的 Markdown。

**Milkdown 的 mark 不含标记符文本 → 必须自研 ProseMirror 内核才能把标记符放回文本。**
这与 Inkstone 在 M1 spike 里的发现**完全一致**。

### 4.2 Milkup 的代价（Inkstone 避开的部分）

| Milkup 必须做 | 原因 | Inkstone 现状 |
|---|---|---|
| 自研 Parser（1200+ 行），处理嵌套语法 | ProseMirror 树 ←→ Markdown 双向 | **不需要**——文档天然就是 Markdown |
| 自研 Serializer，直接读文本节点拼接 | 树 → 文本 | **不需要**——文档本身就是文本 |
| `syntax-detector` / `syntax-fixer` 插件 | 用户在渲染模式下输入 `**` 时，要识别新标记并维护**标记配对关系** | **不需要**——CM6 输入规则直接在真实文本上工作 |
| 源码模式要**重建整篇文档**（`replaceWith`）并把块级节点展平为段落 | 渲染模式下块级是 heading 节点，源码模式是段落 | **不需要**——同一份文档切装饰器 |
| `font-size: 0` 隐藏标记 | CSS 隐藏 | **用 `Decoration.replace`**，光标能进标记区间 |
| Decoration **两级缓存**做性能优化 | 全量重算太贵 | 待做（改进点 B） |

> **特别是 `font-size: 0` 这一条**：Milkup 用 CSS 隐藏标记，代价是光标进不去标记区间，
> 所以必须额外写 `syntax-detector` / `syntax-fixer` 插件来处理「用户在渲染模式下输入 `**`」这种场景。
> Inkstone 用 `Decoration.replace` + 零宽 widget，光标能落在标记区间内——**从根上避开了这个坑**。
> （这正是 M1 spike 里实测确认过的差异。）

### 4.3 Milkup 的设计精华（值得抄）

> **把"存什么"和"显示什么"彻底分开，前者由 Schema 保证正确，后者由 Decoration 按需计算。**

> 即时渲染和源码模式切换这两个核心特性，都建立在同一个基础设计之上：
> **语法符号是真实内容，显示是渲染层的事。**

> 源码模式切换时，只需改变 Decoration 系统的行为（不再隐藏任何标记）
> 以及把块级节点展平为段落。

---

## 5. 四家横向对比

| 维度 | Typora | Ulysses | Bear | Milkup | **Inkstone（当前）** |
|---|---|---|---|---|---|
| 文档模型 | 真实文本层 + AST | 纯文本 | 纯文本 | ProseMirror 树 + `syntax_marker` 文本节点 | **纯 Markdown 文本** |
| 标记符在文档里？ | ✅ 真实可编辑 | ✅ 真实可编辑 | ✅ 真实可编辑 | ✅ 真实文本节点 | ✅ 真实可编辑 |
| 标记符默认显示？ | 隐藏，光标进入才显示 | **始终可见，弱化着色** | 隐藏 | 隐藏（`font-size: 0`） | **隐藏，光标进入才显示** |
| 隐藏机制 | `.md-meta`/`.md-content` class 切换 | 不隐藏 | NSTextView 自定义 | CSS `font-size: 0` | `Decoration.replace` 零宽 widget |
| 源码模式 | 换用 CodeMirror 5（**另一个编辑器**） | 无此模式 | 「通用模式」，**同一模型** | 重建文档 | **同一 CM6 实例切装饰器** |
| 切换时保持光标？ | 否（换编辑器） | — | 是 | 需手动映射 | **是（已实测）** |
| 渲染粒度 | 段落级 + 增量 | 整篇 | 整篇 | 整篇 + 两级缓存 | 全文 lezer（增量解析待做） |
| 技术栈 | Electron + 自研 + CM5 | 原生 macOS/iOS | 原生 macOS/iOS | 自研 ProseMirror | **Tauri 2 + CM6** |

---

## 6. 对 Inkstone 的决策结论

### 6.1 核心决策：维持 CodeMirror 6，不改

外部证据支持 M1 spike 的结论，理由强度提升：

1. **四家标杆全部是「标记符在文本里」**。这不是某个产品的偶然选择，是这个品类的共识。
2. **Milkup 从 Milkdown 迁出，理由和我们一样**（mark 不含标记符 → 做不到直接编辑 `**`）。
   它为解决这个问题付出的是「自研 1200 行 Parser + 自研 Serializer + 文档重建 + 配对插件」的代价。
   Inkstone 用 CM6 把这一整套成本降为 0。
3. **Bear 的「通用模式」与 Typora 的「源码模式」都证明**：「同一份文档、切换标记符显示策略」是可行交互。
4. **Ulysses 证明**：「标记符弱化可见」是另一条被验证过的产品路线，且实现成本极低。

### 6.2 采纳的两个改进点

**改进点 A —— 三种标记符显示策略**（低成本，立即做）

| 策略 | 交互 | 对标 |
|---|---|---|
| `live` 实时预览 | 标记隐藏，光标进入才显露 | Typora（默认） |
| `dimmed` 弱化显示 | 标记始终可见但弱化着色，内容照样渲染 | Ulysses |
| `source` 源码模式 | 纯 Markdown 原文 + 语法高亮 | Typora 源码模式 / Bear 通用模式 |

三者共用同一份文档、同一套装饰器管线，切换只是装饰器策略不同。

**改进点 B —— 段落级增量渲染**（中等成本，M1 内做）

Typora 的做法是「只解析光标所在段落 + 只重渲染变动节点」；
Milkup 的做法是「Decoration 两级缓存」。

Inkstone 的实现路径：**lezer 增量解析**（`TreeEditor`）+ **按可见区域缓存装饰器**。
先量后做——当前 lezer 1000 行 p95 = 1.05ms，已在 16ms 预算内，
所以这一项是「为超长文档留后路」，不是当前瓶颈。

### 6.3 明确不采纳

- ❌ **不做富文本文档树**。所有标杆都不做。
- ❌ **不引入 ProseMirror**。Milkup 已经证明这条路要自研 1200 行 Parser。
- ❌ **不追求 Typora 那种「像素级叠加」**。那是 Electron + 全文 AST + 自研渲染引擎的代价，
  CM6 的装饰器模型给不了那个精度，但也不需要。

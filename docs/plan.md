# Inkstone — 开源 Markdown 编辑器 · 项目计划书 v0.1

> 状态：**待评审** ｜ 目标平台：macOS 优先 → Windows / Linux
> 对标：Typora（Live Preview 混合编辑 + 文件管理 + 导出管线）
> 调研基线：Typora 官方支持站全量文档（见 `docs/typora-feature-inventory.md`）

---

## 0. 一句话定位

**一个把 Markdown 源码当作唯一真相、却在屏幕上呈现排版效果的开源编辑器。**
不做笔记平台、不做协作、不做数据库——只做一件事：**写 Markdown 应该像写字一样舒服**。

### 三条设计红线

1. **文件即文件**。`.md` 永远是纯文本、Git 友好、任何编辑器都能打开。不引入数据库、不引入专有格式。
2. **不丢失用户的字节**。任何"美化"操作（格式化、转换）默认关闭；保存时不动用户没碰过的字符。
3. **快**。冷启动 < 1.5s，输入延迟 < 16ms（60fps），空闲内存 < 150MB。

### 当前进度：M0 已完成，M1 编辑内核实施中（2026-10-21）

| 交付项 | 状态 | 实测 |
| --- | --- | --- |
| Tauri 2 + React 19 + Vite 8 + TS 5.9 工程骨架 | ✅ | 应用包 **4.24 MiB**（Electron 方案约 200 MB） |
| 主题系统（CSS 变量令牌层 + 亮暗双模式 + 用户自定义 CSS） | ✅ | 3 套内置主题 |
| 设置面板（外观/编辑/Markdown/导出/通用，深合并持久化） | ✅ | 组件测试覆盖 |
| Markdown 解析层（remark + GFM + YAML + 数学 + 脚注） | ✅ | mdast 为唯一语义来源 |
| round-trip 无损性测试基线 | ✅ | **13 份语料** × 3 断言 + 2 条语料库护栏，**全部通过** |
| macOS 原生菜单栏（含应用菜单、快捷键、事件转发） | ✅ | Rust `on_menu_event` → 前端 |
| 文件打开/保存（原子写入）/另存为 | ✅ | 写临时文件 + rename |
| `.md` 文件关联 + 从 Finder 打开 | ✅ | Info.plist `CFBundleDocumentTypes` 已注册，端到端验证通过 |
| 最近文件记录（M3 前置） | ✅ | `recent-files.txt` 写入验证通过 |
| 依赖许可证白名单扫描 | ✅ | 1828 条（去重 675）零违规 |
| CI（lint/test/build/打包 × 4 平台） | ✅ | `.github/workflows/ci.yml` |
| 组件交互测试（jsdom） | ✅ | **152 个测试全绿** |
| **编辑内核选型 spike** | ✅ | **实测推翻原定 Milkdown，改用 CodeMirror 6**；**2026-10-21 用户正式拍板**（见 §2.3） |
| **Live Preview 装饰器** | ✅ | 行内标记隐藏/展开、块级标记弱化、标题层级渲染，浏览器内实测通过 |
| **源码模式 ↔ 混合模式** | ✅ | 同一 EditorView 切装饰器，**光标位置精确保留**（实测） |
| **三种标记符显示策略** | ✅ | `live` / `dimmed` / `source`，共用同一份文档，切换零漂移 |
| **中文输入法（真机验证）** | ✅ | **用户 2026-10-21 在真机确认中文输入无问题**——M1 最后一个架构级阻塞项解除 |
| **自动配对** | ✅ | 三档（off/basic/markdown），运行时可切；规则对齐 Typora 官方文档 + 官方视频逐帧 |
| **复制粘贴（HTML → Markdown）** | ✅ | turndown 7.22.4（MIT）+ 样式净化；Markdown 原样保留；32 个用例 |
| **剪贴板（复制为 HTML / 粘贴为纯文本）** | ✅ | ⌘C 同时写 text/plain + text/html；内部复制粘贴逐字节无损（自定义 MIME）；一次性纯文本粘贴标志 |
| **解析性能基准** | ✅ | remark 1000 行 p95 = 10.96ms 超标；lezer = 1.05ms |

**实测数据**：空闲内存 112.9 MiB（目标 < 150 MB，CM6 接入后 +11 MiB）；release 构建 37 s；应用包 **4.24 MiB**（CM6 接入前 3.70 MiB）。

**M1 待办**：表格/公式/图表渲染层（按计划推到 M2）、局部重建装饰器。
（lezer 增量解析已于 2026-10-21 落地，见 §2.3「Live Preview 性能」。）

---

## 1. 为什么现在做 / 为什么是你

| 维度 | 现状 | 机会 |
|---|---|---|
| Typora | 闭源、$14.95 一次性、macOS 原生 + Win/Linux Electron | 核心体验值得开源化 |
| Obsidian | 闭源、$50/年、插件生态强但应用本体封闭 | 本体仍是闭源 |
| Logseq / SiYuan | AGPL-3.0 | 许可证不适合衍生商业集成 |
| MarkText | MIT、62.9k star、**v0.22.0 仍在 2026-10 维护** | 最接近的 MIT 开源对标物，但仍是"所见即所得"而非 Typora 式 Live Preview |
| Zettlr | GPL-3.0、学术向工作台 | 许可证与定位都不同 |
| Milkdown | MIT、插件化 Markdown WYSIWYG 框架 | 曾是首选内核，实测发现其 mark 不含标记符文本，无法做 Typora 式直接编辑 `**` → 已改用 CodeMirror 6 |

**结论**：MIT 许可、专注 Markdown、Typora 式体验的空白位是真实存在的。

---

## 2. 技术选型

> 以下所有版本号、star 数、许可证均为 **2026-10-20 实测**（GitHub API + npm registry + crates.io），非记忆值。

### 2.1 结论先行

> ⚠️ **本节已被 M1 实测修订（2026-10-20）**：编辑内核从 Milkdown 改选 **CodeMirror 6**，
> 理由与实测数据见 §2.3。**2026-10-21 用户在 A/B 之间正式拍板选 B（CM6）**，
> 判据是本文件 §0 的三条设计红线。

| 层 | 选型 | 版本 | 许可证 | 成熟度 |
|---|---|---|---|---|
| **外壳** | **Tauri 2** | `@tauri-apps/cli` 2.12.3（2026-10-14） | Apache-2.0 | 稳定（v3 已进 alpha） |
| **编辑内核** | **CodeMirror 6** | `@codemirror/view` 6.43.15 | MIT | 事实标准（VSCode 同源） |
| **语义解析** | **remark / unified / mdast** | remark 9.0k★ | MIT | 事实标准 |
| **编辑视图布局** | **lezer / @lezer/markdown** | 1.8.1 | MIT | 活跃（CodeMirror 同源） |
| **语法高亮** | **highlight.js** | 11.12.0（2026-10-22） | BSD-3-Clause | 活跃（190 语言，§8 D8） |
| **数学公式** | **KaTeX** | v0.19.0（2026-10-01） | MIT | 活跃 |
| **图表** | **Mermaid** | 12.2.0（2026-10-13） | MIT | 活跃（90k★） |
| **HTML 净化** | **DOMPurify** | — | Apache-2.0 | 活跃 |
| **前端框架** | React 19 + Vite 8 | react 19.3.1 / vite 8.3.4 | MIT | 活跃 |
| **导出（多格式）** | **pandoc 桥** | pandoc 3.12.1 | GPL-2.0（独立进程调用，不链接） | 活跃 |
| **导出（PDF）** | WKWebView `createPDF` / WebView2 / WebKitGTK | — | 系统 API | 平台原生 |

### 2.2 外壳：为什么是 Tauri 2 而不是 Electron

| 维度 | Tauri 2 | Electron 44 | 判定 |
|---|---|---|---|
| 安装包体积 | ~10–20 MB | ~150–250 MB | **Tauri 胜** |
| 空闲内存 | ~50–80 MB | ~150–250 MB | **Tauri 胜** |
| 冷启动 | ~0.3–0.8 s | ~1.5–3 s | **Tauri 胜** |
| 工具链 | 需 Rust（brew 装，约 1.5 GB + target 3–8 GB） | 已有 Node，零新增 | **Electron 胜** |
| GitHub Releases 分发 | 小包，用户敢下载 | 大包，转化率明显下降 | **Tauri 胜** |
| macOS 原生能力 | WKWebView，可用 Swift 桥接补齐 | 原生度一般 | 平手 |
| 生态成熟度 | 插件（dialog/fs/shell/updater/opener）齐全 | 最强 | **Electron 略胜** |
| 跨平台一致性 | 强 | 强 | 平手 |

**结论选 Tauri 2**，理由三条：
1. **产品定位决定体积**。这是"替代 Typora 每天开着写"的工具，内存和冷启动是核心体验指标。
2. **开源分发的关键指标是包大小**。GitHub Releases 上的 200MB 安装包和 15MB 安装包，用户下载转化率是量级差异。
3. **Rust 后端在本题里是真需求**：跨文件全文搜索（`ignore` + `grep` crate 生态）、文件监听、图片处理、pandoc 调用、**以及 macOS 的 WKWebView `createPDF` 直出 PDF**——最后这一条正是 Typora"原生 PDF 导出"的实现路径。

**已知代价与对冲**：本机 Rust 未安装 + 磁盘仅剩 49 GB。Rust 工具链约 1.5 GB、Tauri `target/` 目录 3–8 GB，需先清理磁盘。
**退路**：若 Rust 链路不顺，Electron 44 + electron-builder 26.15.3 是成熟退路，前端 100% 代码可复用（只换外壳层）。

### 2.3 编辑内核：为什么最终是 CodeMirror 6（2026-10-20 实测修订）

> **原计划选 Milkdown 7，M1 spike 用实测数据推翻了它。** 这里保留原始候选对比，
> 并附上推翻的具体证据。

原候选对比：

| 方案 | 许可证 | 活跃度 | 是否支持 Typora 式 Live Preview | 原评价 |
|---|---|---|---|---|
| Milkdown 7.x | MIT | v7.22.3（2026-10-10） | 需自研 Live Preview 插件，但底座齐全 | ~~✅ 推荐~~ → ❌ **实测否决** |
| Tiptap 3.x | MIT | v3.32.0（2026-10-13） | 需自研 Markdown 序列化 + Live Preview | 可用，但 Markdown 序列化要自己写 |
| Lexical | MIT | v0.52.1 | 同上，且与 Markdown 生态脱节 | 不推荐 |
| Slate | MIT | 0.146.1 | 需自研；文档大时性能差 | 不推荐 |
| **CodeMirror 6** | MIT | 活跃（VSCode 同源） | 装饰器天然适合隐藏标记 | ✅ **实测胜出** |
| 原生 ProseMirror + remark | MIT | npm 包活跃 | 需自研全部胶水层 | 兜底方案 |

#### 推翻 Milkdown 的决定性证据

**证据一：Milkdown 的标记符根本不在文档文本里。**
读 `@milkdown/preset-commonmark@7.22.3/src/mark/strong.ts` 源码可见（注意是在 **preset-commonmark** 包里，
不在 `@milkdown/core`），strong 是 ProseMirror 的 **mark**：
`toDOM` 渲染成 `<strong>`、`parseMarkdown` 用 `openMark` 吃掉 `**`、`toMarkdown` 用 `withMark` 重新合成 `**`。
**正文里只有「粗体」二字**。

这直接击穿了 Typora 式体验的核心前提——「行内标记符号本身是真实的文档内容，可以直接编辑」。
用 Milkdown 做不到「像普通文本一样编辑 `**`」。

**证据二：源码模式 ↔ 混合模式切换在 Milkdown 下代价极高。**
原计划是「序列化 + 重解析」来回切，这会带来：撤销栈分裂、光标位置需要手动映射、
多次切换后文档可能漂移。CodeMirror 6 路线下，两种模式是**同一个编辑器实例**切换装饰器，
光标、滚动、撤销栈天然保持（已实测，见下）。

**证据三（2026-10-21 校准）：remark 解析成本决定了语义与布局必须分层。**
实测（`scripts/bench-parser.ts`，2026-10-20）：

| 文档规模 | remark p95 | lezer p95 | 16ms 交互预算 |
|---|---|---|---|
| 200 行 / 3 KB | 3.79 ms | 0.39 ms | 都过 |
| 1000 行 / 14 KB | **10.96 ms** | 1.05 ms | remark 已逼近上限 |
| 3000 行 / 43 KB | **28.95 ms** | 1.82 ms | **remark 超标** |

> ⚠️ **校准声明（2026-10-21，已向用户更正）**：这条**不能**当作独立的不利于 Milkdown 的论据。
> Milkdown 是载入时解析一次，之后直接编辑 ProseMirror 文档，**每击键并不重解析 remark**，
> 所以「remark 撑不住每击键」在 Milkdown 路线下并不成立。
> 这组数据的正确用途是：**在 CM6 路线下，语义（remark）与布局（lezer）必须分层**——
> 语义只在需要时解析，编辑视图每击键都要靠 lezer。

2026-10-21 复测（同一脚本、同一机器）：remark p95 = 3.06 / 10.38 / 30.03 ms，lezer p95 = 0.87 / 1.06 / 3.40 ms。结论稳定。

#### CM6 路线实测结果（2026-10-20，浏览器内验证）

| 能力 | 实测结果 |
| --- | --- |
| 行内标记隐藏/展开 | ✅ `**` `*` `` ` `` `~~` 链接的括号与网址全部按规则隐藏/展开 |
| 展开判定 | ✅ 光标进入结构 → 标记变回真实可编辑文本；移出 → 重新隐藏；同时只有一个结构展开 |
| 源码模式 | ✅ 切过去是纯 Markdown 原文，标记全部消失 |
| 模式切换保持光标 | ✅ 切到源码再切回，`cm-activeLine` 仍在原行、该行的 `**` 仍是展开态 → **光标精确保持** |
| 中文文本输入 | ✅ 中文正常输入、装饰实时跟随（**2026-10-21 用户真机验证通过**：拼音组字、候选框、选词、组合输入均无问题） |

**已知代价**：CM6 没有富文本语义，表格 / 公式 / 图表 / 脚注编号的渲染层要自己实现，
这是 M2 的工作量（Milkdown 本来白送一部分）。但换来的是「标记符可编辑 + 模式切换零漂移」这两条硬需求。

#### 取舍框架与正式拍板（2026-10-21）

选型不是「谁更好」，而是**两条路都要的东西不一样**。把两边的真实优势摊开：

| 维度 | Milkdown 7 | CodeMirror 6 |
| --- | --- | --- |
| 富文本语义（mark / node 体系） | ✅ 白送 | ❌ 没有，要自建 |
| 写作 UI（拖拽手柄、斜杠菜单、可视化表格、链接浮层、AI 面板） | ✅ Crepe 全套 | ❌ 没有，要自建 |
| remark 血统（语义与生态一致） | ✅ transformer 直接依赖 remark 15 | ⚠️ 需自建 remark→视图的桥 |
| 插件全家桶（自动编号、Prism、图表、事件总线） | ✅ 现成 | ❌ 没有 |
| **标记符是真实可编辑文本** | ❌ | ✅ |
| **真相源是 Markdown 文本** | ❌ | ✅ |
| **源码模式无损** | ❌（要序列化重解析） | ✅ |
| 撤销栈 / 光标在模式切换时的连续性 | ⚠️ 需手动映射 | ✅ 天然保持 |

**Milkdown 的真实优势（8 条，已查证）**：

1. 富文本语义白送——mark / node 体系成熟
2. `@milkdown/crepe@7.22.3`（3.4 MB）提供整套写作 UI：`block-edit`（拖拽手柄 + 斜杠菜单）、
   `link-tooltip`、`table`（可视化表格编辑）、`latex`（KaTeX 0.19）、`image-block`、`list-item`、
   `toolbar` / `top-bar`、`code-mirror`、`ai`
3. remark 血统——`@milkdown/transformer` 直接依赖 `remark@^15.0.1` + `unified@^11.0.3` + `remark-gfm@^4.0.1`
4. 插件全家桶——`plugin-automd`（列表续行 / 有序列表自动编号）、`plugin-prism`、`plugin-diagram`、
   `plugin-listener`（事件总线）
5. ProseMirror 底座成熟（选区 / 历史 / yjs 协同）
6. 框架无关（`@milkdown/react`、`@milkdown/vue`）
7. 主题现成（`theme-nord`、`theme-dark`）
8. 全部 MIT，核心包统一 7.22.3（2026-10-10）

> 反讽佐证：Crepe 自己的 `code-mirror` feature 用的就是 CodeMirror 6
> （`codemirror@^6.0.1`、`@codemirror/view@^6.16.0`）。

**Milkdown 的否决理由（两条硬的）**：

1. **`**` 不在文档文本里**——`@milkdown/preset-commonmark@7.22.3/src/mark/strong.ts` 的
   `$markSchema('strong', ...)`：`toDOM` 渲染成 `<strong>`、`parseMarkdown` 用 `openMark` 吃掉 `**`、
   `toMarkdown` 用 `withMark` 重新合成 `**`。正文里只有「粗体」二字。
2. **粗体走 input rule，实时手感不对**——Milkdown 的 `**text**` 规则是
   `/(?<![\w:/])(?:\*\*|__)([^*_]+?)(?:\*\*|__)(?![\w/])$/`，要**打完整个 `**text**` 才转换**，
   与 Typora「边打边渲染」相反。

**✅ 2026-10-21 正式拍板：采用 CodeMirror 6（方案 B）**

用户在「A（Milkdown + Crepe，快速出成品）」与「B（CM6，守住『真相源是 Markdown 文本』红线）」之间
**明确选择 B**。判据是本项目 §3.2 的三条架构约束：

| 红线 | Milkdown | CM6 |
| --- | --- | --- |
| 约束 A：单一真相源是 Markdown 文本 | ❌ 真相源是 ProseMirror 文档，Markdown 是导出物 | ✅ 真相源就是文档本身 |
| 约束 B：源码模式永远可达、永远无损 | ❌ 需序列化重建，有漂移风险 | ✅ 同一份文档切装饰器 |
| 约束 C：解析规则唯一 | ⚠️ ProseMirror schema + remark 两套语义 | ✅ remark 语义 + lezer 布局，双层对齐 |

**已知代价，明确接受**：Milkdown 的优势（富文本语义、Crepe 写作 UI、插件全家桶）
**全部转为我们自己的工作量**，集中在 M2：

| 失去的能力 | 我们的补法 | 排期 |
| --- | --- | --- |
| 表格 / 公式 / 图表 / 脚注渲染层 | lezer 节点 → 自建 widget 渲染 | M2 |
| 表格图形化编辑 | 先做「表格单元格内 Markdown 照常编辑」，图形化后置 | M2 |
| 拖拽手柄 / 斜杠菜单 | 斜杠菜单可做（命令面板式），拖拽手柄后置 | M2–M3 |
| 链接浮层 | 输入 `](` 时弹浮层补 URL | M2 |
| 自动编号 / 列表续行 | 纯文本层实现成本低 | M2 |

#### 外部验证：标杆编辑器的实现（2026-10-20 补充调研）

完整报告见 **`docs/editors-comparison.md`**。核心结论：

**四家标杆中，没有一家的文档模型是「富文本节点里不含标记符」。**

| 产品 | 文档模型 | 标记符 | 隐藏机制 | 渲染粒度 | 技术栈 |
|---|---|---|---|---|---|
| **Typora** | 真实文本层 + AST | 真实可编辑 | `.md-meta`/`.md-content` 双元素 + `.md-expand` class 切换 | **段落级 AST + 增量** | Electron + 自研；源码模式/代码块用 **CodeMirror 5** |
| **Ulysses** | 纯文本（Markdown XL） | **始终可见**，只弱化着色 | 不隐藏 | 整篇 | 原生 macOS/iOS（TextKit 系） |
| **Bear** | 纯文本 | 隐藏，「通用模式」可切回 | NSTextView 自定义 | 整篇 | 原生 macOS/iOS |
| **Milkup** | ProseMirror 树 + `syntax_marker` **文本节点** | 真实文本节点 | CSS `font-size: 0` | 整篇 + 两级缓存 | 自研 ProseMirror 内核 |
| **Inkstone** | 纯 Markdown 文本 | 真实可编辑 | `Decoration.replace` 零宽 widget | 全文 lezer | Tauri 2 + CM6 |

**最有说服力的一条**：开源项目 **Milkup**（`github.com/Auto-Plugin/milkup`）的 v1 版本
**从 Milkdown 迁到了自研 ProseMirror 内核**，理由和我们完全一致——mark 不含标记符文本，
做不到直接编辑 `**`。它为解决这件事付出的代价是：自研 1200 行 Parser + 自研 Serializer +
源码模式整篇文档重建 + `syntax-detector`/`syntax-fixer` 配对插件。
**CM6 路线把这一整套成本降为 0。**

**Typora 官方文档还证实**：Typora 的源码模式与代码块高亮用的就是 **CodeMirror**
（官方支持页原文："Typora uses CodeMirror for syntax highlighting in code fences"）。
说明「CodeMirror 作为编辑器内核」在本品类里是被验证过的。

#### 从调研中采纳的两个改进点（已实施）

| # | 改进点 | 来源 | 状态 |
|---|---|---|---|
| A | **三种标记符显示策略**：`live`（Typora，标记隐藏）/ `dimmed`（Ulysses，标记弱化可见）/ `source`（纯源码） | Ulysses + Bear | ✅ 已实施 |
| B | **段落级增量渲染** | Typora（段落级 AST）+ Milkup（两级缓存） | 🟡 部分完成（2026-10-21）：lezer 增量解析已落地（击键成本降 3 倍）；「装饰器按可见区缓存」经实测**决定不做**（收益 ≤2.5ms，代价是滚动闪烁），改为 M2 做**局部重建装饰器** |

#### Live Preview 性能：实测数据与优化结论（2026-10-21）

M1 的最后一个性能项。**先量清楚成本在哪，再决定优化什么**——
这个顺序不能反，否则会为了「看起来该做」的事付出真实代价。

**第一步：拆解管线的成本分布**（`scripts/bench-decorations.ts`）

| 文档规模 | 语法节点 | lezer 全量解析 | 三次树遍历 | 完整管线 p95 | 装饰器数 |
| --- | --- | --- | --- | --- | --- |
| 500 行 / 13 KB | 1097 | 0.93ms | 0.19ms | 0.99ms | 638 |
| 1500 行 / 32 KB | 2741 | 1.47ms | 0.27ms | 1.84ms | 1595 |
| 4000 行 / 90 KB | 7673 | 3.25ms | 0.87ms | 4.36ms | 4466 |

**解析占 64%~72%**，是管线里最大的单点成本 → 结论：先做增量解析。

**第二步：增量解析怎么做（并纠正一个错误）**

计划书原文写的是「用 `TreeEditor`」。**实测发现 lezer 生态里根本没有这个类**——
`@lezer/common` 的全部导出里没有它，`@lezer/lr` / `@lezer/markdown` 里也没有。
真正的增量入口是三个 API 的组合，CM6 官方（`@codemirror/language` 的 `ParseContext.changes`）
走的是同一条路：

```ts
let fragments = TreeFragment.addTree(tree);                    // 登记可复用的树
fragments = TreeFragment.applyChanges(fragments, changedRanges); // 按变更处切开
tree = parser.parse(newText, fragments);                        // 复用未变更部分
```

**第三步：正确性对拍**（`scripts/verify-incremental.ts`）

Markdown 的块级结构依赖跨行有状态上下文（缩进、列表层级、围栏代码块），
增量解析**理论上**可能产出与全量不同的树。实测：

| 轮次 | 随机编辑 | 与全量解析不一致 | 性能 p95 |
| --- | --- | --- | --- |
| 3 组种子 × 300 轮 | 900 | **0%（逐节点对比类型 + 起止位置）** | 增量 0.07ms vs 全量 2.74ms |

护栏固化在 `tests/incremental-parse.test.ts`（200 轮对拍 + 装饰器一致性 + 撤销回滚）。

**第四步：优化后的实测**

node 侧（同一次击键的管线成本）：

| 规模 | 全量路径 | 增量路径 | 加速 |
| --- | --- | --- | --- |
| 500 行 | 1.13ms | **0.31ms** | 3.6× |
| 1500 行 | 1.91ms | **0.52ms** | 3.7× |
| 4000 行 | 4.58ms | **1.53ms** | 3.0× |

真实浏览器（`perf.html` 测量台）：

| 场景 | 装饰器 | dispatch 同步 p95 | 击键→下一帧绘制 p95 |
| --- | --- | --- | --- |
| 小文档 83 行 | 150 | 0.40ms | 10.10ms |
| 中文档 1018 行 | 1800 | 0.70ms | 10.00ms |
| 大文档 6798 行 | 12000 | 2.90ms | 7.20ms |

同时做了两处零风险优化：三次 `tree.iterate()` 合并成一次（4000 行省 0.83ms，
用三个桶分别收集以保持装饰器推送顺序不变）、`INLINE_MARKERS` 查找改 Map。

**第五步：为什么「装饰器按可见区缓存」决定不做**

| | 收益 | 代价 |
| --- | --- | --- |
| 裁剪到视口 | 6798 行 dispatch 2.90ms → 约 0.4ms | 不可见区域不生成装饰器 → **滚动进视野时标记闪现** |

不做，三个理由：

1. **收益有限**：2.90ms 只占 16ms 交互预算的 18%，用户无感知。
2. **代价明确**：滚动闪现是明显的体验倒退，而 Live Preview 的「所见即所得」正是本项目的立身之本。
3. **收益来源判断错了**：装饰器数量主要影响**构建**成本，不影响**渲染**成本——
   CM6 只为视口内的行建 DOM。实测印证：12000 个装饰器的大文档，
   击键→绘制延迟与小文档**没有差异**（7.2ms vs 10.1ms，差异来自 rAF 对齐而非工作量）。

**正确做法是 M2 的「局部重建装饰器」**：文档变更时只重建受影响区间的装饰器
（`DecorationSet.map` + 局部重建），所有区域始终有装饰器，因此没有闪烁。
这与 Typora 的「段落级 AST + 只重渲染变动节点」是同一个思路。

#### 保留的 Milkdown 结论（供 M2 参考，不作内核依赖）

Milkdown 不进依赖树，但它的设计仍是 M2 自建写作 UI 时的现成参考：

- **Crepe 的功能清单**可直接当需求抄——`block-edit`（拖拽手柄 + 斜杠菜单）、`link-tooltip`、
  `table`、`latex`、`image-block`、`toolbar`、`ai`，见 M2 的 🆕 任务分解
- Milkdown 迭代快、API 会变 → **若将来真要引入，只依赖它的插件层 API**
- **ProseMirror 主仓库虽已 archived（2026-04-01 最后提交），但 npm 包仍在正常发版**：
  `prosemirror-view` 1.42.6（2026-09-25）、`prosemirror-model` 1.25.12（2026-09-21）。**仓库归档 ≠ 停更**

### 2.4 解析层：remark 而非 markdown-it / comrak

| 方案 | 评价 |
|---|---|
| **remark / unified / mdast**（语义层） | AST 优先，插件生态（remark-gfm / remark-math / remark-frontmatter / remark-directive）齐全；mdast 是无损序列化的理想中间表示 |
| **lezer / @lezer/markdown**（布局层） | 增量解析，1000 行 p95 ≈ 1.05ms；只回答「标记在哪、正文在哪」，不产出语义结论 |
| markdown-it 15.0.3 | 性能优秀、CommonMark 100% 合规，但**输出偏 DOM/HTML 导向**，做"源码↔树"双向无损映射时不如 mdast 顺手 |
| comrak（Rust） | GFM 极准、快，但它是 Rust 侧库；前端编辑器要跨 IPC 拿 AST，得不偿失 |
| pulldown-cmark 0.13.4 | 同上，且是 CommonMark 严格向，GFM 扩展要自己补 |

**决策（2026-10-20 修订）**：**mdast 作为唯一语义来源**（渲染、导出、大纲、脚注编号全部从同一棵 mdast 树派生），
**lezer 只服务编辑视图的实时布局**。两者不是「两套解析规则」，而是「同一套规则的两个实现」——
一致性由 `tests/corpus/` 的语料库断言。原来的约束 C「解析规则唯一」因此修订为：
**语义归 mdast，布局归 lezer，两者必须对齐。**

### 2.5 渲染组件

- **代码高亮：highlight.js 11.12.0** 的 `lib/core` 入口 + 显式注册 30 个常用语言（见 §8 D8 的选型过程）。不用全量入口（193 语言 / 1474 KB raw），不用 Shiki（wasm + 异步，编辑器里会抖），不用 Prism（生产构建下静默失效）。体积：30 语言 + 核心 = 269.3 KB raw。亮/暗双主题不用 hljs 自带主题，而是把 `.hljs-*` 映射到我们的 `--ink-code-*` CSS 变量。
- **数学：KaTeX v0.19.0**，不用 MathJax 4。理由：**同步渲染**——编辑器里每敲一个字符都要重排公式，MathJax 的异步布局会造成明显抖动；KaTeX 快一个数量级且体积小。Typora 选 MathJax 是因为它把公式做成了独立编辑面板，我们不做那个。
- **图表：Mermaid 12.2.0**（90k★，MIT，Typora 1.13 同款大版本）。
- **HTML 净化：DOMPurify**（Apache-2.0）。对标 Typora 的安全策略：剥离 `<script>`、`onload` 等事件属性、`class`/`id`/`data-*`；`<iframe>` 强制 `sandbox`。

### 2.6 导出管线（照抄 Typora 的成熟设计）

Typora 导出体系的核心设计有两点值得直接继承：

**① 先转 pandoc native AST，再由 pandoc 转目标格式**
> 目的：保证"编辑器里看到的"与"导出出来的"是同一套语义。

我们照做：mdast → pandoc native → `pandoc -f native -t docx`。本机已装 pandoc 3.8。

**② 导出项可自定义 + 变量系统**
导出项支持增删、重排、重命名、绑定快捷键；变量包括 `${title}` `${author}` `${today}` `${currentPath}` `${currentFolder}` `${pageNo}` `${pageCount}` `${outputPath}` 以及任意 YAML 键（含 `a.b` 嵌套）。

**PDF 导出双路径**：
- **原生路径**（P0）：macOS 用 WKWebView `createPDF`，Windows 用 WebView2 `PrintToPDF`，Linux 用 WebKitGTK `print_to_pdf`。三者都复用应用内已渲染好的主题，**不引入 Chromium/TeX Live 依赖**，这是 Typora 的做法。
- **pandoc 路径**（P1）：`pandoc → LaTeX → PDF`，需要用户自备 TeX 环境。

### 2.7 依赖许可证白名单（CI 强制）

**允许**：MIT / Apache-2.0 / BSD-2 / BSD-3 / ISC / 0BSD / CC0 / Unlicense / Python-2.0（仅工具链不发布）
**禁止**：GPL / AGPL / SSPL / 商业闭源（作为依赖引入时）
**注意**：pandoc 是 GPL-2.0，但**以独立进程调用、不链接**，与 AGPL 类传染性无关（与 Typora 做法一致）。若要彻底规避，可替换为纯 Rust 的 `comrak` 做 AST 转换。

### 2.8 现有开源项目盘点（避坑与借鉴）

| 项目 | ★ | 许可证 | 版本/日期 | 活跃 | 对我们的意义 |
|---|---|---|---|---|---|
| **MarkText** | 62.9k | MIT | v0.22.0 / 2026-10-18 | ✅ 活跃 | **最接近的开源对标物**，所WYSIWYG（隐藏标记）而非 Typora 式 Live Preview；架构与 UI 可参考 |
| Zettlr | 13.8k | GPL-3.0 | v4.8.0 / 2026-09-18 | ✅ | 学术写作工作台；GPL 不可直接借鉴代码 |
| Logseq | 45.3k | AGPL-3.0 | 活跃 | ✅ | 块级 + 大纲；许可证排除 |
| SiYuan 思源 | 46.9k | AGPL-3.0 | 活跃 | ✅ | 同上 |
| md-editor-v3 | 2.6k | MIT | v7.1.0 / 2026-09-28 | ✅ | Vue3 + Slate；可参考表格/图片交互 |
| Milkdown | 12.0k | MIT | v7.22.3 / 2026-10-10 | ✅ | **已否决的内核候选**；其 Crepe 写作 UI 与插件思路仍是 M2 自建时的参考 |
| Tiptap | 38.8k | MIT | v3.32.0 / 2026-10-13 | ✅ | 备选内核 |
| Obsidian | 22.4k | 闭源 | 1.14.4 / 2026-10-20 | ✅ | Live Preview 的事实标杆（闭源，只能对标行为） |
| stackedit | 23.1k | Apache-2.0 | 2023-07 | ❌ 停更 | 浏览器端全屏编辑，思路可参考 |
| tui.editor | 18.0k | MIT | 2024-08 | ❌ 归档 | 不要再考虑 |
| **新发现**：tizuio/TizuMark | 405 | GPL-3.0 | v1.2.4 | ✅ | Tauri + WYSIWYG 实时预览，**架构最接近我们的设想**，可读源码学思路（GPL 不可抄码） |
| **新发现**：I7T5/Edmund | 253 | Apache-2.0 | v0.8.2 | ✅ | Swift 原生 macOS + inline live preview，macOS 交互细节可参考 |
| **新发现**：dvcrn/markright | 916 | GPL-3.0 | v1.0.0 | ✅ | Tauri + live preview |
| **新发现**：mattenarle10/markamd | 507 | MIT | v1.7.7 | ✅ | 本地优先 + 实时预览 |

> **结论**：MIT 许可 + 专注 Markdown + Typora 式体验的空白位是真实存在的。TizuMark 证明了 "Tauri + WYSIWYG 实时预览" 的技术路线可行，但它只到 1.2.4、405★，远未触及 Typora 的完成度。

### 2.9 本机环境与约束（实测）

| 项 | 状态 | 影响 |
|---|---|---|
| Node | v26.8.2 | ✅ 前端就绪 |
| pnpm / npm / bun | 10.7.1 / 11.19.1 / 1.3.10 | ✅ |
| Rust / cargo | **未安装** | ⚠️ Tauri 需 `brew install rustup`（约 1.5 GB） |
| Xcode CLT | 已装 | ✅ 编译与公证链路可用 |
| pandoc | **3.8 已装** | ✅ 导出桥立即可用 |
| Python | 3.12.7 | ✅ |
| **磁盘可用** | **仅 49 GB（已用 95%）** | 🔴 **Tauri target 目录 3–8 GB，必须先清理** |
| macOS | 27.0.1 (26A434) | ✅ Apple Silicon 原生 |
| git 仓库根 | `/Users/yirongcao`（家目录本身是 repo） | ⚠️ 新项目**不能**放在家目录 git 树内 → 定为 `~/Documents/GitHub/inkstone` |

---

## 3. 架构

### 3.1 分层

```
┌─────────────────────────────────────────────────────────┐
│  表现层  src/views/          大纲 / 文件树 / 搜索 / 设置  │
├─────────────────────────────────────────────────────────┤
│  编辑层  src/editor/         ← 本项目的核心战场          │
│    ├─ 内核（CodeMirror 6 文档 = 纯 Markdown 文本）        │
│    ├─ Live Preview 插件（行内标记的隐藏/展开）           │
│    ├─ 三种标记符显示策略（live / dimmed / source）      │
│    └─ 同一 EditorView 切装饰器（无模式桥，见下）          │
├─────────────────────────────────────────────────────────┤
│  语义层  src/parser/          remark → mdast（唯一真相）  │
│  布局层  src/editor/lezer     lezer 增量树（只答标记位置）│
├─────────────────────────────────────────────────────────┤
│  渲染层  src/renderer/        代码高亮 / 公式 / 图表 / HTML  │
```

> **2026-10-21 修订（改选 CM6 后的架构变化）**：
> 原图里有一层「模式桥（光标/滚动/选区/撤销栈的跨模式映射）」——那是 Milkdown 路线才需要的东西
> （富文本视图 ↔ 源码视图是两棵不同的树，必须手工映射）。
> **CM6 路线下这层直接消失**：源码模式与混合模式是**同一个 EditorView 的两种装饰器配置**，
> 文档、光标、选区、滚动、undo 栈是同一份，天然不需要映射，也没有漂移风险。
> 另一处变化：解析层不再是「mdast ↔ 文档树双向映射」，而是
> **remark/mdast 负责语义（渲染/导出/大纲），lezer 负责编辑视图的实时布局**，两层职责分离。
├─────────────────────────────────────────────────────────┤
│  导出层  src/export/          HTML / PDF / pandoc 桥      │
├─────────────────────────────────────────────────────────┤
│  平台层  src-tauri/           fs / 搜索 / 监听 / 图片 / 打印 │
└─────────────────────────────────────────────────────────┘
```

### 3.2 三条不可动摇的架构约束

**约束 A：单一真相源是 Markdown 文本**
编辑器的内存模型**就是 Markdown 文本本身**（CodeMirror 6 文档里装的是纯 Markdown 源码，一个字符都不多），
**磁盘上的 `.md` 与内存中的文档是同一份东西**。任何编辑操作直接发生在文本上，
不存在"富文本模型 → 序列化 → 磁盘"的中间层。绝不做"富文本文件格式"。

> **2026-10-21 修订**：本条原写作「内存模型是 ProseMirror 文档树，磁盘上的 .md 才是权威」——
> 那是 Milkdown 路线的约束，也是它最难兑现的一条。改选 CodeMirror 6 后，
> 这条从"需要努力达成"变成"架构上天然成立"。

**约束 B：源码模式与混合模式共享一个 undo 栈**
Typora 的历史 bug 里有大量"切换模式后撤销行为诡异"。设计上必须做到：两个模式是同一份文档的两种视图，撤销栈在全局唯一。
（CM6 路线下天然成立：切模式只改装饰器，不重建文档。）

**约束 C：解析规则唯一**
Typora 的做法是"先转 pandoc native AST，再由 pandoc 转目标格式"，以保证"编辑器里看到的"和"导出出来的"是同一套语义。我们照抄这个思路：**渲染、导出、大纲、脚注编号全部从同一棵 mdast 树派生**。

> **2026-10-20 补充**：精确划分为两层——
> **语义归 remark/mdast**（唯一真相），**编辑视图的实时布局归 lezer**（只回答「标记符在哪」）。
> 两者必须对齐，对齐性由 round-trip 语料库断言保证。

### 3.3 Live Preview 的实现思路（技术核心）

这是整个项目最难的部分，值得单独说清楚。

**目标行为**：
- 屏幕显示 `**加粗**`，但光标不在此处时，视觉上只显示"加粗"二字
- 光标进入这个词内部，视觉上变成 `**加粗**`，可像普通文本一样编辑标记符
- 行内标记符号本身是**真实的文档内容**，不是装饰

**实现（CodeMirror 6 装饰器方案，2026-10-20 已跑通）**：

1. **文档恒为 Markdown 源码**。CM6 的 `Text` 里装的就是用户原文，一个字符都不多。
2. lezer 解析出语法树，回答「哪里是标记、哪里是正文」（`EmphasisMark` / `CodeMark` / `LinkMark` 等节点）。
3. `buildLivePreviewDecorations()` 把这些节点翻译成两类装饰器：
   - **替换装饰** `Decoration.replace({widget})`——把标记区间换成一个**零宽 widget**，
     屏幕上看起来标记消失了，但**文档坐标不变**
   - **标记装饰** `Decoration.mark({class})`——给正文套上 `cm-md-strong` 等样式
4. 光标判定用「**左开右闭**」：`node.from < cursor <= node.to`
   → 光标在正文里 → 展开；紧跟结束标记之后 → 展开；紧贴开始标记之前 → 不展开。
5. 展开时不生成替换装饰，标记符就以**真实文本**形式回到屏幕上，可直接编辑。

**为什么必须用 `Decoration.replace` 而不是 CSS 隐藏**：
replace 保持文档坐标不变，光标仍能落进标记区间（我们据此判断「光标进入了」）；
纯 CSS 隐藏（`font-size:0` / `display:none`）会让光标永远进不去，做不到直接编辑 `**`。

**动态装饰器的实现陷阱**（实测踩过）：
`EditorView.decorations.compute([field], get)` **只在依赖字段变化时重算**。
装饰器真正依赖的是「文档内容 + 光标位置」，这两个每次击键都在变，却不是任何一个 StateField。
正确做法是 `ViewPlugin.fromClass` 的 `update()`——CM6 在每个事务后都会调用它。

**剩余难点清单**（M1 剩余工作）：
- ~~中文 IME **组字过程**在标记符边界的行为~~ ✅ **2026-10-21 真机验证通过**
  （结论：CM6 的 composition 处理足够稳；自动配对已加 `view.compositionStarted` 守卫，
  见 AGENTS.md「CodeMirror 6 踩坑记录」第 10、11 条）
- 嵌套标记（`**粗体里的 `代码`**`）的装饰嵌套顺序
- 跨段落标记（引用块内的段落标记、列表项前缀）
- 光标在标记符中间时按下方向键的预期行为
- lezer **增量解析** —— ✅ 已落地（2026-10-21），见 §2.3「Live Preview 性能」

**退路方案**：如果 Live Preview 的某个边界场景反复出问题，提供"渲染模式 / 源码模式"双模式作为一等公民，而不是硬撑一个"半 WYSIWYG"。**这点必须写进产品原则：源码模式永远可达、永远无损。**
（好消息：CM6 路线下这两模式是同一个实例切装饰器，切换零成本、零漂移。）

### 3.4 自动配对（2026-10-21 实施）

CM6 的 `EditorView.inputHandler` 扩展点实现，设置项 `editor.autoPairMode` 三档，
运行时用 `Compartment.reconfigure` 切换（不重建编辑器，光标/滚动/撤销栈不受影响）。

规则**不是凭感觉写的**，三处来源都核对过：

| 来源 | 核对到什么 |
| --- | --- |
| Typora 官方文档 `support.typora.com.cn/Auto-Pair/` | 两级开关；`~ = ^` 不自动补闭合，只在有选区时包裹 |
| 官方演示视频 `media/auto-pairs/autopair2.webm`（**逐帧抽帧核对**） | `*` 是**逐级升级**：`*|*` → 再敲一个 `*` → `|**` |
| Typora Markdown Reference | 每个符号的真实语法长度（`~~` 删除线、`==` 高亮、`^` 单个上标） |

最关键的一条是 `*` 的**逐级升级**行为：

```
敲第一个 *    →  *|*        斜体标记
紧接着再敲 *  →  |**        升级成粗体标记
敲完内容再敲 * →  闭合
```

于是 `*text*`（斜体）和 `**text**`（粗体）都能自然打出来。
如果固定配成 `**`，用户想写斜体却总得到粗体——这是刻意避开的坑。

实现上有两处技术要点（详见 AGENTS.md「CodeMirror 6 踩坑记录」第 10–13 条）：

1. **IME 组字期间不配对**，用 `view.compositionStarted` 判断；
2. **inputHandler 必须校验 `from === sel.from && to === sel.to`**——
   否则 IME 提交时浏览器把整段组字文本换成最终文本，DOM 变更范围与
   state 里的选区对不上，就会把刚提交的中文当成「选区」再包一层符号，
   把中文输入彻底搞坏。

---

## 4. 里程碑

### M0 · 地基（目标：2 周）
- [x] 仓库初始化、MIT 协议、CI（lint / test / build / 打包）
- [x] Tauri（或 Electron）骨架跑起来，macOS 菜单栏 + 打开 `.md` 关联
- [x] 主题系统：CSS 变量 + 亮/暗双主题 + 用户自定义 CSS 覆盖
- [x] 偏好设置面板骨架（配置持久化）
- **验收**：能双击打开一个 `.md`，显示纯文本并滚动流畅 ✅

### M1 · 编辑内核（目标：6 周）★ 决定项目成败
- [x] mdast 解析层：GFM + YAML front matter + 数学 + 脚注 + Alerts
- [x] 编辑内核选型 spike（Milkdown vs CM6，实测定案：**CodeMirror 6**）
      ← **2026-10-21 用户在 A/B 间正式拍板选 B（CM6）**，判据是 §3.2 的三条架构约束
- [x] 混合编辑：行内标记的实时渲染与展开
- [x] 源码模式，与混合模式**共用同一个 CM6 实例**
- [x] 模式切换：光标位置保持（实测通过；滚动位置由同一 view 保证）
- [x] 三种标记符显示策略（`live` / `dimmed` / `source`）
- [x] 中文输入法全场景测试 ← **2026-10-21 用户真机验证通过**
- [x] 撤销/重做：装饰器重算不破坏 undo 栈（补了 3 个用例）
- [x] 自动配对（off / basic / markdown 三档，运行时可切）
- [x] 复制粘贴：HTML → Markdown 转换 + 样式净化，Markdown 原样保留
- [x] 嵌套标记的展开边界（`node.from < cursor <= node.to`）+ atomic 区间机制记录
- [x] round-trip 语料库 5 份 → **13 份**（含 470 行长文档，兼性能压测样本）
- [x] lezer **增量解析**（2026-10-21）——击键成本降 3 倍：4000 行 4.58ms → 1.53ms；
      浏览器实测 6798 行文档 dispatch 同步 p95 = 2.90ms。
      ⚠️ 计划书原文写的「`TreeEditor`」是错的：**lezer 生态里没有这个类**，
      真正的入口是 `TreeFragment.addTree` / `applyChanges` + `parser.parse(text, fragments)`。
      正确性：900 轮随机编辑对拍，与全量解析**逐节点 0% 不一致**
- [x] 装饰器管线优化：三次 `tree.iterate()` 合并为一次（4000 行省 0.83ms）+
      `INLINE_MARKERS` 查找改 Map
- [ ] ~~装饰器按可见区缓存~~ —— **实测后决定不做**（2026-10-21）：
      最多再省 ~2.5ms，而 2.90ms 只占 16ms 预算的 18%；代价是滚动时标记闪现。
      正确做法是 M2 的「局部重建装饰器」，不是裁剪。详见 §2.3
- [x] 复制为 HTML / 粘贴为纯文本（2026-10-21）——⌘C 同时写 `text/plain`（Markdown 源码）
      与 `text/html`（渲染后 HTML）；菜单「复制为 HTML」直接写系统剪贴板；
      「粘贴为纯文本」是一次性标志；另加自定义 MIME `text/x-inkstone-markdown`
      保证 Inkstone 内部复制粘贴逐字节无损。详见 AGENTS.md「剪贴板」章节
- [x] 表格 / 公式 / 图表 / 脚注的渲染层（表格/公式/脚注已落地；仅 Mermaid 待做） ← **按 §4 里程碑重排推到 M2**
- **验收**：连续写 2000 字不卡顿；中英混排输入法不跳光标；两种模式反复切换 100 次无内容漂移

### M2 · 写作体验（目标：4 周）

> **2026-10-21 补充**：这一档的工作量因改选 CM6 而变大。Milkdown + Crepe 本来白送的部分
> （富文本语义、拖拽手柄、斜杠菜单、可视化表格、链接浮层）现在都要我们自己建。
> 下面带 🆕 的是因此新增的任务，按「先补最影响写作手感的」排序。

- [x] 大纲面板（实时、点击跳转、锚点 slug 规则）
- [x] 字数统计（总计 / 选区 / 常驻显示）
- [x] 表格图形化编辑（增删行列、对齐；**不做列宽**——GFM 无宽度语法，Typora 存在自己配置里，写进文档就破坏红线 1）
- [x] 任务列表交互（点击勾选写回源码）
- [x] 代码高亮（highlight.js `lib/core`，亮/暗双主题走 CSS 变量）
- [x] 公式 KaTeX：块级 `$$…$$` + 行内 `$…$`（定界符策略做成设置项，见 §8 D9）
- [x] Mermaid 图表（懒加载独立 chunk；elkjs 是 EPL-2.0 弱 copyleft，已登记为待签字例外）
- [x] 焦点模式 / 打字机模式
- [x] Emoji 自动补全（`:smile` / `:笑`，1914 条含中文别名）
- [x] 图片：拖放 / 剪贴板粘贴 / 相对路径 / **尺寸 `=WxH`**（Typora / Obsidian 扩展；尺寸写进 Markdown，不引入第二个真相源）
- [x] 🆕 块级渲染层骨架（lezer 节点 → widget 的通用机制，表格/公式/图表都挂在它上面）
- [x] 🆕 斜杠菜单 / 命令面板（⌘K + 行首 `/`，共用一份命令表；拖拽手柄后置）
- [x] 🆕 链接浮层（输入 `](` 弹出 URL 输入框，回车补全右括号）
- [x] 🆕 公式编辑面板（KaTeX 渲染 + 源码双态切换）——双态切换即「点击渲染结果 → 光标进块内 → 标记显露」，块级与行内都覆盖；KaTeX `throwOnError:false`，语法错误自带红色 hover 提示
- [x] 🆕 列表续行 / 有序列表自动编号（`plugin-automd` 对位，文本层实现成本低）
- [x] 🆕 脚注编号渲染与跳转
- [x] 🆕 行内代码 / 链接 / 图片的 hover 提示（纯 CSS `attr()`，零 JS；链接显示目标网址、代码补出反引号、图片显示原始路径）
- [x] 🆕 导出链路校对：公式在 HTML 输出里用 KaTeX 渲染（不装 rehype-katex，避免重复打包 603 KB 的第二份 KaTeX）
- [x] **验收**：`tests/m2-acceptance.test.ts` —— 一份同时含标题 / 行内链接 / 行内代码 / 行内公式 /
      表格 / 代码块 / 块级公式 / mermaid / 图片 / 脚注的文档，逐类断言渲染出的 DOM，
      并断言渲染器之间的区间互斥与双态切换。导出本体在 M4；
      此处指「解析 → 渲染 → HTML 输出」这条链路已校对一致。
- [ ] 🆕 局部重建装饰器（段落级增量渲染）——**暂缓**（2026-10-23 实测复核）：
      增量路径 4000 行 p95 = 3.53ms（占 16ms 预算 22%）；
      逐个摘掉 mermaid / 数学 / 代码块 / 表格渲染器后 p95 均在 3.46–3.58ms，
      **与基线无可测差异**——成本在 lezer 解析本身，不在装饰器构建。
      要优化得先动解析，裁装饰器没有意义。数据与依据见 AGENTS.md「Live Preview 性能」。

### M3 · 文件管理（目标：4 周）
- [ ] 文件树侧边栏
- [ ] 快速打开（模糊搜索）
- [ ] 全局搜索（跨文件 + 正则）
- [ ] 查找替换（正则 + `$1` 捕获组）
- [ ] 多标签页 + 最近文件
- [ ] 自动保存 + 崩溃恢复
- [ ] 文件监听（外部修改检测与冲突提示）
- **验收**：打开 1000 个文件的目录，搜索响应 < 200ms

### M4 · 导出（目标：4 周）
- [ ] HTML 导出（内嵌主题、可选大纲、可追加 `<head>`/`<body>`）
- [ ] PDF 导出（原生排版路径 + pandoc/LaTeX 路径）
- [ ] pandoc 桥：DOCX / EPUB / ODT / RTF / LaTeX / MediaWiki / RST
- [ ] 导出项可自定义（增删、重排、重命名、绑定快捷键）
- [ ] 导出变量系统（`${title}` `${author}` `${today}` …）
- [ ] YAML front matter 覆盖导出设置（需显式开关，出于安全）
- **验收**：同一份文档导出 HTML 与 DOCX，内容语义一致

### M5 · 跨平台（目标：4 周）
- [ ] Windows x64 + ARM64 构建与打包
- [ ] Linux `.deb` / `.rpm` / AppImage / Wayland 兼容
- [ ] 自动更新
- [ ] i18n（简中 / 繁中 / 英文）
- [ ] 快捷键映射层（macOS ⌘ ↔ Win/Linux Ctrl 统一抽象）
- **验收**：三平台 CI 全绿，各平台产出一个可安装包

### 长期（P2+，不排期）
GitHub Alerts / 脚注 / RTL / 插件系统 / 主题市场 / 图片图床 / EPUB 精修 / RevealJS 幻灯片 / 多人协作

---

## 5. 质量标准

| 维度 | 指标 |
|---|---|
| 启动 | 冷启动到可输入 < 1.5s（macOS M 系列） |
| 输入 | 1000 行文档，键入延迟 P95 < 16ms |
| 内存 | 空闲 < 150MB，打开 10MB 文档 < 400MB |
| 稳定性 | 连续使用 8 小时无崩溃、无内存泄漏 |
| 正确性 | 打开→编辑→保存后，文件字节除用户改动外**完全一致**（round-trip 测试） |
| 兼容 | GFM 测试用例通过率 ≥ 99%（用 CommonMark/GFM spec 测试集） |

> **round-trip 测试是本项目最重要的质量基建**：一个语料库（几百个真实 Markdown 文件），每次提交都跑"解析→序列化→再解析→结构等价"断言。没有它，Live Preview 会慢慢腐蚀用户文件。

---

## 6. 风险清单

| # | 风险 | 等级 | 应对 |
|---|---|---|---|
| R1 | **Live Preview 边界场景反复出问题**（嵌套标记、跨块标记、脚注、表格内标记） | 🔴 高 | 源码模式永远无损可用；先做"渲染模式 + 源码模式"双轨，Live Preview 作为增强渐进叠加 |
| R2 | ~~**中文输入法在标记符边界跳光标**~~ | 🟢 已解除 | 2026-10-21 真机验证通过。技术措施：自动配对用 `view.compositionStarted` 挡组字期；inputHandler 校验 `from === sel.from` 挡 IME 提交误判 |
| R3 | **单人维护者的持续性** | 🔴 高 | 架构上把"外壳"与"内核"解耦，降低任何一块的退出成本；尽早开源、尽早招人 |
| R4 | **依赖许可证污染**（引入 AGPL 库） | 🟡 中 | 建立依赖许可证白名单 + CI 自动扫描；只用 MIT/Apache/BSD |
| R5 | **磁盘空间** | 🟢 低（已缓解） | **实测：清理 15 GB 后剩余 64 GB**。已清 uv(7.4G)/pip(5.9G)/npm(3.5G)/Homebrew(1.4G) 缓存；模型缓存（modelscope 63G / lm-studio 43G / huggingface 20G）属用户资产，**未动**，需要时用户可自行清理 |
| R6 | **核心依赖上游停更** | 🟢 低（已下调） | **实测：ProseMirror 主仓库虽 archived（2026-04-01），但 npm 包仍在发版**（view 1.42.6 / 2026-09-25，model 1.25.12 / 2026-09-21）；Milkdown v7.22.3 于 2026-10-10 发布。**选定 CM6 路线后本风险进一步下降**——CodeMirror 6 是 VSCode 同源，CodeMirror 团队仍在高频维护 |
| R7 | **Markdown round-trip 有损**（导出后原文变形，用户发现后失去信任） | 🟡 中 | round-trip 测试语料库；默认关闭所有"美化"行为 |
| R8 | **性能随文档规模劣化** | 🟢 低（2026-10-21 已缓解） | **实测：remark 1000 行 p95 = 10.96ms、3000 行 = 28.95ms 超 16ms 预算；lezer = 1.05 / 1.82ms**。**已实施**：编辑视图走 lezer + 增量解析（击键成本降 3 倍，浏览器实测 6798 行 dispatch p95 = 2.90ms，仅占 16ms 预算的 18%）。渲染层只对可视区做渲染 |
| R9 | **macOS 平台专属能力缺口**（Touch Bar、连续相机、文档版本恢复） | 🟢 低 | 明确列入"可能永远不做"清单，避免承诺 |
| R10 | **CM6 无富文本语义，渲染层要自建**（表格 / 公式 / 图表 / 脚注编号） | 🟡 中 | 这是改用 CM6 的直接代价。缓解：`src/parser/` 的 mdast 层仍在，渲染层从 mdast 派生；表格等复杂交互可单独评估是否用局部 widget 实现 |

---

## 7. 明确不做的事（防scope 蔓延）

- ❌ 笔记数据库 / 双链 / 图谱视图（那是 Obsidian / Logseq 的战场）
- ❌ 多人实时协作
- ❌ 云同步服务
- ❌ 插件市场（v1 之前只提供主题 CSS 扩展）
- ❌ 移动端
- ❌ AI 功能
- ❌ 自建 Markdown 语法扩展方言（只做 GFM + 少量 Typora 同款扩展）

---

## 8. 待您拍板的决策

| # | 决策点 | 选项 | 我的建议 |
|---|---|---|---|
| D1 | **外壳框架** | Tauri 2 / Electron 44 / Wails 3 | **Tauri 2**（包体 10–20MB vs 200MB，内存 1/3，Rust 后端直接服务于搜索/监听/PDF 直出）。退路：Electron 44，前端代码 100% 复用 |
| D2 | **编辑内核** | Milkdown 7 / 自研 CM6 装饰 / Tiptap 3 | ✅ **已定：CodeMirror 6**（2026-10-20 实测定案 → **2026-10-21 用户正式拍板选 B**）。原建议 Milkdown 被实测推翻——Milkdown 的 mark 不含标记符文本，做不到直接编辑 `**`；且其 `**text**` 走 input rule，要打完整个词才转换，与 Typora 实时手感相反。**拍板判据是三条设计红线**（真相源是 Markdown 文本 / 源码模式无损 / 解析规则唯一），Milkdown 在前两条上做不到。代价（表格公式图表渲染层、写作 UI）转为我们自建，排期 M2。详见 §2.3 |
| D3 | **项目命名与路径** | `inkstone`（砚）/ `Inkstone` / 其他 | 暂用 `~/Documents/GitHub/inkstone`，**名字您随时改** |
| D4 | **许可证** | MIT / Apache-2.0 | **MIT**（最大包容性，便于被集成进各类闭源工具） |
| D5 | **首版差异化** | 通用写作 / 学术写作（公式+文献+引用管理） | **通用打地基，把学术写作作为首个差异化亮点**——公式/脚注/引用是 Typora 用户最常吐槽的部分，也最契合您的实际需求 |
| D6 | **pandoc 依赖方式** | 内置 / 调用系统安装 / 两者 | **调用系统安装**（本机已有 3.8），检测不到时给安装引导，保持安装包小 |
| D7 | **是否现在就装 Rust** | 先装 / 先用 Electron 起步 / 用 Wails | **先装 Rust**（`brew install rustup`，约 1.5GB）。若您觉得这一步麻烦，Electron 是零摩擦替代 |
| D8 | **语法高亮库** | Shiki / Prism / highlight.js | ✅ **已定：highlight.js `lib/core`**（2026-10-22）。原计划 Shiki → 先试 Prism → 换 highlight.js。**Shiki 出局**：要 wasm + 异步 `createHighlighter`，编辑器里每敲一个字符都要重排高亮，异步会抖。**Prism 出局**（实测翻车）：语言组件是副作用式注册到**全局** `Prism`，rollup 生产构建改变模块执行顺序后「注册在一个实例、读取在另一个实例」，`Prism.highlight` **静默降级成纯文本不报错**（dev 正常、preview 产物无 token）——发布阻断级缺陷。**highlight.js** 的 `lib/core` 是干净单例，`registerLanguage` 显式注册，语言模块是纯函数，不碰全局，三处行为一致；生产产物已实证。代价：raw 比 Prism 等价集多 97 KB（172.2 → 269.3 KB / gzip ≈ +40 KB），判断为「买正确性，值得」。详见 §2.5 与 AGENTS.md |
| D9 | **行内公式定界符** | 单 `$` 开 / 单 `$` 关 / 加启发式（中文、空白） | ✅ **已定：默认开 + 用上游 `singleDollarTextMath` 做设置项**（2026-10-22）。**调研**：Typora / VS Code / MarkText / Obsidian / GitHub 六个商业编辑器全部默认开单 `$`（其中 Typora、VS Code、MarkText 有开关，Obsidian 与 GitHub 没有）。`$` 与货币的冲突是公认的老大难。**为什么不用启发式方案**：`remark-math` 把选项原样透传给 `micromark-extension-math@3.1.0`，后者有 `singleDollarTextMath` 一等选项，官方描述就是「reducing interference with regular dollar signs in text」——所以这是**语义层的开关**，编辑器与导出天生一致，不破红线 C；自己加中文/空白启发式反而会让编辑器认一套、remark 认另一套。**关键性质**：关掉后 `$$x^2$$` 在行内**仍然**是行内公式，所以关掉不等于失去行内公式。详见 AGENTS.md「行内公式定界符」 |

---

## 9. 开工前检查清单

- [x] **清理磁盘** —— 49 GB → 64 GB（已清 uv / pip / npm / Homebrew 缓存，共约 15 GB）
- [x] **安装 Rust** —— rustup 1.29.1 + stable rustc 1.99.1，PATH 已写入 `~/.zshrc` 与 `~/.bash_profile`
- [x] **初始化仓库** —— `~/Documents/GitHub/inkstone`，MIT 协议，`.gitignore` 完整
- [x] **round-trip 测试语料库** —— **13 份**真实 Markdown 样本，覆盖表格/任务列表/数学/mermaid/脚注/YAML/边界情况，
  外加中文技术写作、各类链接与图片、引用与嵌套列表、转义与 HTML 实体、空白敏感内容、混合块结构、
  Typora 扩展语法，以及一份 470 行的长文档（兼作性能压测样本）
- [x] **依赖许可证白名单 CI** —— 自动扫描 `package.json` / `Cargo.lock` / cargo registry 缓存
- [x] **M1 前置**：把 `EditorSurface` 的 textarea 替换为 CodeMirror 6 内核，接入 Live Preview 装饰器插件
- [x] **M1 剩余**：中文 IME 人工验证 ✅（2026-10-21）、自动配对 ✅、三种标记符显示策略 ✅、
  复制粘贴 HTML → Markdown ✅
- [x] **M1**：lezer 增量解析 ✅（2026-10-21，击键成本降 3 倍，增量 vs 全量 0% 不一致）
- [x] **M1 剩余**：复制为 HTML / 粘贴为纯文本 ✅（2026-10-21）
- [ ] **M2**：表格/公式/图表渲染层、局部重建装饰器

### 本机环境快照（2026-10-20）

| 项 | 值 |
| --- | --- |
| Node / pnpm | v26.8.2 / 10.7.1 |
| Rust | rustc 1.99.1 (stable, aarch64-apple-darwin) |
| Tauri | CLI 2.12.3，crate tauri 2.12.4 |
| React / Vite / TS | 19.3.1 / 8.3.4 / 5.9.3（TS 7.0.2 尚未适配 typescript-eslint 8.72，故锁 5.9） |
| pandoc | 3.8（导出桥立即可用） |
| 磁盘可用 | 64 GB |

---

## 10. 附：调研方法与可核验性

- 版本号、star 数、许可证、最近提交时间：**GitHub REST API + npm registry + crates.io 实测**，非记忆值
- Typora 功能清单：**support.typora.io 全站文档逐页抓取**（见 `docs/typora-feature-inventory.md`）
- 竞争项目数据：GitHub API 批量查询 50+ 仓库元数据 + releases Atom feed
- 本机环境：全部命令实跑验证

> 本文档中所有事实性数据均可按上述路径复现。若后续要写进 README 或对外宣传，建议重新跑一遍校验。

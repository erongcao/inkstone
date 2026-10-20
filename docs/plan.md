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

### 当前进度：M0 已完成，M1 spike 已完成（2026-10-20）

| 交付项 | 状态 | 实测 |
| --- | --- | --- |
| Tauri 2 + React 19 + Vite 8 + TS 5.9 工程骨架 | ✅ | 应用包 **3.70 MiB**（Electron 方案约 200 MB） |
| 主题系统（CSS 变量令牌层 + 亮暗双模式 + 用户自定义 CSS） | ✅ | 3 套内置主题 |
| 设置面板（外观/编辑/Markdown/导出/通用，深合并持久化） | ✅ | 组件测试覆盖 |
| Markdown 解析层（remark + GFM + YAML + 数学 + 脚注） | ✅ | mdast 为唯一语义来源 |
| round-trip 无损性测试基线 | ✅ | 5 份语料 × 3 断言，**全部通过** |
| macOS 原生菜单栏（含应用菜单、快捷键、事件转发） | ✅ | Rust `on_menu_event` → 前端 |
| 文件打开/保存（原子写入）/另存为 | ✅ | 写临时文件 + rename |
| `.md` 文件关联 + 从 Finder 打开 | ✅ | Info.plist `CFBundleDocumentTypes` 已注册，端到端验证通过 |
| 最近文件记录（M3 前置） | ✅ | `recent-files.txt` 写入验证通过 |
| 依赖许可证白名单扫描 | ✅ | 246 条依赖零违规 |
| CI（lint/test/build/打包 × 4 平台） | ✅ | `.github/workflows/ci.yml` |
| 组件交互测试（jsdom） | ✅ | 30 个测试全绿 |
| **编辑内核选型 spike** | ✅ | **实测推翻原定 Milkdown，改用 CodeMirror 6**（见 §2.3） |
| **Live Preview 装饰器** | ✅ | 行内标记隐藏/展开、块级标记弱化、标题层级渲染，浏览器内实测通过 |
| **源码模式 ↔ 混合模式** | ✅ | 同一 EditorView 切装饰器，**光标位置精确保留**（实测） |
| **解析性能基准** | ✅ | remark 1000 行 p95 = 10.96ms 超标；lezer = 1.05ms |

**实测数据**：空闲内存 102 MB（目标 < 150 MB）；release 构建 51 s；应用包 3.70 MiB。

**M1 待办**：中文 IME 组字过程人工验证、lezer 增量解析、表格/公式/图表渲染层。

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
> 理由与实测数据见 §2.3。

| 层 | 选型 | 版本 | 许可证 | 成熟度 |
|---|---|---|---|---|
| **外壳** | **Tauri 2** | `@tauri-apps/cli` 2.12.3（2026-10-14） | Apache-2.0 | 稳定（v3 已进 alpha） |
| **编辑内核** | **CodeMirror 6** | `@codemirror/view` 6.43.15 | MIT | 事实标准（VSCode 同源） |
| **语义解析** | **remark / unified / mdast** | remark 9.0k★ | MIT | 事实标准 |
| **编辑视图布局** | **lezer / @lezer/markdown** | 1.8.1 | MIT | 活跃（CodeMirror 同源） |
| **语法高亮** | **Shiki** | v4.5.0（2026-10-01） | MIT | 活跃 |
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
读 `node_modules/@milkdown/core/src/mark/strong.ts` 源码可见，strong 是 ProseMirror 的 **mark**，
`**` 两个字符在序列化时生成，**正文里只有「粗体」二字**。

这直接击穿了 Typora 式体验的核心前提——「行内标记符号本身是真实的文档内容，可以直接编辑」。
用 Milkdown 做不到「像普通文本一样编辑 `**`」。

**证据二：源码模式 ↔ 混合模式切换在 Milkdown 下代价极高。**
原计划是「序列化 + 重解析」来回切，这会带来：撤销栈分裂、光标位置需要手动映射、
多次切换后文档可能漂移。CodeMirror 6 路线下，两种模式是**同一个编辑器实例**切换装饰器，
光标、滚动、撤销栈天然保持（已实测，见下）。

**证据三：remark 全量解析撑不住每击键重解析。**
实测（`scripts/bench-parser.ts`，2026-10-20）：

| 文档规模 | remark p95 | lezer p95 | 16ms 交互预算 |
|---|---|---|---|
| 200 行 / 3 KB | 3.79 ms | 0.39 ms | 都过 |
| 1000 行 / 14 KB | **10.96 ms** | 1.05 ms | remark 已逼近上限 |
| 3000 行 / 43 KB | **28.95 ms** | 1.82 ms | **remark 超标** |

编辑视图要求每击键即时更新布局 → 只能用 lezer。

#### CM6 路线实测结果（2026-10-20，浏览器内验证）

| 能力 | 实测结果 |
| --- | --- |
| 行内标记隐藏/展开 | ✅ `**` `*` `` ` `` `~~` 链接的括号与网址全部按规则隐藏/展开 |
| 展开判定 | ✅ 光标进入结构 → 标记变回真实可编辑文本；移出 → 重新隐藏；同时只有一个结构展开 |
| 源码模式 | ✅ 切过去是纯 Markdown 原文，标记全部消失 |
| 模式切换保持光标 | ✅ 切到源码再切回，`cm-activeLine` 仍在原行、该行的 `**` 仍是展开态 → **光标精确保持** |
| 中文文本输入 | ✅ 中文正常输入、装饰实时跟随（**IME 组字过程未能用合成事件验证，需人工测**） |

**已知代价**：CM6 没有富文本语义，表格 / 公式 / 图表 / 脚注编号的渲染层要自己实现，
这是 M2 的工作量（Milkdown 本来白送一部分）。但换来的是「标记符可编辑 + 模式切换零漂移」这两条硬需求。

#### 保留的 Milkdown 结论

- Milkdown 迭代快、API 会变 → 若将来要用，**只依赖它的插件层 API**
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

- **代码高亮：Shiki v4.5.0**（TextMate 语法，VSCode 同款效果，支持亮/暗双主题）。体积大 → 用 `createHighlighter` 加载 **约 40 种精选语言**，其余按需加载。
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
| Milkdown | 12.0k | MIT | v7.22.3 / 2026-10-10 | ✅ | **我们的内核底座** |
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
│    ├─ 内核（ProseMirror 文档模型 + 插件）                 │
│    ├─ Live Preview 插件（行内标记的隐藏/展开）           │
│    ├─ 源码模式（CodeMirror 6）                           │
│    └─ 模式桥（光标/滚动/选区/撤销栈的跨模式映射）          │
├─────────────────────────────────────────────────────────┤
│  解析层  src/parser/          mdast ↔ 文档树 双向映射      │
├─────────────────────────────────────────────────────────┤
│  渲染层  src/renderer/        代码高亮 / 公式 / 图表 / HTML  │
├─────────────────────────────────────────────────────────┤
│  导出层  src/export/          HTML / PDF / pandoc 桥      │
├─────────────────────────────────────────────────────────┤
│  平台层  src-tauri/           fs / 搜索 / 监听 / 图片 / 打印 │
└─────────────────────────────────────────────────────────┘
```

### 3.2 三条不可动摇的架构约束

**约束 A：单一真相源是 Markdown 文本**
编辑器的内存模型是 ProseMirror 文档树，但**磁盘上的 `.md` 才是权威**。任何编辑操作最终都序列化为 Markdown 写回。绝不做"富文本文件格式"。

**约束 B：源码模式与混合模式共享一个 undo 栈**
Typora 的历史 bug 里有大量"切换模式后撤销行为诡异"。设计上必须做到：两个模式是同一份文档的两种视图，撤销栈在全局唯一。

**约束 C：解析规则唯一**
Typora 的做法是"先转 pandoc native AST，再由 pandoc 转目标格式"，以保证"编辑器里看到的"和"导出出来的"是同一套语义。我们照抄这个思路：**渲染、导出、大纲、脚注编号全部从同一棵 mdast 树派生**。

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
- 中文 IME **组字过程**在标记符边界的行为（**这是 Typora 历史上最痛的坑**，需人工在真机验证）
- 嵌套标记（`**粗体里的 `代码`**`）的装饰嵌套顺序
- 跨段落标记（引用块内的段落标记、列表项前缀）
- 光标在标记符中间时按下方向键的预期行为
- lezer **增量解析**（`TreeEditor`）——目前每次击键全量重解析，大文档下要优化

**退路方案**：如果 Live Preview 的某个边界场景反复出问题，提供"渲染模式 / 源码模式"双模式作为一等公民，而不是硬撑一个"半 WYSIWYG"。**这点必须写进产品原则：源码模式永远可达、永远无损。**
（好消息：CM6 路线下这两模式是同一个实例切装饰器，切换零成本、零漂移。）

---

## 4. 里程碑

### M0 · 地基（目标：2 周）
- [ ] 仓库初始化、MIT 协议、CI（lint / test / build / 打包）
- [ ] Tauri（或 Electron）骨架跑起来，macOS 菜单栏 + 打开 `.md` 关联
- [ ] 主题系统：CSS 变量 + 亮/暗双主题 + 用户自定义 CSS 覆盖
- [ ] 偏好设置面板骨架（配置持久化）
- **验收**：能双击打开一个 `.md`，显示纯文本并滚动流畅

### M1 · 编辑内核（目标：6 周）★ 决定项目成败
- [x] mdast 解析层：GFM + YAML front matter + 数学 + 脚注 + Alerts
- [x] 编辑内核选型 spike（Milkdown vs CM6，实测定案：**CodeMirror 6**）
- [x] 混合编辑：行内标记的实时渲染与展开
- [x] 源码模式，与混合模式**共用同一个 CM6 实例**
- [x] 模式切换：光标位置保持（实测通过；滚动位置由同一 view 保证）
- [ ] 中文输入法全场景测试（拼音/候选框/选词/组合输入）← **需人工在真机验证**
- [ ] lezer 增量解析（`TreeEditor`），避免每次击键全量重解析
- [ ] 撤销/重做、复制粘贴（HTML + Markdown 双格式）、智能粘贴
- [ ] 自动配对
- [ ] 表格 / 公式 / 图表 / 脚注的渲染层
- **验收**：连续写 2000 字不卡顿；中英混排输入法不跳光标；两种模式反复切换 100 次无内容漂移

### M2 · 写作体验（目标：4 周）
- [ ] 大纲面板（实时、点击跳转、锚点 slug 规则）
- [ ] 字数统计（总计 / 选区 / 常驻显示）
- [ ] 表格图形化编辑（增删行列、调列宽、对齐）
- [ ] 任务列表交互（点击勾选写回源码）
- [ ] 代码高亮（Shiki，亮/暗双主题）
- [ ] 数学公式（KaTeX）
- [ ] Mermaid 图表
- [ ] 焦点模式 / 打字机模式
- [ ] Emoji 自动补全
- [ ] 图片：拖放 / 剪贴板粘贴 / 相对路径 / 尺寸调整
- **验收**：一份包含标题、表格、代码块、公式、图表、图片的文档，从写入到导出格式正确

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
| R2 | **中文输入法在标记符边界跳光标** | 🔴 高 | 专门写 IME 测试用例；优先用成熟方案的 IME 处理策略（`compositionstart/end` 期间冻结 decoration） |
| R3 | **单人维护者的持续性** | 🔴 高 | 架构上把"外壳"与"内核"解耦，降低任何一块的退出成本；尽早开源、尽早招人 |
| R4 | **依赖许可证污染**（引入 AGPL 库） | 🟡 中 | 建立依赖许可证白名单 + CI 自动扫描；只用 MIT/Apache/BSD |
| R5 | **磁盘空间** | 🟢 低（已缓解） | **实测：清理 15 GB 后剩余 64 GB**。已清 uv(7.4G)/pip(5.9G)/npm(3.5G)/Homebrew(1.4G) 缓存；模型缓存（modelscope 63G / lm-studio 43G / huggingface 20G）属用户资产，**未动**，需要时用户可自行清理 |
| R6 | **核心依赖上游停更** | 🟢 低（已下调） | **实测：ProseMirror 主仓库虽 archived（2026-04-01），但 npm 包仍在发版**（view 1.42.6 / 2026-09-25，model 1.25.12 / 2026-09-21）；Milkdown v7.22.3 于 2026-10-10 发布。**选定 CM6 路线后本风险进一步下降**——CodeMirror 6 是 VSCode 同源，CodeMirror 团队仍在高频维护 |
| R7 | **Markdown round-trip 有损**（导出后原文变形，用户发现后失去信任） | 🟡 中 | round-trip 测试语料库；默认关闭所有"美化"行为 |
| R8 | **性能随文档规模劣化** | 🟡 中（已量化） | **实测：remark 1000 行 p95 = 10.96ms、3000 行 = 28.95ms 超 16ms 预算；lezer = 1.05 / 1.82ms**。对策：编辑视图走 lezer 且接增量解析；渲染层只对可视区做渲染 |
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
| D2 | **编辑内核** | Milkdown 7 / 自研 CM6 装饰 / Tiptap 3 | ✅ **已定：CodeMirror 6**（2026-10-20 实测定案，见 §2.3）。原建议 Milkdown 被实测推翻——Milkdown 的 mark 不含标记符文本，做不到直接编辑 `**`；CM6 路线已跑通 Live Preview 与模式切换保持光标 |
| D3 | **项目命名与路径** | `inkstone`（砚）/ `Inkstone` / 其他 | 暂用 `~/Documents/GitHub/inkstone`，**名字您随时改** |
| D4 | **许可证** | MIT / Apache-2.0 | **MIT**（最大包容性，便于被集成进各类闭源工具） |
| D5 | **首版差异化** | 通用写作 / 学术写作（公式+文献+引用管理） | **通用打地基，把学术写作作为首个差异化亮点**——公式/脚注/引用是 Typora 用户最常吐槽的部分，也最契合您的实际需求 |
| D6 | **pandoc 依赖方式** | 内置 / 调用系统安装 / 两者 | **调用系统安装**（本机已有 3.8），检测不到时给安装引导，保持安装包小 |
| D7 | **是否现在就装 Rust** | 先装 / 先用 Electron 起步 / 用 Wails | **先装 Rust**（`brew install rustup`，约 1.5GB）。若您觉得这一步麻烦，Electron 是零摩擦替代 |

---

## 9. 开工前检查清单

- [x] **清理磁盘** —— 49 GB → 64 GB（已清 uv / pip / npm / Homebrew 缓存，共约 15 GB）
- [x] **安装 Rust** —— rustup 1.29.1 + stable rustc 1.99.1，PATH 已写入 `~/.zshrc` 与 `~/.bash_profile`
- [x] **初始化仓库** —— `~/Documents/GitHub/inkstone`，MIT 协议，`.gitignore` 完整
- [x] **round-trip 测试语料库** —— 5 份真实 Markdown 样本，覆盖表格/任务列表/数学/mermaid/脚注/YAML/边界情况
- [x] **依赖许可证白名单 CI** —— 自动扫描 `package.json` / `Cargo.lock` / cargo registry 缓存
- [x] **M1 前置**：把 `EditorSurface` 的 textarea 替换为 CodeMirror 6 内核，接入 Live Preview 装饰器插件
- [ ] **M1 剩余**：中文 IME 人工验证、lezer 增量解析、表格/公式/图表渲染层

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

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
| 外壳 | Tauri 2 | 实测应用包 3.70 MiB；Electron 方案约 200 MB，前端代码可复用但包体代价大 |
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

M0 已完成（2026-10-20），M1 spike 已完成（2026-10-20）：

- 编辑内核从 Milkdown 改选 **CodeMirror 6**（理由见上）
- Live Preview 装饰器已跑通：行内标记隐藏/展开、块级标记弱化、标题层级渲染
- 源码模式 ↔ 实时预览切换已验证**光标位置精确保留**

M1 剩余待办：

- 中文输入法的**组字过程**（拼音候选框）未能用合成事件验证，需要人工在真机上试
- lezer **增量解析**（`TreeEditor`）未接，目前每次击键全量重解析；大文档下需要优化
- 表格、公式、图表的渲染层尚未实现

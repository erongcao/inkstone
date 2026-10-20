# AGENTS.md — Inkstone 开发约定

> 本文件是 Inkstone 仓库的**项目级约定**。任何 AI 助手或贡献者在改动本仓库前请先读它。

## 项目是什么

Inkstone（砚）是一个**开源 Markdown 编辑器**，对标 Typora 的 Live Preview 混合编辑体验。
先做 macOS，后续扩展 Windows / Linux。MIT 协议。

完整背景、竞品调研、选型依据见 `docs/plan.md` 与 `docs/typora-feature-inventory.md`。

## 三条不可动摇的架构约束

违反这三条的 PR 会被直接打回。

### 1. 单一真相源是 Markdown 文本

- 内存模型是 ProseMirror 文档树，但**磁盘上的 `.md` 才是权威**
- 不引入数据库、不引入专有格式、不做"富文本文件格式"
- 任何编辑操作最终都序列化为 Markdown 写回

### 2. 源码模式永远可达、永远无损

- 即使 Live Preview 在某个边界场景出问题，源码模式也必须是完整可用的退路
- 不允许为了"所见即所得"牺牲内容的可逆性

### 3. 解析规则唯一

- **mdast 是全应用唯一的语义来源**
- 渲染、导出、大纲、脚注编号全部从同一棵 mdast 树派生
- 任何模块都不得自己再实现一套 Markdown 解析逻辑

## 技术栈（不要随意更换）

| 层 | 选型 | 备注 |
| --- | --- | --- |
| 外壳 | Tauri 2 | 实测应用包 3.70 MiB；Electron 方案约 200 MB，前端代码可复用但包体代价大 |
| 编辑内核 | Milkdown 7（ProseMirror + remark） | **只依赖它的插件层 API**，核心层做薄封装以便将来直接换用裸 ProseMirror |
| 解析 | remark / unified / mdast | 见约束 3 |
| 源码模式 | CodeMirror 6 | M1 接入 |
| 前端 | React 19 + Vite 8 + TypeScript 5.9 | TS 锁 5.9：typescript-eslint 8.72 尚未适配 TS 7 |
| 高亮/公式/图表 | Shiki / KaTeX / Mermaid | KaTeX 而非 MathJax——同步渲染，编辑器里不抖 |

## 代码约定

- **注释用中文**，解释「为什么」而不是「做了什么」
- 注释里保留**版本号、来源链接、API 签名**等可核验信息
- 遇到不熟悉的 API，**去 `~/.cargo/registry/src/` 读 crate 源码确认签名**，不要凭记忆写
  （Tauri 2.12 的 `Submenu::with_items` 比想象中多一个 `enabled` 参数，`MenuItem::with_id` 的 accelerator 是第 5 个参数——都是踩过的坑）
- 前端状态一律走**模块级 store + `useSyncExternalStore`**，不要在组件里 `useState` 存全局状态
  （组件间共享状态必须同一个实例，否则字数统计、脏标记会不同步——踩过）
- React 19 的 `react-dom/client` **没有默认导出**，必须 `import { createRoot } from "react-dom/client"`

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
src/parser/     Markdown 解析层（唯一语义来源）
src/editor/     编辑内核（M1：Live Preview、源码模式、模式桥）
src/renderer/   渲染层（高亮/公式/图表）
src/export/     导出管线
src/settings/   设置模型与存储
src/theme/      主题注册表与运行时
src/ipc/        与 Rust 侧接口
src-tauri/src/  Rust 后端（document / menu / recent）
tests/corpus/   round-trip 语料库
docs/           计划书与调研文档
```

## 当前状态

M0 已完成（2026-10-20）。M1 编辑内核是下一个里程碑，也是**决定项目成败的关键**：
Live Preview 的行内标记隐藏/展开、中文输入法边界、源码↔混合模式的光标保持，三者都难。

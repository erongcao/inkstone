# Inkstone（砚）

> 一个把 Markdown 源码当作唯一真相、却在屏幕上呈现排版效果的开源编辑器。

对标 [Typora](https://typora.io) 的 Live Preview 混合编辑体验：行内标记实时渲染、源码模式随时可达；文件始终是纯文本，Git 友好。

**状态：M0–M4 已完成，M5 跨平台收尾中**（2026-10-28）——编辑内核、写作体验、文件管理、导出全部可用；界面国际化（简 / 繁 / 英）、三平台 CI 与打包、检查更新已落地。

---

## 三条不可动摇的架构约束

这三条不是口号，是整个项目的判据。技术选型、每个功能的取舍，都拿它们过一遍。

1. **单一真相源是 Markdown 文本**
   编辑器的内存模型**就是** Markdown 源码，一个字符都不多。绝不做「富文本节点里不含标记符」那一套，也绝不引入专有文件格式。

2. **源码模式永远可达、永远无损**
   Live Preview 只是在源码之上叠了一层装饰。哪怕它在某个边界场景出问题，切到源码模式仍必须完整可用——这是用户的退路。

3. **解析规则唯一**
   「什么算一个段落、什么算一个章节」是**语义**判断，归 remark/mdast。编辑器每击键走 lezer（性能），导出/大纲/AI 走 remark（语义一致），两者边界规则必须对得上。

---

## 能力现状

| 能力 | 状态 |
| --- | --- |
| Live Preview 混合编辑（行内标记实时渲染 / 展开） | ✅ M1 |
| 源码模式（与预览共用同一个编辑器实例，切换保光标与滚动） | ✅ M1 |
| 中文输入法全场景适配 | ✅ 用户真机验证通过 |
| 增量解析（lezer） | ✅ 击键成本降 3 倍 |
| 代码高亮（highlight.js）、KaTeX 公式、Mermaid 图表 | ✅ M2 |
| 表格图形化编辑、任务列表、脚注、大纲、字数统计 | ✅ M2 |
| 斜杠菜单 / 命令面板（⌘K）、链接浮层、公式编辑面板 | ✅ M2 |
| 图片拖放落盘、相对路径、尺寸 `=WxH` | ✅ M2 |
| 文件树、快速打开（⌘P）、全局搜索、查找替换 | ✅ M3 |
| 多标签页、自动保存、崩溃恢复、文件监听与冲突提示 | ✅ M3 |
| AI 助手（改写 / 总结，预览后接受、可撤销） | ✅ M3-2 |
| HTML / PDF / pandoc 导出（DOCX EPUB ODT RTF LaTeX…） | ✅ M4 |
| HTML 导出保留 Markdown 里的原始 HTML（`<div>` / `<img>` / `<details>`） | ✅ M4 |
| 导出项可自定义（增删、重排、重命名、绑定快捷键） | ✅ M4 |
| 导出变量系统、YAML front matter 覆盖导出设置 | ✅ M4 |
| 导出的主题与排版跟屏幕上完全一致（主题令牌由 CSS 生成） | ✅ M4 |
| 主题的字体真的生效（字体留空 = 跟随主题，填了才覆盖） | ✅ M4 |
| 界面国际化（简 / 繁 / 英，界面 + 原生菜单） | ✅ M5-3 |
| 检查更新（查 GitHub Releases，给下载页链接） | ✅ M5-4 |
| Windows / Linux 三平台 CI 与打包 | ✅ M5-5 |
| 自动更新（下载并替换安装包） | ⏳ |

完整路线图见 [`docs/plan.md`](docs/plan.md)。

---

## 技术栈

| 层 | 选型 | 为什么 |
| --- | --- | --- |
| 外壳 | [Tauri 2](https://tauri.app)（Rust + 系统 WebView） | 包体 10 MB 级、内存 1/3；Rust 侧直接服务于搜索、监听、PDF 直出 |
| 编辑内核 | [CodeMirror 6](https://codemirror.net) | 不用 Milkdown：它的 mark 不含标记符文本，做不到直接编辑 `**`；且 input rule 要打完整个词才转换，与 Typora 的实时手感相反 |
| 解析 | [remark / unified / mdast](https://github.com/remarkjs/remark) | 语义层唯一真相源 |
| 前端 | React 19 + Vite 8 + TypeScript 5.9 | |
| 高亮 | highlight.js `lib/core` | 不用 Shiki（要 wasm + 异步，击键时会抖）、不用 Prism（生产构建会静默降级成纯文本） |
| 公式 / 图表 | KaTeX / Mermaid | |
| 多格式导出 | pandoc（**以独立进程调用，不链接**） | pandoc 是 GPL 程序，链接会让整个应用变成 GPL 作品；独立进程调用不传染 |

### 选型踩坑记录

`AGENTS.md` 里记了每一条实测过的坑——包括但不限于：

- CM6 的 `view.setState()` **不触发** `updateListener`（编辑必须走 `dispatch`）
- `grid` 容器只写列不写行，内容会被裁且滚不动
- 原生菜单加速键与 CM6 键位撞车时，**后绑的功能彻底失效**
- Prism 在 rollup 生产构建后「注册在一个实例、读取在另一个实例」，高亮静默降级

---

## 性能实测

| 指标 | 实测 | 预算 |
| --- | --- | --- |
| 冷启动到可输入 | — | < 1.5s |
| 4000 行文档击键（lezer 增量解析） | **1.53ms** | — |
| 全文解析（remark，1000 行） | 11ms（p95） | — |
| 1001 个文件全局搜索 | **12.9ms** | < 200ms |
| 应用体积（macOS .app） | **9.19 MiB** | — |
| 空闲内存 | — | < 150MB |

增量解析与全量解析做过 **900 轮随机编辑对拍，0% 不一致**。

---

## 开发

### 环境要求

- Node.js ≥ 22、pnpm ≥ 10
- Rust stable
- macOS: Xcode Command Line Tools；Linux: `libwebkit2gtk-4.1-dev` 等（见 `.github/workflows/ci.yml`）

### 常用命令

```bash
pnpm install        # 安装依赖
pnpm tauri:dev      # 启动桌面应用（热重载）
pnpm dev            # 仅启动前端（浏览器调试，文件读写降级为内存模式）
pnpm typecheck      # 类型检查
pnpm lint           # ESLint（0 warning 门禁）
pnpm format         # Prettier
pnpm test           # 单元测试 + round-trip 测试
pnpm licenses:check # 依赖许可证白名单扫描
pnpm tauri:build    # 打包桌面应用
```

### 质量门禁

提交前本地跑通（CI 同样强制）：typecheck / lint / format:check / test / licenses:check / cargo fmt / cargo clippy / cargo test。

**round-trip 测试是本项目最重要的质量基建**：13 份真实 Markdown 语料，每次提交都跑「解析 → 序列化 → 再解析 → 结构等价」断言。没有它，Live Preview 会慢慢腐蚀用户文件。

---

## 目录结构

```
src/
  ├─ parser/     Markdown 解析层（唯一语义来源，remark/mdast）
  ├─ editor/     编辑内核（CM6 封装 + Live Preview 装饰器）
  ├─ renderer/   渲染层（高亮 / 公式 / 图表）
  ├─ export/     导出管线（注册表 / 变量 / front matter / HTML / PDF）
  ├─ ai/         AI 能力（provider / 端点预设 / 上下文切片 / 写回契约 / 面板）
  ├─ settings/   设置模型与存储
  ├─ theme/      主题注册表与运行时
  ├─ ipc/        与 Rust 侧的接口
  └─ views/      界面组件
src-tauri/src/   Rust 后端（document / menu / search / watch / pandoc / print / ai）
tests/corpus/    round-trip 语料库
scripts/         开发工具脚本（bench / verify-incremental / check-licenses）
docs/            计划书与调研文档
```

`AGENTS.md` 是**给 AI 与协作者看的工程手册**：每条架构决策、每个踩坑、每个「为什么这么写」都在里面。

---

## 参与

欢迎提 issue 和 PR。开始前请先读 [`AGENTS.md`](AGENTS.md) 与 [`docs/plan.md`](docs/plan.md)——
尤其是那三条架构约束，它们是所有取舍的判据。

## 许可证

[MIT](LICENSE)

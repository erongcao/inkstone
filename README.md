# Inkstone（砚）

> 一个把 Markdown 源码当作唯一真相、却在屏幕上呈现排版效果的开源编辑器。

对标 [Typora](https://typora.io) 的 Live Preview 混合编辑体验：行内标记实时渲染、源码模式随时可达；文件始终是纯文本，Git 友好。

**状态：M0 开发中** — 骨架、主题系统、设置面板、原生菜单、文件读写已可用；Live Preview 编辑内核（M1）尚未实现。

---

## 特性（当前进度）

| 能力 | 状态 |
| --- | --- |
| 应用骨架（侧边栏 / 编辑区 / 状态栏） | ✅ M0 |
| 主题系统（CSS 变量 + 亮/暗双主题 + 用户自定义 CSS） | ✅ M0 |
| 三套内置主题（Inkstone / GitHub / 学术写作） | ✅ M0 |
| 设置面板（外观 / 编辑 / Markdown / 导出 / 通用） | ✅ M0 |
| macOS 原生菜单栏（含应用菜单、快捷键） | ✅ M0 |
| 文件打开 / 保存（原子写入）/ 另存为 | ✅ M0 |
| Markdown 解析层（GFM + YAML + 数学 + 脚注） | ✅ M0 |
| round-trip 无损性测试基线 | ✅ M0 |
| **Live Preview 混合编辑** | ⏳ M1 |
| 源码模式 / 模式桥（光标与滚动保持） | ⏳ M1 |
| 中文输入法全场景适配 | ⏳ M1 |
| 大纲面板 / 表格编辑 / 任务列表交互 | ⏳ M2 |
| 代码高亮 / KaTeX / Mermaid | ⏳ M2 |
| 文件树 / 快速打开 / 全局搜索 | ⏳ M3 |
| HTML / PDF / pandoc 导出 | ⏳ M4 |
| Windows / Linux / 自动更新 / i18n | ⏳ M5 |

完整路线图见 [`docs/plan.md`](docs/plan.md)。

---

## 技术栈

| 层 | 选型 |
| --- | --- |
| 外壳 | [Tauri 2](https://tauri.app)（Rust + 系统 WebView） |
| 编辑内核 | [Milkdown 7](https://milkdown.dev)（ProseMirror + remark）— M1 接入 |
| 解析 | [remark / unified / mdast](https://github.com/remarkjs/remark) |
| 源码模式 | CodeMirror 6 — M1 接入 |
| 前端 | React 19 + Vite 8 + TypeScript 5.9 |
| 高亮 / 公式 / 图表 | Shiki / KaTeX / Mermaid — M2 接入 |
| 多格式导出 | pandoc（以独立进程调用，不链接） |

---

## 开发

### 环境要求

- Node.js ≥ 22
- pnpm ≥ 10
- Rust stable（macOS: `brew install rustup && rustup-init`）
- macOS: Xcode Command Line Tools

### 常用命令

```bash
pnpm install        # 安装依赖
pnpm tauri:dev      # 启动桌面应用（热重载）
pnpm dev            # 仅启动前端（浏览器调试，文件读写降级为内存模式）
pnpm typecheck      # 类型检查
pnpm lint           # ESLint
pnpm test           # 单元测试 + round-trip 测试
pnpm licenses:check # 依赖许可证白名单扫描
pnpm tauri:build    # 打包 macOS 应用
```

### 目录结构

```
src/                    前端
  ├─ editor/            编辑内核（M1：Live Preview、源码模式、模式桥）
  ├─ parser/            Markdown 解析层（唯一语义来源）
  ├─ renderer/          渲染层（代码高亮 / 公式 / 图表）
  ├─ export/            导出管线
  ├─ settings/          设置模型与存储
  ├─ theme/             主题注册表与运行时
  ├─ ipc/               与 Rust 侧的接口
  └─ views/             界面组件
src-tauri/              Rust 后端
  ├─ src/document.rs    文件读写
  └─ src/menu.rs        原生菜单
tests/corpus/           round-trip 测试语料库
themes/                 主题 CSS
docs/                   计划书与调研文档
```

---

## 设计原则

1. **文件即文件** —— `.md` 永远是纯文本，Git 友好，任何编辑器都能打开。不引入数据库、不引入专有格式。
2. **不丢失用户的字节** —— 保存时不动用户没碰过的字符；所有"美化"操作默认关闭。
3. **快** —— 冷启动 < 1.5s，输入延迟 < 16ms，空闲内存 < 150MB。
4. **源码模式永远可达、永远无损** —— 即使 Live Preview 在某个边界场景出问题，源码模式也必须是完整可用的退路。

---

## 参与

欢迎提 issue 和 PR。开始前请先阅读 [`docs/plan.md`](docs/plan.md) 里的架构约束，尤其是"解析规则唯一"和"单一真相源是 Markdown 文本"这两条。

## 许可证

[MIT](LICENSE)

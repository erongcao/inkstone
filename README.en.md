# Inkstone (砚)

> An open-source editor that treats the Markdown source as the single source of truth, yet renders it with typeset polish on screen.

Typora-style Live Preview hybrid editing: inline markers render as you type, and source mode is always one keystroke away. Files stay plain text — Git-friendly.

**Status: v0.2.0 released** (2026-10-29) — the editing core, writing experience, file management, export, and cross-platform builds all work; this release adds **AI Q&A mode (BM25 retrieval + citation traceability)**, **custom endpoints with a connection test**, and **switching models inside the AI panel**, and fixes three export inconsistencies involving Mermaid diagrams, GitHub alert blocks, and footnotes.

[简体中文](README.md) · [Changelog](CHANGELOG.en.md) · [What's new in v0.2.0](docs/release-0.2.0.en.md) · [Roadmap](docs/plan.md)

---

## Three Non-Negotiable Architectural Constraints

These three aren't slogans — they're the criteria the whole project is judged against. Every technology choice and every feature trade-off gets run past them.

1. **The single source of truth is the Markdown text**
   The editor's in-memory model **is** the Markdown source, not one character more. We never do the "rich text nodes that don't contain marker characters" trick, and we never introduce a proprietary file format.

2. **Source mode is always reachable and always lossless**
   Live Preview is only a layer of decoration on top of the source. Even if it breaks in some edge case, switching to source mode must still work completely — that's the user's way out.

3. **One set of parsing rules**
   "What counts as a paragraph, what counts as a section" is a **semantic** question, so it belongs to remark/mdast. The editor uses lezer on every keystroke (performance); export, outline, and AI use remark (semantic consistency). The two have to agree on where the boundaries are.

---

## Feature Status

| Capability | Status |
| --- | --- |
| Live Preview hybrid editing (inline markers render live / expand) | ✅ M1 |
| Source mode (shares one editor instance with the preview; switching preserves cursor and scroll) | ✅ M1 |
| Chinese IME support in every scenario | ✅ Verified on real hardware |
| Incremental parsing (lezer) | ✅ 3× cheaper per keystroke |
| Syntax highlighting (highlight.js), KaTeX math, Mermaid diagrams | ✅ M2 |
| Visual table editing, task lists, footnotes, outline, word count | ✅ M2 |
| Slash menu / command palette (⌘K), link popover, math editor panel | ✅ M2 |
| Drag-and-drop images written to disk, relative paths, size `=WxH` | ✅ M2 |
| File tree, quick open (⌘P), global search, find & replace | ✅ M3 |
| Multiple tabs, autosave, crash recovery, file watching with conflict prompts | ✅ M3 |
| AI assistant (rewrite / summarize, preview before accepting, undoable) | ✅ M3-2 |
| AI Q&A mode (BM25 retrieval + citation traceability, click a source to jump back) | ✅ 0.2.0 |
| Custom AI endpoints (create / edit / delete) + "Test connection" with per-case errors | ✅ 0.2.0 |
| Switch models inside the AI panel (same source as the settings panel), model list survives across panels | ✅ 0.2.0 |
| HTML / PDF / pandoc export (DOCX EPUB ODT RTF LaTeX…) | ✅ M4 |
| HTML export preserves raw HTML in Markdown (`<div>` / `<img>` / `<details>`) | ✅ M4 |
| Captions (figure / table) and auto-numbering (`图 1-1` — the number lives only in the rendered output) | ✅ |
| Paginated export (paper size / margins / chapters start on a new page / table of contents on paper) | ✅ |
| Images inlined as `data:` URIs on export (the artifact is self-contained; PDF no longer loses relative-path images) | ✅ |
| Export targets are customizable (add/remove, reorder, rename, bind shortcuts) | ✅ M4 |
| Export variable system, YAML front matter overrides export settings | ✅ M4 |
| The exported theme and typography match the screen exactly (theme tokens are generated from CSS) | ✅ M4 |
| Theme fonts actually take effect (empty font = follow the theme; only a filled value overrides) | ✅ M4 |
| Mermaid diagrams make it into exports; GitHub alert blocks make it into pandoc exports | ✅ 0.2.0 |
| Unreferenced footnote definitions are no longer silently dropped on export (they stay in place) | ✅ 0.2.0 |
| UI internationalization (Simplified / Traditional / English, UI + native menus) | ✅ M5-3 |
| Update check (queries GitHub Releases, gives a link to the download page) | ✅ M5-4 |
| Three-platform CI and packaging (Windows / Linux / macOS) | ✅ M5-5 |
| Auto-update (downloads and replaces the installer) | ⏳ |
| PDF export with real page numbers | ❌ Platform limit, see [What's new in v0.2.0](docs/release-0.2.0.en.md#4-pdf-real-page-numbers-why-not-possible) |

The full roadmap lives in [`docs/plan.md`](docs/plan.md) (Chinese).

---

## This Release: v0.2.0 (2026-10-29)

This release takes AI from "can rewrite, can summarize" to "can ask, can trace its sources", and fixes three inconsistencies along the export paths. Item by item, see **[What's new in v0.2.0](docs/release-0.2.0.en.md)**.

**AI Q&A mode (new)**

- Ask a question → BM25 retrieval pulls out the relevant sections → they're assembled into a request with numbered sources → the answer comes back with `[n]` citations
- The panel lists the sources the answer **actually cited**; click one to jump back to that passage in the original text
- Retrieval chunks are delimited by **headings** (one section per chunk), and the words in the heading are indexed too — a section titled "# 安装" ("Installation") whose body doesn't repeat the title word can still answer "安装怎么操作" ("How do I install")
- If retrieval finds nothing, it says "No content related to this question was found in the document" (「文档里没有找到与这个问题相关的内容」); if the model cites a source number that doesn't exist, it says "Source N does not exist" (「第 N 号来源不存在」) — **we don't cover for the model**

**AI endpoint management (new)**

- Custom endpoints: create / edit / delete (OpenAI-compatible protocol + custom base URL); the keys go into the system keychain
- An endpoint id must not collide with a built-in endpoint (the id is the account name in the keychain; a collision lets a custom endpoint silently take over a built-in key)
- "Test connection" reports per-case errors: wrong key / the service has no "list models" endpoint / wrong path / rate limited / server error
- You can switch models inside the AI panel — same source as the settings panel; the model list survives across panels

**Three export fixes**

- Mermaid diagrams now make it into exports (they used to render on screen but export as source)
- GitHub alert blocks now make it into pandoc exports (pandoc has no alert extension, so they're rewritten as "blockquote + bold heading")
- Unreferenced footnote definitions are no longer **silently dropped** — they stay in place as written, and the export tells you how many went unreferenced

---

## Tech Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Shell | [Tauri 2](https://tauri.app) (Rust + the system WebView) | 10 MB-scale bundle, 1/3 the memory; the Rust side directly powers search, file watching, and PDF output |
| Editing core | [CodeMirror 6](https://codemirror.net) | Not Milkdown: its marks don't carry the marker text, so you can't edit `**` directly; and its input rules only convert after the whole word is typed, the opposite of Typora's live feel |
| Parsing | [remark / unified / mdast](https://github.com/remarkjs/remark) | The single source of truth for the semantic layer |
| Frontend | React 19 + Vite 8 + TypeScript 5.9 | |
| Highlighting | highlight.js `lib/core` | Not Shiki (it needs wasm + async, which jitters while typing), not Prism (it silently degrades to plain text in production builds) |
| Math / diagrams | KaTeX / Mermaid | |
| Multi-format export | pandoc (**invoked as a separate process, not linked**) | pandoc is a GPL program; linking it would turn the whole app into a GPL work, and invoking it as a separate process doesn't taint anything |

### Lessons Learned While Choosing

`AGENTS.md` records every pitfall we've actually hit — including but not limited to:

- CM6's `view.setState()` does **not** fire `updateListener` (edits must go through `dispatch`)
- A `grid` container with only columns and no rows clips its content and won't scroll
- When a native menu accelerator collides with a CM6 keybinding, **the feature bound later stops working entirely**
- After a rollup production build, Prism "registers on one instance and reads from another", so highlighting silently degrades

---

## Measured Performance

| Metric | Measured | Budget |
| --- | --- | --- |
| Cold start to editable | — | < 1.5s |
| Keystroke in a 4000-line document (lezer incremental parsing) | **1.53ms** | — |
| Full parse (remark, 1000 lines) | 11ms (p95) | — |
| Global search across 1001 files | **12.9ms** | < 200ms |
| App bundle size (macOS .app) | **9.3 MiB** | — |
| Idle memory | — | < 150MB |

Incremental and full parsing were cross-checked over **900 rounds of random edits with 0% divergence**.

---

## Development

### Requirements

- Node.js ≥ 22, pnpm ≥ 10
- Rust stable
- macOS: Xcode Command Line Tools; Linux: `libwebkit2gtk-4.1-dev` and the like (see `.github/workflows/ci.yml`)

### Common Commands

(The comments inside the block are in Chinese: install dependencies / launch the desktop app with hot reload / front end only, for browser debugging, with file I/O degraded to in-memory mode / typecheck / ESLint (zero-warning gate) / Prettier / unit tests + round-trip tests / dependency license allowlist scan / package the desktop app.)

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

### Quality Gates

Run all of these locally before committing (CI enforces the same set): typecheck / lint / format:check / test / licenses:check / cargo fmt / cargo clippy / cargo test.

**The round-trip tests are the most important quality infrastructure in this project**: 13 real Markdown corpora, and every commit runs a "parse → serialize → parse again → structurally equivalent" assertion. Without them, Live Preview would slowly corrode users' files.

---

## Project Layout

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

Reading the tree: `parser/` is the Markdown parsing layer (the single semantic source, remark/mdast); `editor/` is the editing core (a CM6 wrapper plus Live Preview decorators); `renderer/` is the rendering layer (highlighting / math / diagrams); `export/` is the export pipeline (registry / variables / front matter / HTML / PDF); `ai/` holds the AI capabilities (provider / endpoint presets / context chunking / write-back contract / panel); `settings/` is the settings model and storage; `theme/` is the theme registry and runtime; `ipc/` is the interface to the Rust side; `views/` is the UI components. `src-tauri/src/` is the Rust backend (document / menu / search / watch / pandoc / print / ai); `tests/corpus/` is the round-trip corpus; `scripts/` holds the dev tooling scripts (bench / verify-incremental / check-licenses); `docs/` holds the plans and research documents.

`AGENTS.md` is the **engineering handbook for AI and collaborators** (in Chinese): every architectural decision, every pitfall, every "why is it written this way" lives in there.

---

## Contributing

Issues and PRs are welcome. Please read [`AGENTS.md`](AGENTS.md) (Chinese) and [`docs/plan.md`](docs/plan.md) (Chinese) first — especially the three architectural constraints, since they're the criteria for every trade-off.

Docs: **English** (this page · [`CHANGELOG.en.md`](CHANGELOG.en.md) · [`docs/release-0.2.0.en.md`](docs/release-0.2.0.en.md)) ｜
**中文** ([`README.md`](README.md) (Chinese) · [`CHANGELOG.md`](CHANGELOG.md) (Chinese) · [`docs/release-0.2.0.md`](docs/release-0.2.0.md) (Chinese))

## License

[MIT](LICENSE)

# Inkstone v0.2.0 Feature Notes

> Release date: 2026-10-29 ｜ This is Inkstone's **first official release** (`0.1.0` was only used during development and was never released)
>
> English: [docs/release-0.2.0.en.md](release-0.2.0.en.md) · [Changelog](../CHANGELOG.en.md) · [English README](../README.en.md)

This release takes AI from "can rewrite, can summarize" to "**can ask, can trace its sources**", and fixes three inconsistencies across the export pipelines.

---

## 1. AI Q&A mode (new)

### What it is

Ask a question about your document and Inkstone first uses BM25 to retrieve the most relevant sections, numbers them, and hands them to the model; the model's answer comes back with `[n]` citations, and the interface lists the sources the answer **actually cited** — click one to jump back to that passage in the original text.

### The pipeline

```
document → chunk by ATX heading (boundaries come from mdast)
         → BM25 ranking (zero-score chunks don't make it in, take the top 5)
         → assemble a request with numbered sources
         → streaming request
         → parse the [1] / [1,2] / [1-3] in the answer
         → the panel lists the cited sources (click one to jump back to that passage)
```

### Three rules you can see in the UI

AI output is uncertain, and the interface **doesn't cover for it**:

| Situation | What the interface says |
| --- | --- |
| Nothing relevant was retrieved | "No content related to this question was found in the document" (「文档里没有找到与这个问题相关的内容」) — **we don't let the model make things up** |
| The model cited a source number that doesn't exist | "Source N does not exist" (「第 N 号来源不存在」) — **we don't pretend that passage exists** |
| The model marked no citations | The sources area is empty — **we don't invent one for it** |

### Two design decisions (they decide whether it's usable)

**1. A retrieval chunk is a section, not "a fixed number of characters"**

A retrieval chunk is also the unit of **citation traceability**: every source listed in the panel has to be able to say which section it came from. The earlier implementation merged chunks that were too short with their neighbors, so when two sections' bodies were both under 200 characters they got merged into one chunk and the heading path kept only the first section — the source names and excerpts listed in the panel **didn't match**, and clicking one didn't take you to that section either.

Now: merging happens **only within a section**, never across sections. A short section becomes its own chunk — what the retrieval layer needs isn't big chunks, it's "the chunk's relevance to the question".

**2. Words in the heading have to be searchable too**

The body doesn't necessarily repeat the words in the heading. In a section titled "# 安装" the body might read "打开终端，输入下面的命令" (Open a terminal and type the command below), and a user asks "安装怎么操作" (How do I install) — if only the body is indexed, not one word matches and the retrieval decides "the document has nothing relevant". That's a **false negative**: what the user sees is "nothing found", not "not ranked first", and the former is far worse than a missed recall.

So the index uses "heading path + body", while the body shown to the reader is still pure body text.

### Other trade-offs

- **Heading boundaries come from mdast** (architectural constraint C): a `# comment` inside a code fence, a `> # heading` inside a blockquote, and a `# heading` inside a list item are all not sections — scanning lines for `#` yourself runs straight into these three traps.
- **Chinese word segmentation uses character bigrams**: zero dependencies, zero dictionaries. The repo has no Chinese tokenizer, adding a dependency means passing the license allowlist, and a pure-JS tokenizer is easily several hundred KB. The cost is that words like "实现" and "行进" interfere with each other — a deliberate trade-off: the retrieval layer only has to pull out the relevant passage, and precise word segmentation is left to the model.
- **Zero-score chunks don't make it into the results**: stuffing a pile of irrelevant chunks into the prompt only dilutes the context.

### How to verify it

- Guards: `tests/ai-retrieval.test.ts` (chunking / segmentation / BM25), `tests/ai-qa.test.ts` (request construction and citation parsing), `tests/ai-features.test.tsx` (the panel and write-back)
- Mutation check (they go red): switch the index back to "body only" → 1 guard goes red; switch merging back to "across sections" → 5 guards go red
- Real-machine run (local Ollama / `qwen3.8:27b-mlx`) — the sample document and the model's answer are kept verbatim in Chinese; the sample document's headings are 砚台 / 墨水 / 纸 (inkstone / ink / paper):

  ```
  切块：chunk-1 ["砚台"] / chunk-2 ["墨水"] / chunk-3 ["纸"]
  BM25：命中 chunk-1 ["砚台"] score=2.3100（其余零分不返回）
  请求：[1] 标题路径：砚台 + 该节正文（只有相关那一段）
  模型：砚台多为石材制成，讲究「下墨如漆」，常见的有歙砚与端砚。[1]
  解析：[1] → ["砚台"]
  ```

---

## 2. AI endpoint management (new)

### Custom endpoints

In the settings panel you can create / edit / delete custom endpoints (OpenAI-compatible protocol + custom base URL), and the keys go into the **system keychain**.

Two rules that follow from the data structure:

- **An endpoint id must not collide with a built-in endpoint.** The endpoint id is the account name in the system keychain, and endpoint resolution is "custom first, built-in second" — a collision lets a custom endpoint **silently take over** a built-in endpoint's key, and deleting the custom endpoint takes the built-in key with it. The damage lands on a **different** endpoint, so it's blocked at the data-structure level rather than warned about.
- **An endpoint id can't be changed once created.** Renaming = moving the key = leaving an orphan key behind that **no interface can delete** (the endpoint no longer exists in the UI). It's shown read-only in the interface, with the reason stated.

When you delete an endpoint, its keychain entry is deleted **along with it**, and its model overrides and model list are cleared — otherwise the keychain is left with an orphan nobody can delete.

### "Test connection" reports per-case errors

"Connection failed" tells the user nothing. Now one probe can tell five cases apart:

| Situation | How it's determined |
| --- | --- |
| Wrong key | 401 / 403 |
| The service has no "list models" endpoint | The list endpoint 404s but the chat endpoint works |
| Wrong path | The list endpoint and the chat endpoint **both** 404 |
| Rate limited | 429 |
| Server error | 5xx |

The hard part is that **a 404 has two meanings** and one probe can't tell them apart. The solution is **two probes**: probe the list endpoint first (GET), and on a 404 probe the chat endpoint (POST) — chat works → the service simply has no list endpoint; both 404 → the path is wrong.

The chat-endpoint probe **really does spend 1 token**, and it shows up in the provider's call log. That's a deliberate trade-off: without spending it, you can't tell "the service doesn't support listing models" from "the path is wrong".

The decision layer is written as a **pure function with injectable dependencies** (`probe` / `parse`), so 13 guards can cover every determination combination without touching the network.

### The model list and switching models

- The list hangs off a **module-level store**, keyed by endpoint id — close the settings panel, switch to another endpoint, come back, and the list is still there.
- **You can switch models inside the AI panel** — the **same source** as the settings panel (the same `modelOverrides`).
- Along the way, a real bug is fixed: the loading state used to be compared against a **render snapshot**, which couldn't be cleared after the list loaded — the button would stay stuck on "正在获取模型列表…" and stay disabled forever.

---

## 3. Three export pipeline fixes

| Problem | Before | Now |
| --- | --- | --- |
| Mermaid diagrams | They render on screen; in the export they're a blob of source | The export renders them as SVG; **if rendering fails the source block is kept as-is**, it doesn't quietly turn blank |
| GitHub alert blocks | pandoc has no alert extension, so `> [!NOTE]` comes out as-is | Rewritten as "blockquote + bold heading", which every pandoc output format supports |
| Unreferenced footnote definitions | remark drops them silently; pandoc drops them with a warning | They **stay in place** as written, and the export reports "有 N 个脚注定义没有被引用 / N footnote definitions were not referenced" |

Details:

- **Mermaid is ranked after syntax highlighting.** The approach is to let highlighting **skip** `language-mermaid` blocks (rather than rendering first and having the highlighter wipe it out), so the source block stays byte-for-byte identical when rendering fails. Mermaid is still **lazily loaded** (no static import in the main chunk).
- **Alert blocks are rewritten as "blockquote + bold heading"** because a blockquote and bold are the two things every pandoc output format supports. A fenced div doesn't work (DOCX flattens it), and re-serializing the mdast is even worse (it would reorder the user's text). Verified against real pandoc: the output is `<blockquote><p><strong>NOTE</strong></p><p>这是一条提示。</p></blockquote>`, and nested `>>` comes out right too.
- **Footnote definitions stay in place**, not moved to the footnote section, not dropped, not given invented numbers.

---

## 4. PDF real page numbers: why not possible

It's not that we didn't do it — **there's genuinely no way on the current path**. Each of these was measured:

1. **The current path can't get the PDF file**: `Webview::print()` → macOS's `WKWebView.printOperation:` → the **system print panel**,
   where the user chooses "Save as PDF" themselves. The file lands wherever the user chose, and **the process has no handle to it**.
   Without the file there's no "real page count" to read, and no way to stamp one.
2. **Tauri offers no second path**: Tauri 2.12's `Webview` only has `pub fn print(&self)`, with no `printToPDF` / `createPDF`.
3. **Neither does wry**: wry 0.57's `print_with_options` on macOS internally does
   `NSPrintInfo::sharedPrintInfo()` → set margin → `printOperationWithPrintInfo:` → `runOperation()`,
   with **no opening for injecting a save path**.
4. **No native handle**: wry declares `InnerWebView` as `pub(crate)`, and `tauri_runtime_wry::Webview` doesn't expose it either.
5. **Bypassing Tauri and printing yourself: pagination runs away**. The Swift prototype (a standalone `WKWebView` + `NSPrintOperation`,
   with `NSSavePath` + `NSJobDisposition = NSPrintSaveJob` writing the file directly) turned a
   **3-page document into 960,000–1,750,000 pages**, a 200–455 MB file.
   And `MediaBox` is correct (`[0 0 595 842]`) and the layout width is fine too (595×842, body 338px) —
   which means **the explosion happens inside the print operation**, not because the page size was set wrong.

Real page numbers require "owning the PDF file", which means switching to a rendering path that can write the file directly (bundling Chromium, or implementing pagination yourself) — that's an **architecture change** in scale. So: **we don't fake page numbers** (counting the pages ourselves and guessing, where a wrong guess is invisible to the user).

---

## 5. Other known limitations

- **Windows / Linux aren't verified on real hardware**: fonts, input methods, native menus, and the libsecret fallback path for the keychain are only verified at the CI level; nobody has run it on real hardware.
- The "Auto-number math" switch is still **greyed out** (there is no numbering feature in the code).
- "Export variables" are substituted only in the exported artifact, **not in the body text**.

---

## 6. How to verify this release

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test
pnpm i18n:check && pnpm licenses:check
pnpm gen:shortcuts -- --check && pnpm gen:theme-tokens -- --check
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test --lib
```

Measured on this release: front end **1721 passing / 1 skipped**, Rust **105 passing**; all nine CI jobs green (Rust checks, license allowlist, front end on Node 22 / 24, three-platform packaging).

**The round-trip tests are the most important quality infrastructure in this project**: 13 real Markdown corpora, and every commit runs a "parse → serialize → parse again → structurally equivalent" assertion. Without them, Live Preview would slowly corrode users' files.

---

## 7. Document index

| Language | Home | Changelog | This release |
| --- | --- | --- | --- |
| 中文 | [`README.md`](../README.md) (Chinese) | [`CHANGELOG.md`](../CHANGELOG.md) (Chinese) | [`release-0.2.0.md`](release-0.2.0.md) (Chinese) |
| English | [`README.en.md`](../README.en.md) | [`CHANGELOG.en.md`](../CHANGELOG.en.md) | [`release-0.2.0.en.md`](release-0.2.0.en.md) |

The engineering conventions and pitfall log (`AGENTS.md`) exist only in Chinese — it's an internal handbook for AI collaborators and isn't part of the public distribution.

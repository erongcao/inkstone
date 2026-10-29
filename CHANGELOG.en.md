# Changelog

This file records all notable changes to Inkstone.

The format follows [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),
and version numbers follow [Semantic Versioning](https://semver.org/lang/zh-CN/).

[中文](CHANGELOG.md)

> `0.1.0` was only used during development and was **never released** — the first official release of this project is `0.2.0`.
> Every release we ship comes with installers for all three platforms.

## [Unreleased]

(Changes that haven't been released yet go here)

## [0.2.0] - 2026-10-29

### Added

#### M0 · Foundation

- App skeleton: sidebar / editor area / status bar / multiple tabs
- Theme system: CSS variables + light and dark themes + user-defined CSS; three built-in themes
- Settings panel skeleton and persistence
- Native menu bar (including the app menu and its shortcuts)
- File open / save (atomic write) / save as
- Markdown parsing layer (GFM + YAML front matter + math + footnotes)
- Round-trip lossless test corpus (13 real Markdown documents)

#### M1 · Editing core

- Live Preview hybrid editing: inline markers render live and expand
- Source mode and the preview **share the same editor instance**, and switching preserves the cursor and scroll position exactly
- Three marker display strategies (`live` / `dimmed` / `source`), switchable at runtime
- Chinese IME support in every scenario (verified by a user on real hardware)
- Auto-pairing (`off` / `basic` / `markdown` levels)
- Copy/paste: HTML → Markdown conversion and style cleanup, with Markdown kept as-is
  (⌘C writes `text/plain`, `text/html` and an internal lossless MIME type at the same time)
- **lezer incremental parsing**: the keystroke cost in a 4000-line document drops from 4.58ms to 1.53ms;
  900 rounds of random-edit cross-checks show 0% divergence from the full parse

#### M2 · Writing experience

- Syntax highlighting (highlight.js `lib/core`, 30 languages explicitly registered, light and dark themes)
- Block math (KaTeX, loaded on demand) and inline math (`singleDollarTextMath` exposed as a setting)
- Mermaid diagrams (a lazy-loaded separate chunk)
- Visual table editing (add/remove rows and columns, alignment; **no column widths** — GFM has no width syntax)
- Task list interaction (click to toggle, written back into the source)
- GFM footnote number rendering and two-way jumping
- Outline panel (live, click to jump) and word count
- Slash menu / command palette (⌘K) and a link popover
- Math editor panel (KaTeX rendering + source, two modes)
- Images: drag-and-drop / clipboard paste, relative paths, size `=WxH`
- Hover tooltips for inline code / links / images (pure CSS, zero JS)
- Emoji autocomplete (1914 entries, including Chinese aliases)
- Focus mode / typewriter mode

#### M3 · File management

- File tree sidebar (expanded on demand, not recursive)
- Quick open (⌘P, fuzzy filename matching)
- Global search (across files + regex): 1001 files in **12.9ms**
- Find / replace (regex + `$1` capture groups)
- Multiple tabs (each with its own undo history and dirty flag)
- Autosave (debounced) and crash recovery (throttled snapshots)
- File watching: external change detection and handling for three kinds of conflict
- **AI assistant** (M3-1 / M3-2)
  - Provider interface + three protocols: OpenAI-compatible / Anthropic / Gemini
  - Endpoint presets (including subscription endpoints for the GLM / Kimi coding plans), system keychain, concurrency rate limiting
  - Context chunking goes through **mdast** (selection / paragraph / section / whole document)
  - A floating panel: rewrite (polish / expand / shorten / translate / formal tone)
    and summarize (one-line summary / outline / tags / key points)
  - Write-back contract: **preview first, then accept**; accepting goes through an undoable ordinary
    transaction, and the original text is checked before writing back (if the user has edited it, overwriting is refused)

#### M4 · Export

- Export target registry: 9 built-in formats, split into three paths by `kind` (produced on the front end / pandoc process / WebView print)
- **The pandoc bridge**: invoked as a separate process (GPL doesn't taint), the binary never crosses the JS
  boundary, `tex_math_dollars` is explicitly aligned, and pandoc's warnings come back faithfully
- HTML export: a single self-contained web page (embedded theme CSS + syntax highlighting + KaTeX math + optional outline)
- PDF export: the macOS system print panel (a temporary WebView window + `print()` + `@page` paper size)
- Export variable system (`${title}` `${author}` `${today}` …), substituted only in the exported artifact
- YAML front matter overrides export settings (off by default; only the safe ones are exposed)
- **Export targets are customizable**: add/remove, reorder, rename, bind shortcuts;
  plus 12 additional pandoc formats

#### M5 · Cross-platform

- **The shortcut mapping layer**: `src/shortcuts.ts` becomes the single source of truth,
  and five hand-copied keymaps are all turned into derived values; three scopes (editor / app / both),
  conflict checks across scopes; platform-aware display (symbols on macOS, words on Windows / Linux)
- **UI internationalization**: three languages — Simplified Chinese / Traditional Chinese / English — with 426 UI strings;
  a hand-written lightweight `t()`, zero dependencies; a missing translation falls back to the Chinese original
  instead of showing an unreadable key; native menus have a separate Rust-side string table, and the menu is
  rebuilt when the language changes
- **Update check** (simplest possible form): query GitHub Releases → tell the user → give a download page link;
  reachable from both the native menu and the command palette
- **Two cheat-sheet panels in the Help menu**:
  - "Shortcut overview" — the content is **generated from the shortcut registry**, so it's always consistent with
    the actual bindings, and each entry's scope (global / in-editor / both) is annotated; platform-aware display
  - "Markdown syntax reference" — a syntax cheat sheet **verified by hand** (14 groups / 31 entries),
    listing what Inkstone actually supports rather than syntax that isn't implemented yet
  - Both are reachable from the native menu and the command palette
- **Three-platform CI**: builds and packaging for Linux / macOS / Windows all pass in CI;
  the resulting installers are uploaded as CI artifacts as well (previously the packages were built, but nobody could download them)

#### Completion · Typora inline syntax

- **`==高亮==`**: Typora-style inline highlight, wired end to end —
  - Parsing layer: on the remark side `mdast-util-highlight-mark` + `micromark-extension-highlight-mark`,
    on the lezer side a custom extension of the same name, with **identical flanking criteria on both sides**
    (pinned by 12 cross-check assertions)
  - Live Preview: the markers stay hidden as usual, and the content renders with a highlight background
  - Export: HTML uses `<mark>`, and round-trip keeps `==高亮==` exactly as it was
  - The "Highlight" format command and the syntax cheat sheet take effect in sync
  - Previously this syntax had **the command and the markers, but the parser didn't recognize it** —
    a user could click "Highlight" and still see bare equals signs on screen
  - Two new MIT dependencies: `mdast-util-highlight-mark` and
    `micromark-extension-highlight-mark` (the de facto standard, 4M+ downloads a month each);
    the measured installer increase is **12–24 KB** (≤0.2%, comparing the CI artifacts before and after)

#### Completion · Markdown extension switches actually take effect

- The Markdown switches in the settings panel are no longer **decoration**:
  **11 of the 13 checkboxes** are actually wired up (previously only "treat a single `$` as inline math" was),
  and turning one off makes that syntax become literal text **consistently on screen and in exports**
- Coverage: tables / task lists / footnotes / inline highlight / YAML front matter /
  inline math / block math / mhchem / Mermaid / GitHub alert blocks / single-`$` delimiters
- **Splitting GFM apart costs nothing**: the 10 micromark / mdast sub-extensions are already transitive
  dependencies of `remark-gfm`, so promoting them to direct dependencies is enough (`pnpm add` reports
  `downloaded 0` and fetches no new packages, and the licenses are still the same set of MIT packages);
  the mount order is copied straight from `remark-gfm`.
  The measured front-end bundle increase is **12.9 KB** (8.06 MB → 8.08 MB, 0.16%) —
  those 10 sub-extensions were already in the bundle, and promoting them only makes the import paths
  legal; the genuinely new thing is the alert block plugin (about 3 KB)
- **GitHub alert blocks** (`> [!NOTE]`, upstream `remark-github-blockquote-alert`, MIT):
  rendered in the editor as a colored block with a title badge and exported as a div with an icon;
  the detection rules are cross-checked **case by case** against upstream so the two can't drift
- **mhchem is a real switch now**: with it off, `\ce{…}` displays as **literal text**
  (not blank, not an error, and not silently something else)
- **The syntax cheat sheet follows the switches**: syntax that's turned off disappears from the table,
  and when every example in a group is filtered out, the whole group disappears
- **Format commands follow the switches**: with highlight turned off, the "Highlight" command shows up
  neither in the command palette nor in the slash menu — a format command that does nothing is worse
  than no command at all
- **The two switches we haven't built yet are greyed out with the reason stated**:
  "Auto-number math" (there is no numbering feature in the code at all) and
  "Subscript / superscript" (the editor recognizes it but the export doesn't, so the two would disagree)
  — the latter was completed on 2026-10-27, see the "Subscript / superscript" section below
- An existing gap fixed along the way: **HTML export didn't pass the parse options at all**,
  so exports ignored the user's switches entirely (turn off "Tables" and the export still had tables)

#### Completion · Subscript / superscript (`~文字~` / `^文字^`)

- **A custom micromark extension on the remark side** (`src/parser/subsup.ts`):
  there's no usable off-the-shelf package — `remark-sub`'s regex targets underscores and breaks round-trips,
  `remark-supersub` is a plain-text scan that doesn't pair the markers,
  and `remark-sub-super` is still an old remark 9-era API
- **The rules line up case by case with the lezer side** (lezer uses the built-in
  `Subscript` / `Superscript` from `@lezer/markdown`): a single marker, no whitespace in the content,
  closed on the same line, and a character after `\` counts as escaped. 29 cases are cross-checked
  against the corpus **on both layers** — lezer and remark must reach the same conclusion about the same text
- **The editor, export, clipboard, cheat sheet, and format commands are all wired up**;
  in the settings panel "Subscript / superscript" goes from greyed out to a real, checkable switch
- **Round-trip is lossless**: a `~` / `^` inside the content serializes to `\~` / `\^`,
  otherwise `~a~b~` would come back parsed as "subscript a" + "text b~"
- Bundle cost **+2.5 KB** (0.031%) — the micromark core was already in the bundle
- **Paste recognizes it too**: turndown has **no** `<sub>` / `<sup>` rules by default and drops the tags
  while keeping the content (measured: `H<sub>2</sub>O` → `H2O`) — subscripts and superscripts copied
  from a web page or Word were simply gone on paste.
  Now they convert to `~…~` / `^…^`;
  but conversion happens **only when the produced syntax is itself recognizable** (the criterion is
  `canWrapSubSup`, derived from the same rules as the parser), and otherwise it falls back to plain content —
  otherwise the user would see a visible pair of tildes in the editor that the export can't read either
- **The other source of subscripts and superscripts is covered too**: `<span style="vertical-align: super">`
  (Word / Google Docs don't necessarily use `<sup>` tags), handled by the same criterion

#### Completion · Captions (figure / table) and auto-numbering

- **Convention**: a paragraph that starts with "图：" / "表：" and sits directly next to an image or a table
  counts as a caption (marker = label + colon; figures use `图` / `圖` / `Figure` / `Fig`, tables use `表` / `Table`)
- **The number lives only in the rendered output**: the "图：" in the source always stays "图：",
  and not one byte of the user's `.md` changes (architecture red line 1)
- **Renumbered per chapter**: a top-level heading counts as a chapter and the count restarts inside it
  → `图 1-1`, `图 2-1`; before the first top-level heading there's no chapter number → `图 1`.
  It can also be switched to continuous numbering across the whole document (`图 1`, `图 2`)
- **All four export paths carry the numbers**: HTML / PDF (rewriting the mdast tree before rendering),
  copy as HTML (same as on screen), and the pandoc path (by editing the copy handed to pandoc)
- Settings panel "Markdown → Captions": a switch + the numbering mode
- The edit layer and the semantic layer are **cross-checked**: 13 samples + 13 corpus files, and both
  versions must agree; the marker rules and the numbering rules have **exactly one implementation**, shared by both

#### Completion · Paginated export (paper / margins / page-break rules / table of contents on paper)

- **There is only one implementation of the print stylesheet** (`src/export/print-css.ts`),
  shared by the HTML export and the PDF export — earlier there were two separate ones,
  so the same document paginated differently in the browser and in the PDF
- New settings: **margins** (narrow / normal / wide), **start each chapter on a new page**,
  **include a table of contents when printing**
- Paper size and margins go into `@page` (PDF export); the HTML export **doesn't hard-code the paper**
  — it uses the browser's / print panel's own, otherwise a Letter-size sheet would be laid out as A4
- Page-break rules: figures, tables, and captions don't break across pages; a heading never ends up on a
  different page from its body text
- front matter can override these (`export.pdf.margin` / `chapterBreak` / `includeOutline`),
  and invalid values fall back to the settings panel values
- **Page numbers are impossible** (platform and engine limits, see `AGENTS.md`):
  on macOS we go through the system print panel, Tauri's `print()` takes no arguments,
  and neither Chromium nor WebKit supports `counter(page)`. We don't fake page numbers
- **Fix**: "should there be an outline on screen" and "should there be an outline on paper" are two
  independent switches; earlier only the first one generated the outline markers, so "include a table of
  contents when printing" **spun idle** in the HTML export (it was on in the settings, and the paper still
  had no table of contents). Now the markers are generated when either switch is true, and an outline
  wanted only on paper stays hidden on screen and is shown when printing

#### Completion · Inline images on export (PDF no longer loses relative-path images)

- **The PDF export lost relative-path images**: the HTML used for printing lands in the system temp
  directory, is opened with `file://`, and has no `<base>`, so `![](assets/fig.png)` in the document
  prints as a **broken image**. The HTML export is affected too (move the file and the images break)
- Now images are **inlined as data: URIs** during export — reusing the existing Rust-side
  `read_image_data_url` (the editor already uses it to display images) —
  so the exported artifact is **self-contained**: printing produces images, and the HTML carries them
  wherever you move it
- Remote images are **not fetched over the network**; if one can't be read, its original address is kept
  (one image shouldn't ruin an entire export); the same image is only resolved once; and `<img>` inside
  code blocks isn't caught by mistake
- Verified on real hardware (real Chrome): after inlining, `naturalWidth > 0` (it really decoded);
  without inlining it's `0` (a broken image)

#### Fixed · "Follow system appearance" goes from a dead switch to a real one

- That checkbox used to **make no difference** — the implementation had two `"auto"` branches that
  returned the same value, and across all 12 combinations of input we enumerated, it never changed
  the outcome once
- The semantics now: **on = force following the system** (ignoring the "Light / dark mode" dropdown),
  off = the dropdown decides. Companion change: with it on the dropdown is **greyed out**,
  so users don't pick "Light" and then find that nothing happens
- Migration: the old value was dead and **carried no user intent**, so it's treated as `false` —
  otherwise existing users would lose the light/dark choice they'd made in "Light / dark mode" after
  upgrading. The persisted file therefore gets a **version number**: the migration runs only once, and a
  value the user actively turned on survives the upgrade. **Existing users' behavior is completely unchanged**
- The missing `.field select:disabled` style was added as well — there was **none** before, so a
  greyed-out dropdown looked **exactly like** a usable one, and users could only discover it was
  disabled by clicking and getting nothing. The guard checks the opacity computed at runtime,
  not the stylesheet text

#### Completion · AI assistant: custom endpoints / connection test / model switching / Q&A mode (M3-3)

- **Custom endpoints, from nothing to something**: until now `ai.endpoints` had **only readers**
  anywhere in the project and no interface for creating / editing / deleting. Now the settings panel
  can create, edit, and delete them (OpenAI-compatible protocol + custom base URL)
  - **An endpoint id must not collide with a built-in endpoint**: the endpoint id is the account name in
    the system keychain, and endpoint resolution is "custom first, built-in second" — a collision lets a
    custom endpoint **silently take over** a built-in endpoint's key, and deleting it takes the built-in
    key with it. The damage lands on a **different** endpoint, so we reject it outright
  - **An endpoint id can't be changed once created**: renaming = moving the key = leaving behind an
    orphan key that no interface can delete
  - When you delete an endpoint, its keychain entry is deleted **along with it**, and its model overrides
    and model list are cleared
- **The "Test connection" button**: one probe tells five cases apart —
  wrong key (401/403) / the service has no "list models" endpoint / the path is wrong / rate limited (429) / a server error (5xx)
  - A 404 has two meanings, and **two probes** tell them apart: probe the list endpoint first, and on a 404 probe the chat endpoint
  - The chat-endpoint probe really does spend 1 token, and it shows up in the provider's call log — that's deliberate
  - The decision layer is a pure function with injectable dependencies, and 13 guards cover every combination
- **You can switch models in the AI panel**: it's the **same source** as the settings panel
  (the same `modelOverrides`), no longer the settings panel's exclusive property
- **The model list survives across panels**: it hangs off a module-level store (keyed by endpoint id),
  so closing the panel, switching to another endpoint, and coming back leaves the list intact
  - Along the way, a real bug is fixed: the loading state was compared against a **render snapshot**,
    which couldn't be cleared after the list loaded → the button stayed stuck on "正在获取模型列表…"
    and stayed disabled forever
- **Q&A mode** (M3-3 — the whole feature didn't exist before):
  - The retrieval layer chunks by **ATX headings** (the boundaries come from mdast, the same rules used for rendering / export / outline)
  - Ranking uses **BM25** (IDF = `ln(1 + (N - df + 0.5) / (df + 0.5))`); chunks with a zero score don't make it into the results
  - Chinese word segmentation uses **character bigrams** + a small stopword list (zero dependencies, zero dictionaries, no tokenizer introduced)
  - Panel: a question box + the answer + a **citation traceability** list (click a source to jump back to that passage)
  - If the model cites an out-of-range number → the interface says honestly "Source N does not exist" (「第 N 号来源不存在」) instead of pretending that passage exists
  - If retrieval finds nothing → it says honestly "No content related to this question was found in the document" (「文档里没有找到与这个问题相关的内容」) instead of letting the model make things up
  - The answer can be appended to the end of the document (through an undoable ordinary transaction, checking the original text before writing back)

### Fixed

- **Mermaid doesn't make it into exports** (a break in architectural constraint C): on screen it's a
  diagram, in the export it's a blob of source.
  The export path now renders Mermaid; when rendering fails it **keeps the source block as-is**
  instead of silently turning it blank.
  The approach is to let syntax highlighting **skip** `language-mermaid` blocks (rather than rendering
  first and having the highlighter wipe it out), and Mermaid stays lazy-loaded (`vite build` confirms
  there's no static import in the main chunk)
- **GitHub alert blocks don't make it into pandoc exports**: pandoc has **no** alert / callout extension
  (verified with `pandoc --list-extensions=markdown`), so feeding it `> [!NOTE]` as-is comes back out
  as `[!NOTE]`. Now they're rewritten as "blockquote + bold heading"
  (`> **NOTE**`) — a blockquote and bold are the two things every pandoc output format supports.
  The output was checked against real pandoc, and nested `>>` comes out right too; the rewrite only
  touches the few lines of the alert block and leaves the rest of the text byte-for-byte unchanged
- **Unreferenced footnote definitions were silently dropped on export**: remark (the HTML / PDF path)
  **drops them wholesale** without an error, and pandoc drops them with a warning.
  Now they **stay where they are**, exactly as written (HTML / PDF go through an mdast transform, pandoc
  through source escaping) — not moved to the footnote section, not dropped, not given invented numbers;
  the export result reports "有 N 个脚注定义没有被引用 / N footnote definitions were not referenced"
- **Two real defects in the Q&A mode retrieval layer**:
  - **Merging across sections destroys traceability**: when two sections' bodies are both under 200
    characters they get merged into one chunk and the heading path keeps only the first section →
    the source names and excerpts listed in the panel **don't match**.
    A retrieval chunk is also the unit of citation traceability, so merging now happens
    **only within a section**
  - **Words in the heading weren't indexed**: when the body doesn't repeat the title words (under
    "# 安装" it says "打开终端…"), a user asking "安装怎么操作" doesn't match a single word and it's
    judged "文档里没有相关内容 / the document has nothing relevant" — that's a **false negative**.
    The index now uses "heading path + body", while the body shown to the reader stays pure body text
  - Both guards were verified to **go red when the implementation is removed**: switch the index back
    to body-only → 1 guard goes red; switch merging back to cross-section → 5 guards go red
- **Escapes look different in the editor and in the export**: in the editor `a \\* b` shows as
  `a \\* b` (the backslash is visible), but the export produces `a * b` — lezer's `Escape` node keeps
  the original text, while the semantic layer **resolves** the escape. Now the editor hides the
  backslash (keeping only the escaped character) and restores the original text when the cursor enters
  the escape.
  This **wasn't introduced by subscript / superscript** — escapes in plain text never matched,
  and the same root cause should be fixed together
- **The two sides disagree about alert blocks when a link definition is present**: if the document has
  a link definition like `[!NOTE]: https://…`, mdast parses `[!NOTE]` as a linkReference (not text),
  so the upstream plugin doesn't recognize it — while the editor side scans the raw text and does
  recognize it. The result: a colored alert block on screen, a plain blockquote in the export.
  Now the editor side collects the link reference definition labels first (normalized the way micromark
  normalizes them) and skips anything that matches
- **Only the command palette could be closed with Esc among eight modal dialogs**:
  a dialog doesn't steal focus from the editor, so focus often isn't in the dialog and an `onKeyDown`
  attached to the container never sees the event — it has to be attached to `window`.
  But several panels may be open at once, and a bare global listener would close them all at once —
  now there's a "last in, first out" stack and only the topmost one responds to Esc.
  The dialogs that "demand a decision" (recovery / file conflict) **deliberately don't respond**:
  closing them silently would be the same as choosing "Discard" for the user
- **The benchmark in `tests/incremental-parse.test.ts` doesn't live up to its name**: the two paths
  aren't the same kind of comparison (the incremental path starts from the same base state every time,
  the full path only parses without recomputing decorators), and the assertions are directional, so it
  was always green. Now the same series of edits runs on both sides, each doing "state update + reparse",
  and the only difference is where the tree comes from.
  There was one wrong turn along the way: counting the decorator recomputation — which **both sides have
  to do** — as part of the comparison. In jsdom that step costs an order of magnitude more than parsing,
  so the difference was buried in the noise (only 7% margin left) and CI flipped to
  "incremental 385ms vs full 359ms".
  The current approach compares only one thing — producing the syntax tree — with two warm-up rounds
  plus 5 alternating rounds taking the minimum: a 12× margin (0.67ms vs 8.01ms)
- **`tests/` was never type-checked**: the `include` in `tsconfig.json` only covers `src`, so type
  errors in the test code were a blind spot whenever `pnpm typecheck` reported "all green".
  Enumerating them by hand turned up 36, and a few are **real bugs**:
  `ensureSyntaxTree` was passed a Language as a position (relying on a NaN comparison it happened to
  degenerate into "parse the whole document"), `Range` was imported from a module that never exported it,
  `fontSize` was written into the wrong settings section, `dataset` was used on an `Element`, and an
  upstream plugin was called in the wrong way
- **`tests/` was never linted either**: the other half of the same blind spot.
  Now it's `eslint src tests --max-warnings 0`, and the two problems (a pure expression statement,
  and the generic style of `importOriginal`) are fixed along with it
- **Windows packaging hung on WiX**: the code page of the MSI database is 1252, which can't hold
  Chinese — the Chinese descriptions of the file associations were written into each extension's
  `<ProgId Description>`, and all 7 extensions produced 7 errors.
  The descriptions are now English, and a new `pnpm bundle:check` gate was added (the criterion is
  "can be encoded in Windows-1252")
- **The "Zoom in" shortcut was displayed as `⌘Equal`**: the user presses the key printed `=` on the
  keyboard, so the cheat sheet and the command palette now show `⌘=` (the accelerator side still uses
  `Equal`, because muda's physical key table has no `Plus` and a failed `CmdOrCtrl+Plus` parse is
  silently swallowed)
- **Two dead menu items**: "Markdown syntax reference" and "Shortcut overview" were registered in the
  native menu but nothing handled them, so clicking did nothing — now both have real behavior
- **Searching "缩放" (zoom) in the command palette doesn't find the three zoom commands**: the menu
  labels follow the system convention ("放大 / 缩小 / 实际大小" — Zoom in / Zoom out / Actual size),
  while users type this feature's Chinese name "缩放" —
  **the display name ≠ what users type**. The `keywords` now include "缩放" and "字号"
  (the label still matches the menu text; the keyword is just a fallback entry point)
- **Seven dead settings**: the checkboxes in the settings panel **can be clicked and can be saved**,
  but **nothing in the code reads them** — what users see is "I changed a setting and nothing happened".
  "Smart punctuation", "Strict mode (strict CommonMark)", "Indent first line", "Indent continuation
  lines", and "Spell check" are now greyed out with the reason stated;
  "Send anonymous usage statistics" is **removed outright** — there is no telemetry code anywhere in the
  project, so it was making a **privacy promise that would never be kept**, and it's replaced by a
  factual statement ("本应用不收集任何使用数据：既没有遥测，也没有崩溃上报。/ This app collects no
  usage data: no telemetry, no crash reporting.");
  `ai.chatSystemPrompt` is removed too (the Q&A mode feature didn't exist)
- **A settings coverage guard** (`tests/settings-coverage.test.tsx`):
  every setting must do one of two things — **someone really reads it in the code**,
  or **it's registered in `src/settings/coverage.ts` and is genuinely disabled in the panel**.
  "Has it been read?" is judged with the **TypeScript syntax tree** (grep can be fooled by comments,
  and comments are exactly the easiest thing to comment out);
  "is it greyed out?" is checked against the **rendered DOM** (the word `disabled` appearing in the
  source doesn't count).
  The guard carries a **self-check** — the first version of `fieldPaths()` forgot to advance to the
  leaves, so its assertions were permanently green against an empty set, the classic
  **false green on an empty set**
- **Pasting a table from Word makes the whole table disappear on export** (measured on real Word 15):
  `turndown-plugin-gfm` **only converts tables that have a header row** ("if the first row isn't a
  header, it's kept as raw HTML"), and Word's exported tables are all `<td>` — not a single `<th>` →
  every Word table hits it.
  What's left in the source is a blob of raw HTML (the editor shows the literal tags), and on export
  `remark-rehype` **drops html nodes** by default → **the entire table vanishes, text and all**.
  Now the first row of a headerless table is promoted to `<th>` before conversion (with the in-row
  whitespace text nodes removed and the `<p>` wrappers inside cells unwrapped), so the GFM table rule
  works.
  Three more holes with the same root cause are then closed: `<caption>` invalidates the whole table
  (the caption disappears with it), whitespace text nodes between cells keep the plugin from detecting
  a header, and multiple paragraphs in one cell get glued into "甲乙"
  (the criterion was **copied from the `turndown-plugin-gfm` source**, not guessed)
- **Any block-level element inside a cell breaks the whole table**:
  a GFM table cell **can only be one line**, while every one of turndown's block rules comes with a
  newline (paragraph `\n\n`, list `\n`, blockquote `\n\n> `, code block `\n\n```…```\n\n`).
  The measured output of "put a list inside a cell" is
  `|` / `- x` / `- y` / `|` / `| z |` / `| --- | --- |` —
  the first row is empty, the separator row ends up after the data row, and the table is ruined.
  Now block-level elements are **replaced with inline elements** (not deleted — deleting would also drop
  the inline formatting, and `<li><b>粗</b></li>` would become "粗" without the bold);
  the block list is copied from turndown's internal `blockElements`.
  The separator is picked by content: Chinese uses the enumeration comma "、", everything else uses ", "
- **Pasting from Word adds 8 spaces at the beginning** (measured on a real Word 15 clipboard):
  turndown wraps the input in `<x-turndown>` and parses it, and the DOM parser **flattens** the content
  of `<head>` into that element — so the **whitespace text nodes** between Word's `<meta>` / `<link>`
  tags collapse into single spaces. Worse, turndown's `blankRule` **doesn't remove** whitespace nodes
  when there are void elements at the same level, and Word's head is full of void elements → all the
  whitespace stays.
  Those 8 spaces aren't cosmetic: pasted at the start of a line they make an **indented code block**,
  pasted in the middle of a line they make a **hard line break**.
  Now only `<body>` is handed to turndown (with the leading and trailing whitespace nodes stripped),
  so the head boilerplate never gets in at all
- **Four more dead menu items**: "Source mode" and "Zoom in / Zoom out / Actual size" were likewise
  registered with nobody handling them — clicking did nothing and **raised no error** either
  (⌘/ along with ⌘= / ⌘- / ⌘0 all stopped working).
  The root cause is that `action()` only checks "is the id in the shortcut list",
  and **can't tell whether anyone actually handles it**. Now they're all wired to the intent bus
  and land in the same place as the same-named commands in the command palette; zooming goes through
  **preset font-size steps** (the settings panel's font size is a dropdown, and ±1px would jump to a
  value that isn't in the list), changing `appearance.fontSize` (`--ink-font-size` sits on `html`,
  so the whole app follows)
- **The "Show sidebar" checkbox**: likewise registered with nobody handling it, and even more hidden —
  the checkbox flips itself but the sidebar doesn't move, so users think the sidebar has been collapsed.
  Now it follows the sidebar's real state (changes from the native menu and from shortcuts stay in sync)
- **The exported document doesn't follow the UI language**: the outline titles and `aria-label` in the
  export are **hard-coded Chinese** (the `大纲` key was in the English and Traditional dictionaries all
  along, just never used), and `<html lang>` is hard-coded to `zh-CN` outright. The consequence isn't only
  "English users see Chinese" — with the wrong `lang`, screen readers **pronounce the English body text
  with Chinese pronunciation rules**, and the browser's word-breaking and line wrapping go wrong too.
  Now the titles and `aria-label` go through `t()`, and `lang` follows the UI language (a new
  `htmlLang()` in `i18n/index.ts`).
  The Chinese implementation comments in the export CSS are stripped out along the way — they're for
  maintainers and shouldn't ship inside the user's file
- **In the PDF export and in copy-as-HTML, formulas silently turn into raw LaTeX**:
  the formula renderer (KaTeX, a 603 KB on-demand chunk) and the HTML processor are **two independent**
  on-demand chunks, and `rehypeMath` **doesn't error** when it can't get the renderer — it just leaves
  the formula in the original `<code class="language-math">`.
  The HTML export path waited for the renderer; **the PDF and clipboard paths didn't**.
  So the same document exports as typeset formulas to HTML and as source to PDF — two formats, two
  results, with no warning at all. Now the "wait for the renderer" lives inside the producing functions
  (`buildPrintHtml` becomes async, `ensureMarkdownToHtml` waits on its own), and `exportToHtml`
  **leaves a trace** when it detects unrendered formulas instead of degrading silently
- **The pandoc export path ignores Inkstone's Markdown switches entirely**:
  it hands the raw Markdown straight to the external pandoc, and the input format is **hard-coded** to
  `markdown+tex_math_dollars+yaml_metadata_block`. Two consequences:
  switches the user turned off (tables / task lists / footnotes / subscript and superscript / front matter)
  still **take effect** in the exported Word (even though on screen they're already literal text);
  and pandoc's `==highlight==` syntax is the `mark` extension, which is **off by default**, so it isn't
  in that hard-coded format string — meaning that under the **default settings** the yellow highlight in
  the editor becomes a literal pair of `==` in the exported Word, in all 21 pandoc formats.
  Now the switches are translated into pandoc's input format string (a new `src/export/pandoc-format.ts`),
  passed down through `convertWithPandoc` → the Tauri command → `--from=`.
  Known granularity limit: pandoc has a single `tex_math_dollars` for all dollar-sign math, while
  Inkstone has three finer math switches, so turning off only one of them turns the others off too
- **Raw HTML silently disappears from exports** (a break at the level of content loss):
  `<div align="center">` centering an image or `<details>` collapsing a paragraph of notes is
  **entirely gone** in the exported file — in CommonMark a block-level HTML construct is a single
  `html` node, and dropping the node takes its text with it.
  Inline HTML only looks safe because `Hello <b>world</b> end.` gets split into five nodes
  (text / html / text / html / text) and only the middle two are dropped; and `<br>` glues two words
  into `line1line2`.
  Now **exports keep and render raw HTML** (the maintainer decided this on 2026-10-28),
  while the clipboard path keeps dropping it (less surprise when pasting into Word / email).
  The implementation turns on `allowDangerousHtml` in `remark-rehype` — no need to add `rehype-raw`,
  because we don't need to parse the HTML into hast nodes; passing it through as-is is enough.
  The difference between the two paths is pinned by `tests/export-raw-html.test.ts` (both were verified
  to go red)
- **The footnote section's title and back-link label are in English**: both are **only seen by screen
  readers** (the title carries an `sr-only` class, the back link is an `aria-label`), which makes them the
  easiest thing to miss — invisible on screen and hard to cover with tests. The upstream
  `mdast-util-to-hast` comment says it outright: "When your page is not in English, you must define
  translated values". Now they're passed in through `remark-rehype`'s `footnoteLabel` / `footnoteBackLabel`
- **The exported outline links point at the wrong heading**: the anchor ids are paired by "which `<hN>`
  tag is this", and that correspondence only holds "when every heading is a top-level heading" — a heading
  inside a blockquote (`> # 标题`), a heading inside a list item, and raw HTML the user wrote themselves
  (`<h1>标题</h1>`) all consume a slot.
  Measured: with one top-level heading and one blockquote heading in the document, the outline entry's id
  was attached to **the blockquote heading**, and the real outline heading got no id at all — clicking the
  table of contents in the exported file jumped to the wrong place, while the file itself shows nothing
  wrong. Now the id is decided by the **heading node itself** (depth + source offset,
  `src/parser/heading-anchors.ts`, written into hast through mdast's `data.hProperties`),
  and the export parses **exactly one** tree — the outline and the body share the same source, with no
  chance of a second computation
- **front matter's `export.pdf.paperSize` was read but had no effect**:
  `readExportOverrides` reads the field and puts it into `ExportContext.overrides`,
  but `src/export/pdf.ts` used the settings panel value directly —
  with "read export settings overrides from front matter" turned on and `paperSize: Letter` written,
  the exported PDF was **still A4**, with no warning at all.
  "Read but not applied" is worse than "never read": users assume they wrote the format wrong.
  Now the override is wired up, and `tests/export-frontmatter-overrides.test.ts` pins **all four**
  overrides to the artifact (paper size via `@page`, the outline toggle via `<nav>`, the filename template
  via the final filename, and the variables via the substitution result)
- **The exported theme isn't the same theme as the one in the app**: the export's theme tokens are a
  **hand-copied** table that has drifted **38 places** from the app's `src/themes/*.css` —
  the "Academic Writing" theme is dark red + sans-serif in the export and blue + serif in the app,
  so the same document **looks like a different theme** after exporting.
  And the user's chosen font size / line height / writing-area width / font / page background color
  **made it into the export not at all**. Now:
  - Theme tokens are **generated from CSS** (`pnpm gen:theme-tokens`, with a `--check` step added in CI),
    so there's a single source of truth for the tokens and drift is structurally impossible;
  - The user's typography goes into the export (`HtmlExportOptions.typography`), ordered after the theme
    tokens — in the app those are inline styles with the highest priority, and the export has to reproduce
    that effect;
  - The diff colors for syntax highlighting (`.hljs-deletion` / `.hljs-addition`) are no longer hard-coded
- **The "Page background color" setting is dead**: the value is written into `--ink-page-bg`,
  but **no CSS rule uses it** — nothing happens whatever you fill in.
  Now `body`'s background uses `var(--ink-page-bg, var(--ink-bg))` (on both the app side and the export
  side). A more general lesson: **"read it" doesn't mean "use it"**
- UI internationalization: dictionary entries 426 → 486; the "Shortcut overview" display bug is described above
- **A single `~` gets eaten as strikethrough**: `remark-gfm` treats a **single** tilde as strikethrough by
  default (the GFM spec doesn't allow it — that's GitHub being lenient), while lezer only recognizes the
  paired `~~`. The two layers disagree, and the consequence is worse than "not rendered" — `~下标~` shows
  as literal text in the editor, but **the export turns it into `<del>下标</del>`**; the chemical formula
  `H~2~O` is hit the same way. Now the remark side explicitly turns off the single tilde, aligning with lezer
- **The theme's font has never taken effect**: the "Academic Writing" theme declares a serif,
  and switching to it changes **the colors but not the font**.
  The root cause: the typography settings are **inline styles written on `<html>`** (which outrank any
  stylesheet rule), and "Body font" shipped with a concrete font stack filled in by default, which kept
  overriding the theme's CSS. Nobody found it odd, because it looked like it was supposed to work that way.
  Now the font defaults to an **empty string = follow the theme** (when it's empty the inline style
  **isn't written** — leaving an empty declaration in place is the same as explicitly telling the browser
  "this value is mine"), and only a filled value overrides;
  the old default font stack in existing configs migrates as "never set",
  and the Tauri store path (`hydrateSettings`) runs the same migration —
  otherwise it works during development and breaks once packaged, reproducing only after a release.
  The guard `tests/theme-font-runtime.test.tsx` checks **runtime facts**
  (jsdom's computed style supports custom properties, and its cascade behavior matches the browser's)
- **A failed pandoc export leaves half a file at the target path**: pandoc writes directly to the target
  path the user picked, so a failure midway leaves a broken file behind (possibly overwriting the last good
  one), and all the user sees is "export failed".
  Now it's: **convert to a temp file in the same directory → read it back to verify → land it atomically
  on the target path**.
  The self-check uses `pandoc -f <format> -t markdown` to **read the artifact back** —
  if it can't be read (the container is broken) or comes back empty (the content is entirely lost),
  nothing is written to the target path.
  All seven formats (docx / odt / epub / rtf / latex / mediawiki / rst)
  were verified to be readable on pandoc 3.8
- **The PDF export guesses "the content has settled" with `sleep(300ms)`**: whether the sleep was long
  enough depends on how fast the machine is, how big the remote images are, and whether the fonts hit —
  it differs every time.
  Now a readiness script is attached to the page: it waits for the fonts to load and for every image to be
  **decoded** (the `load` event only guarantees the image **downloaded**), then writes a marker on
  `<html>`; the Rust side only prints once it reads that marker.
  Two fallbacks: 15 seconds in the page, 20 seconds on the Rust side (after the timeout it prints anyway —
  missing images are better than no file).
  There's also a `data-print-gate` marker to tell "still waiting" apart from "the script never ran at all" —
  the latter isn't waited on, otherwise every export would waste 20 seconds

### Internal

- **"Real PDF page numbers" are impossible — the reason is now known, it wasn't skipped**
  (re-checked on 2026-10-29):
  - The current path (`Webview::print()` → the macOS `WKWebView` system print panel)
    **can't get the PDF file at all**: the user picks "Save as PDF" in the panel themselves,
    the file lands wherever the user chose, and the process has no handle to it →
    without the file there's no "real page count" to read
  - Tauri 2.12's `Webview` only has `pub fn print(&self)`,
    with **no** `printToPDF` / `createPDF`; wry 0.57's `print_with_options` internally does
    `NSPrintInfo::sharedPrintInfo()` → `printOperationWithPrintInfo:` → `runOperation()`,
    with **no opening for injecting a save path**
  - wry declares `InnerWebView` as `pub(crate)`, so the native handle is out of reach
  - Bypassing Tauri and printing yourself doesn't work either: the Swift prototype (a standalone
    `WKWebView` + `NSPrintOperation`, with `NSSavePath` + `NSJobDisposition = NSPrintSaveJob`)
    — a **3-page document turned into 960,000–1,750,000 pages**, a 200–455 MB file;
    and both `MediaBox` and the layout width were correct, which shows the explosion happens inside
    the print operation.
    Along the way it turned out that the keys actually needed to write the file directly are
    `NSSavePath` and `NSJobDisposition`, **not** `NSPrintSaveJob`
  - Conclusion: real page numbers require "owning the PDF file", which means switching to a
    rendering path that can write the file directly (bundling Chromium, or implementing pagination
    yourself) — that's an **architecture change** in scale.
    So **we don't fake page numbers**, and the reason is written into `AGENTS.md`
- **Theme tokens are now generated from CSS**: `scripts/gen-theme-tokens.ts` →
  `src/export/theme-tokens.generated.ts`,
  with a `pnpm gen:theme-tokens -- --check` step added to CI.
  The generator reproduces CSS's cascade (base tokens → theme overrides → theme font overrides the base font).
  The generated file went into `.prettierignore` — letting prettier manage it too would create a
  "generate, then format, then check" loop
- **The format gate's coverage is now complete**: `format:check` used to scan only `src/**` —
  `tests/` (46 of 72 files non-compliant), `scripts/` (7), and the root config files were all outside
  the gate. A gate that scans only half the files gives you **false security**:
  test files drift just the same, and drifting test files are harder to review.
  Now `format` / `format:check` cover `src` / `tests` / `scripts` / the root config,
  `lint` includes `scripts` too, and all the non-compliant files were put through the formatter in one
  pass (55 files, +692 / −298, purely mechanical changes)
- **"Partial decorator rebuild" is deferred, but its trigger conditions are written down**:
  after measuring, a single keystroke within 4000 lines uses only 1/5 of the 16ms budget,
  and it only reaches half at 8000 lines; and the idealized benefit of "partial rebuild" is an
  **upper bound** — object construction dominates the decorator cost, and ranges carry absolute
  positions, so they must be rebuilt after any change.
  The benchmark script now prints a table of the benefit ceiling, and the trigger conditions plus four
  hard constraints are recorded in AGENTS.md
- The benchmark script `bench-decorations.ts` gains an 8000-line tier and a "partial rebuild benefit
  ceiling" table
- The paste tests add three fixtures from a **real Word 15**:
  `word-clipboard.html` (the whole document, structure preserved as-is,
  visible text replaced with neutral placeholders and local paths with generic ones),
  `word-table.html` (tables), and `word-superscript.html` (subscript and superscript).
  16 new tests were added, 13 of which go red before the fixes
- **A correction to something we had recorded wrong**: "Word may write `mso-vert-align: super`" was a
  **guess** — real Word 15 writes the semantic tags `<sup>` / `<sub>` (which we could already convert).
  Following the discipline of "don't write rules you haven't verified", that rule is **not** added;
  only the record is corrected
- **Custom CSS doesn't reach the export** (the fifth break in architectural constraint C):
  the "Additional styles" setting does **take effect** in the editor — it's the last stylesheet
  injected and can override anything — but the export path doesn't carry it at all
  (the field isn't in `HtmlExportOptions`, and `exportDocument` doesn't pass it).
  So one document ends up with **two sets of styles**: one on screen, another in the export.
  Now both the HTML and the PDF paths carry it, injected at the end of `<head>` (same as in the editor).
  Why did the unit tests stay green: `exportToHtml`'s options simply don't have that field —
  **this kind of break is only visible by running the whole path**,
  so the new `tests/export-custom-css.test.ts` guards the "settings → export → artifact" segment
- **The `=WxH` size of an image doesn't reach the export** (the sixth break in architectural constraint C):
  `![图](a.png=200x100)` exports as `<img src="a.png=200x100">` —
  **the image URL is broken**; `![图](a.png =200x100)` is worse,
  exporting as a run of literal text with **the image entirely gone**.
  Meanwhile the editor renders both as images.
  The fix: move the `=WxH` rule from `src/editor/render/` to `src/parser/`
  (it's a **syntax rule**, there can only be one implementation; and the export path shouldn't depend
  back on `src/editor/`),
  and add an mdast transform: for the no-space form it strips the URL tail,
  for the spaced form it cuts that **plain text** into an image node.
  The size lands on `<img>` through `data.hProperties`
  (mdast's official extension point, no new dependency needed);
  the transform only happens on the "mdast → HTML" path and is **lossless round-trip**
  (red line 1, guarded by tests)
- **The export takes the raw value from the settings for light/dark mode** (the seventh break in
  architectural constraint C):
  the default config is `colorMode: "auto"` plus "follow the system", and the export takes that
  `"auto"` and treats it as **light** in `buildStyles` —
  so **when the system is dark the editor is dark and the export is light**: one document, two looks.
  Now the export reads the `data-mode` on `<html>` instead (written by `useThemeRuntime` —
  literally **the mode on screen**); this read is lifted into the theme layer,
  because the theme runtime, the mermaid renderer, and the export path all need the same one
- **A coverage guard for menu actions** (`tests/menu-coverage.test.tsx`): the edge
  "action on the list ↔ someone in the front end really handles it" wasn't guarded before, and now it is.
  It queries the **runtime registry** instead of scanning the source —
  scanning the source can be fooled by comments (a commented-out handler still greps, the guard stays
  green, and the menu item is still dead at runtime); the guard also carries a self-check against
  false green

## [Unreleased]: https://github.com/erongcao/inkstone/compare/v0.2.0...HEAD
## [0.2.0]: https://github.com/erongcao/inkstone/releases/tag/v0.2.0

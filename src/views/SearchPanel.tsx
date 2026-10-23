/**
 * 侧边栏「搜索」面板：跨文件查找（普通文本 / 正则）。
 *
 * 搜索在 Rust 侧跑（见 `ipc/search.ts`），面板只负责收集输入、发请求、列结果。
 *
 * 两个刻意的取舍：
 *   - **防抖 180ms**：每敲一个字就搜一次，在 1000 个文件的库上是浪费
 *   - **搜索根跟着树根**：搜索的是「当前笔记库」，
 *     跟文件树不一致的话，用户会搜到树里看不到的文件
 *
 * 「搜索中」是**派生**出来的（结果对不上当前输入就算过期），
 * 不是在 effect 里手动置位的——那样每次改选项都会多一次重渲染。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { searchFiles, type SearchHit, type SearchResult } from "@/ipc/search";
import { useTreeRoot } from "@/file-tree/store";
import { openDocumentAtLine, useDocument } from "@/ipc/document";

/** 防抖间隔（毫秒） */
const DEBOUNCE_MS = 180;

/** 取一个文件所在的目录；取不到返回 null */
function parentDir(path: string | null): string | null {
  if (!path) return null;
  const index = path.lastIndexOf("/");
  return index > 0 ? path.slice(0, index) : null;
}

interface Outcome {
  /** 这次结果对应的输入（用来判断结果是否已过期） */
  key: string;
  result: SearchResult | null;
  error: string | null;
}

export function SearchPanel() {
  const { doc } = useDocument();
  const treeRoot = useTreeRoot();
  const [query, setQuery] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  // 序号：用来丢弃过期的响应。
  // 用户连打「abcd」会发出 4 个请求，第 1 个可能最后才回来——
  // 不做这个标记，结果就会闪回旧内容。
  const requestId = useRef(0);

  const root = useMemo(() => treeRoot ?? parentDir(doc.path), [treeRoot, doc.path]);

  // 输入的「身份」：查询词 + 两个选项。
  // 结果是按这个 key 存的，key 对不上就说明结果是旧的。
  const key = `${root ?? ""}\u0000${query}\u0000${useRegex}\u0000${caseSensitive}`;

  useEffect(() => {
    if (!root || !query.trim()) return;
    const id = ++requestId.current;
    const timer = setTimeout(() => {
      searchFiles(root, query, { regex: useRegex, caseSensitive })
        .then((result) => {
          if (id !== requestId.current) return; // 过期响应，丢弃
          setOutcome({ key, result, error: null });
        })
        .catch((err: unknown) => {
          if (id !== requestId.current) return;
          setOutcome({
            key,
            result: null,
            error: err instanceof Error ? err.message : String(err),
          });
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [root, query, useRegex, caseSensitive, key]);

  // 结果过期 = 正在搜（或者刚改了输入还没搜完）
  const stale = outcome === null || outcome.key !== key;
  const hasQuery = query.trim().length > 0;

  return (
    <div className="search-panel">
      <div className="search-panel__input-row">
        <input
          className="search-panel__input"
          type="text"
          placeholder="搜索整个笔记库"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="搜索"
        />
        <label className="search-panel__toggle" title="按正则表达式解释">
          <input
            type="checkbox"
            checked={useRegex}
            onChange={(e) => setUseRegex(e.target.checked)}
          />
          <span>.*</span>
        </label>
        <label className="search-panel__toggle" title="区分大小写">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(e) => setCaseSensitive(e.target.checked)}
          />
          <span>Aa</span>
        </label>
      </div>

      {!hasQuery ? (
        <p className="panel-placeholder">输入关键词开始搜索。</p>
      ) : !root ? (
        <p className="panel-placeholder">先打开一个文件，或在「文件」页选一个笔记库。</p>
      ) : stale ? (
        <p className="panel-placeholder">搜索中…</p>
      ) : outcome?.error ? (
        <p className="panel-placeholder panel-placeholder--error">{outcome.error}</p>
      ) : outcome?.result?.hits.length === 0 ? (
        <p className="panel-placeholder">没有匹配项。</p>
      ) : outcome?.result ? (
        <>
          <p className="search-panel__summary">
            {outcome.result.hits.length} 处匹配 · 扫了 {outcome.result.scannedFiles}{" "}
            个文件 · {outcome.result.elapsedMs} ms
            {outcome.result.truncated && " · 结果过多已截断"}
          </p>
          <ul className="search-panel__results">
            {outcome.result.hits.map((hit, index) => (
              <SearchResultRow
                key={`${hit.path}:${hit.line}:${hit.column}:${index}`}
                hit={hit}
              />
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function SearchResultRow({ hit }: { hit: SearchHit }) {
  const name = hit.path.slice(hit.path.lastIndexOf("/") + 1);
  return (
    <li>
      <button
        type="button"
        className="search-panel__hit"
        title={hit.path}
        onClick={() => void openDocumentAtLine(hit.path, hit.line)}
      >
        <span className="search-panel__hit-head">
          <span className="search-panel__hit-name">{name}</span>
          <span className="search-panel__hit-line">:{hit.line}</span>
        </span>
        <span className="search-panel__hit-text">{highlight(hit)}</span>
      </button>
    </li>
  );
}

/**
 * 把命中片段标出来。
 *
 * 按**字符**切，不能按 `String.slice` 的 UTF-16 下标切——
 * 中文在 JS 里是 2 个 UTF-16 单元，按下标切会把一个字劈成两半。
 */
function highlight(hit: SearchHit) {
  const chars = Array.from(hit.text);
  const start = hit.column - 1;
  const matchedLength = Array.from(hit.matchText).length;
  const before = chars.slice(0, start).join("");
  const matched = chars.slice(start, start + matchedLength).join("");
  const after = chars.slice(start + matchedLength).join("");
  return (
    <>
      {before}
      <mark className="search-panel__mark">{matched}</mark>
      {after}
    </>
  );
}

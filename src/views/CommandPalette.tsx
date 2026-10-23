/**
 * 命令面板（⌘K）。
 *
 * ## 为什么要自己写，不复用 CM6 的补全弹层
 *
 * 斜杠菜单用的是补全源，这里没有——两者需求根本不同：
 *
 * | | 斜杠菜单 | 命令面板 |
 * |---|---|---|
 * | 查询文本 | 就在文档里（`/tab`） | 在**面板的输入框**里 |
 * | 接受时 | 替换掉文档里那段文本 | **不动文档** |
 * | 允许空格 | 否（空格就该结束匹配） | 是（「插入 表格」） |
 * | 焦点 | 全程在编辑器 | 全程在 `<input>` |
 *
 * CM6 的补全强绑在「文档区间 ↔ 候选」上：查询词必须存在于文档中，
 * 接受时替换那个区间。命令面板一条都不满足——硬套的结果是
 * 查询词被写进文档、接受后被替换掉、Esc 之后文档里留下一截垃圾。
 * 所以这里用普通的模态覆盖层：输入框、焦点陷阱、Esc/点击外部关闭，
 * 全部是原生 `<input>` + `<dialog>` 语义能覆盖的，没有理由绕远路。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  commandsFor,
  matchCommands,
  runCommand,
  type InkstoneCommand,
} from "@/editor/commands";
import { closePalette, setPaletteQuery, usePalette } from "@/editor/palette";
import { getActiveEditorView } from "@/editor/active-view";
import { loadVaultFiles, matchVaultFiles, type VaultFile } from "@/file-tree/quick-open";
import { useTreeRoot } from "@/file-tree/store";
import { listRecentFiles } from "@/ipc/recent";
import { openDocumentAt } from "@/ipc/document";

/** 一行命令（含它的高亮位置与分类） */
interface Row {
  command: InkstoneCommand;
  matched: number[];
}

/** 把扁平的匹配结果按分类分组，保持分类与行内的既有顺序 */
function groupByCategory(rows: Row[]): { category: string; rows: Row[] }[] {
  const groups: { category: string; rows: Row[] }[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.category === row.command.category) last.rows.push(row);
    else groups.push({ category: row.command.category, rows: [row] });
  }
  return groups;
}

/** 把命中字符包成 <mark>，其余原样 */
function Highlighted({ text, matched }: { text: string; matched: number[] }) {
  if (matched.length === 0) return <>{text}</>;
  const hit = new Set(matched);
  const parts: React.ReactNode[] = [];
  let buffer = "";
  let bufferHit = hit.has(0);
  const flush = (key: string) => {
    if (!buffer) return;
    parts.push(bufferHit ? <mark key={key}>{buffer}</mark> : buffer);
    buffer = "";
  };
  for (let i = 0; i < text.length; i++) {
    const isHit = hit.has(i);
    if (isHit !== bufferHit) {
      flush(`t${i}`);
      bufferHit = isHit;
    }
    buffer += text[i];
  }
  flush("t-end");
  return <>{parts}</>;
}

export function CommandPalette() {
  const { open, query, mode } = usePalette();
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const treeRoot = useTreeRoot();

  const commandGroups = useMemo<{ category: string; rows: Row[] }[]>(() => {
    if (!open || mode !== "command") return [];
    const rows = matchCommands(commandsFor("palette", getActiveEditorView()), query).map(
      (hit) => ({ command: hit.command, matched: hit.matched }),
    );
    return groupByCategory(rows);
  }, [open, query, mode]);

  /** 文件模式的候选：查询为空时给最近文件，否则给模糊匹配的文件 */
  const [vaultFiles, setVaultFiles] = useState<VaultFile[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => {
    if (!open || mode !== "file") return;
    let cancelled = false;
    void (async () => {
      const [files, recents] = await Promise.all([
        treeRoot
          ? loadVaultFiles(treeRoot).catch(() => [] as VaultFile[])
          : Promise.resolve([]),
        listRecentFiles().catch(() => [] as string[]),
      ]);
      if (cancelled) return;
      setVaultFiles(files);
      setRecent(recents);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, mode, treeRoot]);

  const fileMatches = useMemo(() => {
    if (!open || mode !== "file") return [];
    if (!query.trim()) {
      // 没有查询词：先给最近文件，重复的（也在文件列表里）去重
      const seen = new Set<string>();
      const rows: { file: VaultFile; matched: number[] }[] = [];
      for (const path of recent) {
        if (seen.has(path)) continue;
        seen.add(path);
        const slash = path.lastIndexOf("/");
        rows.push({
          file: {
            path,
            name: slash >= 0 ? path.slice(slash + 1) : path,
            dir: slash >= 0 ? path.slice(0, slash) : "",
          },
          matched: [],
        });
      }
      for (const file of vaultFiles) {
        if (seen.has(file.path)) continue;
        seen.add(file.path);
        rows.push({ file, matched: [] });
        if (rows.length >= 50) break;
      }
      return rows;
    }
    return matchVaultFiles(vaultFiles, query);
  }, [open, mode, query, vaultFiles, recent]);

  /** 扁平顺序，↑↓ 与 Enter 都按这个顺序走 */
  const flat = useMemo(
    () => commandGroups.flatMap((group) => group.rows),
    [commandGroups],
  );

  /**
   * 打开或查询变化时把选中项拉回第一条。
   *
   * 用 React 官方的「渲染期校正状态」而不是 `useEffect(() => setSelected(0), [...])`：
   * effect 里改 state 会多跑一轮渲染，而这里每次都要重算整个列表——多一轮就是白算。
   * 渲染期改 state 是 React 明确支持的（渲染到一半再改，React 会立刻重跑，
   * 且不会把中间状态提交出去）。
   */
  const key = `${open}:${mode}:${query}`;
  const [lastKey, setLastKey] = useState(key);
  if (lastKey !== key) {
    setLastKey(key);
    setSelected(0);
  }

  // 打开时聚焦输入框；下一帧才 focus，因为这一帧 React 还没把 input 挂上
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  /**
   * 关闭时把焦点还给编辑器。
   *
   * ⚠️ 判据是 `!open` 而不是 `open`：写成 `open` 的话，**打开时**也会跑一遍，
   * 于是编辑器在面板输入框 focus 之后又把焦点抢回去，用户接着打字就打在编辑器里，
   * 面板看着还开着、却什么都输不进去。
   */
  useEffect(() => {
    if (open) return;
    const timer = window.setTimeout(() => getActiveEditorView()?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  // 选中项滚动进视野
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (!open) return null;

  const activate = (index: number) => {
    if (mode === "file") {
      const hit = fileMatches[index];
      if (!hit) return;
      // 先关面板再打开文件：面板的 <input> 抢着焦点时打开文档，
      // 光标会落在面板上而不是文档里
      closePalette();
      void openDocumentAt(hit.file.path);
      return;
    }
    const row = flat[index];
    if (!row) return;
    const command = row.command;
    // 先关面板再执行：面板的 <input> 抢着焦点时执行命令，
    // 像「切到源码模式」这种要靠 view.focus() 的会表现得很怪。
    closePalette();
    runCommand(command.id, getActiveEditorView());
  };

  /** 当前模式下可选条目总数 */
  const itemCount = mode === "file" ? fileMatches.length : flat.length;

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closePalette();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((index) => (itemCount ? (index + 1) % itemCount : 0));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((index) => (itemCount ? (index - 1 + itemCount) % itemCount : 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      activate(selected);
    }
  };

  let cursor = -1;

  return (
    // 背景遮罩：点外面关闭。键盘用户走 Esc（面板里已处理），
    // 所以这里不需要额外的无障碍语义。
    <div className="palette-backdrop" onMouseDown={closePalette}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label={mode === "file" ? "快速打开" : "命令面板"}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="palette__input"
          value={query}
          placeholder={mode === "file" ? "按文件名快速打开…" : "搜索命令…"}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setPaletteQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="palette__list" ref={listRef}>
          {mode === "file" ? (
            <>
              {fileMatches.length === 0 && (
                <div className="palette__empty">
                  {treeRoot ? "没有匹配的文件" : "先选一个笔记库（或打开一个文件）"}
                </div>
              )}
              {fileMatches.map((hit, index) => (
                <button
                  key={hit.file.path}
                  type="button"
                  data-index={index}
                  className="palette__item"
                  aria-selected={index === selected}
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => activate(index)}
                >
                  <span className="palette__label">
                    <Highlighted text={hit.file.name} matched={hit.matched} />
                  </span>
                  <span className="palette__hint">{hit.file.dir}</span>
                </button>
              ))}
            </>
          ) : (
            <>
              {flat.length === 0 && <div className="palette__empty">没有匹配的命令</div>}
              {commandGroups.map((group) => (
                <div key={group.category} className="palette__group">
                  <div className="palette__group-title">{group.category}</div>
                  {group.rows.map((row) => {
                    cursor++;
                    const index = cursor;
                    return (
                      <button
                        key={row.command.id}
                        type="button"
                        data-index={index}
                        className="palette__item"
                        aria-selected={index === selected}
                        onMouseEnter={() => setSelected(index)}
                        onClick={() => activate(index)}
                      >
                        <span className="palette__label">
                          <Highlighted text={row.command.label} matched={row.matched} />
                        </span>
                        {row.command.keywords && (
                          <span className="palette__hint">
                            {row.command.keywords.split(/\s+/)[0]}
                          </span>
                        )}
                        {row.command.shortcut && (
                          <span className="palette__shortcut">
                            {row.command.shortcut}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

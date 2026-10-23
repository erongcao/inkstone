/**
 * 侧边栏「文件」面板：按需展开的目录树。
 *
 * 三层分工和表格编辑一样——
 * 状态在 `@/file-tree/store`（模块级 store），
 * 路径与排序规则在 Rust 侧，这里**只负责把状态画出来**，
 * 不在前端另写一套过滤 / 排序。
 */

import { useEffect, useRef } from "react";
import type { DirEntry } from "@/ipc/fs";
import {
  isExpanded,
  refreshTree,
  revealDocument,
  toggleNode,
  useFileTree,
  type FileTreeState,
} from "@/file-tree/store";
import { openDocumentAt, useDocument } from "@/ipc/document";

/**
 * 路径太长时从**前面**截断，保留尾部。
 *
 * 不用 CSS `direction: rtl` 做这件事：那样虽然能保住尾巴，
 * 但路径开头的 `/` 会被 bidi 算法挪到末尾，
 * 「/Users/me/notes」会显示成「Users/me/notes/」。
 * 在这里切字符串没有歧义，代价只是要自己数长度。
 */
export function shortenPath(path: string, max = 36): string {
  if (path.length <= max) return path;
  return `…${path.slice(path.length - (max - 1))}`;
}

export function FileTreePanel() {
  const { tree, choose } = useFileTree();
  const { doc } = useDocument();

  // 当前文档换了就跟着走：树根不对就换根，在根里面就展开到它
  useEffect(() => {
    if (doc.path) void revealDocument(doc.path);
  }, [doc.path]);

  // 刚保存完：文件可能被改名、移动，或者旁边新建了文件，
  // 所以把**已展开**的那几层重读一遍（没展开的不读，保持懒加载）
  const wasDirty = useRef(doc.dirty);
  useEffect(() => {
    if (wasDirty.current && !doc.dirty) void refreshTree();
    wasDirty.current = doc.dirty;
  }, [doc.dirty]);

  const root = tree.root;
  const rootNode = root ? tree.nodes[root] : undefined;

  return (
    <div className="file-tree">
      <div className="file-tree__bar">
        <span className="file-tree__root" title={root ?? undefined}>
          {root === null ? "未选择文件夹" : shortenPath(root)}
        </span>
        <div className="file-tree__actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => void refreshTree()}
          >
            刷新
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => void choose()}>
            打开
          </button>
        </div>
      </div>

      {root === null ? (
        <p className="panel-placeholder">
          还没有选择文件夹。
          <br />
          打开一个文件夹，或直接打开一个 .md 文件。
        </p>
      ) : rootNode?.error ? (
        <p className="panel-placeholder panel-placeholder--error">
          打不开这个文件夹
          <br />
          <span className="file-tree__error">{rootNode.error}</span>
        </p>
      ) : (
        <TreeLevel tree={tree} dirPath={root} depth={0} activePath={doc.path} />
      )}
    </div>
  );
}

/** 一层目录。子目录靠递归自己画自己。 */
function TreeLevel({
  tree,
  dirPath,
  depth,
  activePath,
}: {
  tree: FileTreeState;
  dirPath: string;
  depth: number;
  activePath: string | null;
}) {
  const node = tree.nodes[dirPath];
  const children = node?.children;
  if (!node || children === null) {
    // 没加载过：这一层不该出现（能走到这里说明正在读）
    if (node?.loading) return <p className="panel-placeholder">正在读取…</p>;
    return null;
  }
  if (children.length === 0) return null;

  return (
    <ul className="file-tree__list" role={depth === 0 ? "tree" : "group"}>
      {children.map((entry) => (
        <TreeRow
          key={entry.path}
          tree={tree}
          entry={entry}
          depth={depth}
          activePath={activePath}
        />
      ))}
    </ul>
  );
}

function TreeRow({
  tree,
  entry,
  depth,
  activePath,
}: {
  tree: FileTreeState;
  entry: DirEntry;
  depth: number;
  activePath: string | null;
}) {
  const node = entry.isDir ? tree.nodes[entry.path] : undefined;
  const expanded = entry.isDir && isExpanded(node, tree.root);
  const isActive = entry.path === activePath;

  return (
    <li role="treeitem" aria-expanded={entry.isDir ? expanded : undefined}>
      <button
        type="button"
        className={`file-tree__row${isActive ? " is-active" : ""}`}
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
        title={entry.path}
        // 目录和文件用同一个按钮，靠 `entry.isDir` 分流：
        // 两者的点击语义差别只有一个「要不要读子项」，不值得拆两个组件
        onClick={() => {
          if (entry.isDir) {
            toggleNode(entry.path);
          } else {
            void openDocumentAt(entry.path);
          }
        }}
      >
        {entry.isDir ? (
          <span className="file-tree__caret" aria-hidden="true" data-open={expanded} />
        ) : (
          <span className="file-tree__caret file-tree__caret--leaf" aria-hidden="true" />
        )}
        <span className="file-tree__name">{entry.name}</span>
      </button>

      {entry.isDir && node?.error && (
        <div
          className="file-tree__sub-error"
          style={{ paddingLeft: `${(depth + 1) * 12 + 6}px` }}
        >
          {node.error}
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => toggleNode(entry.path)}
          >
            重试
          </button>
        </div>
      )}

      {expanded && !node?.error && (
        <TreeLevel
          tree={tree}
          dirPath={entry.path}
          depth={depth + 1}
          activePath={activePath}
        />
      )}
    </li>
  );
}

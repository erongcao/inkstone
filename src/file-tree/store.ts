/**
 * 文件树状态。
 *
 * 放在模块级 store 而不是组件里：树的根要跟着**当前文档**走，
 * 而打开文档的入口有好几个（菜单、Finder 双击、树里点一下），
 * 状态留在组件内部的话，侧边栏没打开时收到的新路径就丢了。
 *
 * ## 形状：按路径摊平，不建嵌套树
 *
 * `nodes` 是一张 `路径 → 节点` 的表，父子关系靠路径前缀还原。
 * 之所以不直接用嵌套对象：
 * 展开一个目录只需要改**一个**节点的 children，
 * 嵌套写法要把整条祖先链 clone 一遍，
 * 而这棵树在一次会话里可能有几百个节点。
 */

import { useCallback, useSyncExternalStore } from "react";
import { isUnder, listDirectory, parentOf, pickFolder, type DirEntry } from "@/ipc/fs";

export interface TreeNode {
  path: string;
  name: string;
  isDir: boolean;
  /**
   * 已加载的直接子项。
   *
   * `null` = **还没展开过**，也就是「懒加载的未加载态」。
   * 用 `[]` 表示「加载了，确实是空的」——
   * 这两者对用户的含义完全不同（见 Rust 侧 `空目录返回空列表而不是错误`）。
   */
  children: DirEntry[] | null;
  loading: boolean;
  /** 这一层读不出来时的原因；null = 没出错 */
  error: string | null;
  /**
   * 本节点已发起过的加载次数。
   *
   * 存在的理由是一个具体的竞态：目录正在读的时候用户点了折叠，
   * 折叠把 children 清成 null，随后 in-flight 的结果回来了把它又填上——
   * 用户点的是「收起」，看到的是「展开」。
   * 提交结果前比一下 token，对不上就丢弃这次结果。
   */
  loadToken: number;
}

export interface FileTreeState {
  /** 树根；null = 还没选过目录 */
  root: string | null;
  nodes: Record<string, TreeNode>;
}

let state: FileTreeState = { root: null, nodes: {} };

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): FileTreeState {
  return state;
}

function setState(patch: Partial<FileTreeState>) {
  state = { ...state, ...patch };
  emit();
}

/** 覆盖式写入单个节点 */
function putNode(node: TreeNode) {
  setState({ nodes: { ...state.nodes, [node.path]: node } });
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1) || path;
}

function blank(path: string, isDir: boolean): TreeNode {
  return {
    path,
    name: nameOf(path),
    isDir,
    children: null,
    loading: false,
    error: null,
    loadToken: 0,
  };
}

/** 这个节点当前是否处于展开态：根恒展开；其余看 children 有没有加载过 */
export function isExpanded(node: TreeNode | undefined, root: string | null): boolean {
  if (!node) return false;
  if (root !== null && node.path === root) return true;
  return node.children !== null || node.loading;
}

/** 读一层子项；没加载过返回 null（调用方据此显示「点开才读」） */
export function childrenOf(tree: FileTreeState, path: string): DirEntry[] | null {
  return tree.nodes[path]?.children ?? null;
}

/* ── 异步动作 ── */

/** 读一个目录并写入节点。返回是否成功。 */
async function loadDirectory(path: string, isDir = true): Promise<boolean> {
  const base = state.nodes[path] ?? blank(path, isDir);
  // 每次发起加载都换一个 token；下面的提交都要拿它对账
  const token = base.loadToken + 1;
  putNode({ ...base, loading: true, error: null, loadToken: token });
  try {
    const entries = await listDirectory(path);
    const current = state.nodes[path];
    if (!current || current.loadToken !== token) {
      // 这次结果已经过期（比如用户中途折叠了），丢弃
      return false;
    }
    putNode({ ...current, loading: false, error: null, children: entries });
    return true;
  } catch (error) {
    const current = state.nodes[path];
    if (!current || current.loadToken !== token) return false;
    // children 保持 null：这一层仍然算「没展开」，
    // 用户再点一次就是重试，而不是停在一个读不出来的展开态里。
    putNode({
      ...current,
      loading: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/** 换一个树根：丢掉全部旧节点，展开新根 */
export async function setTreeRoot(path: string): Promise<void> {
  setState({ root: path, nodes: {} });
  await loadDirectory(path);
}

/** 弹目录选择框；用户取消或出错时保持原样 */
export async function chooseRoot(): Promise<void> {
  const picked = await pickFolder();
  if (!picked) return;
  await setTreeRoot(picked);
}

/** 展开 / 折叠一个目录。展开时若还没读过则去读。 */
export function toggleNode(path: string): void {
  // `nodes` 里只有**读过**的目录，而用户点的是父目录列表里任意一行——
  // 那些目录多半还没被读过。所以这里要能在节点缺席时就地建一个空壳，
  // 早期版本直接 `if (!node) return`，导致「点没展开过的目录毫无反应」。
  const node = state.nodes[path] ?? blank(path, true);
  const wasExpanded = isExpanded(node, state.root);
  // 折叠：清掉 children 并作废在途的加载。
  // token +1 让已经发出去的那次结果回来时对不上账，直接丢弃。
  putNode({
    ...node,
    children: null,
    loading: false,
    error: null,
    loadToken: node.loadToken + 1,
  });
  if (!wasExpanded) {
    void loadDirectory(path);
  }
}

/** 把所有**已展开**的目录重读一遍 */
export async function refreshTree(): Promise<void> {
  const root = state.root;
  if (!root) return;
  const targets = Object.values(state.nodes)
    .filter((node) => node.isDir && isExpanded(node, root))
    .map((node) => node.path);
  await Promise.all(targets.map((path) => loadDirectory(path)));
}

/**
 * 让当前文档在树里露出来。
 *
 * 规则：
 * 1. 还没选过根 → 用文档所在目录当根
 * 2. 根选过，但文档不在根里面 → **跟着文档走**，把根改成文档所在目录。
 *    不这么做的话，用户从 Finder 打开一个别处的文件后，
 *    树里高亮不到它，会以为「这个文件不在我的笔记库里」
 * 3. 文档在根里面 → 沿路径逐层展开
 *
 * 用**逐层读**而不是让后端一次性返回祖先链：
 * 每层都走同一个 `list_directory`，复用同一套过滤排序，
 * 也不必在后端再写一份「找祖先」的逻辑。
 */
export async function revealDocument(filePath: string): Promise<void> {
  if (!filePath) return;

  if (state.root === null || !isUnder(state.root, filePath)) {
    const parent = await parentOf(filePath);
    if (!parent) return;
    await setTreeRoot(parent);
    return;
  }

  const root = state.root;
  const relative = filePath.slice(root.length);
  const segments = relative.split("/").filter(Boolean);
  let current = root;
  // 最后一段是文件本身，只需要展开到它的父目录
  const directories = segments.slice(0, -1);
  if (!(await loadDirectory(root))) return;
  for (const segment of directories) {
    current = `${current}/${segment}`;
    if (!(await loadDirectory(current))) return;
  }
}

/** 测试用：清空整棵树 */
export function resetFileTree(): void {
  state = { root: null, nodes: {} };
}

/**
 * 同步读一份当前快照（非 hook 版本）。
 *
 * 和 `currentDocumentPath()` 同一个理由：不少判断要在组件外做
 * （保存完要不要刷新、切换面板前要不要收树），
 * 那时没有 hook 可用，而订阅一份永远不变的状态反而是多余的。
 */
export function getTree(): FileTreeState {
  return state;
}

export function useFileTree() {
  const tree = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const choose = useCallback(() => void chooseRoot(), []);
  const refresh = useCallback(() => void refreshTree(), []);
  return { tree, choose, refresh };
}

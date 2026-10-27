/**
 * 文件树（M3）：store 行为 + 面板渲染。
 *
 * 这里跑在**浏览器降级后端**上（`__TAURI_INTERNALS__` 不存在），
 * 走 `src/ipc/fs.ts` 里那份内存样例库。
 * 这样测的是前端自己的逻辑——展开/折叠、竞态、错误态、当前文件高亮——
 * 而路径过滤和排序由 `src-tauri/src/fs.rs` 的 15 个 Rust 测试负责，两边不重叠。
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import type * as FsModule from "../src/ipc/fs";
import { SAMPLE_ROOT, isUnder } from "../src/ipc/fs";
import {
  childrenOf,
  getTree,
  isExpanded,
  refreshTree,
  resetFileTree,
  revealDocument,
  setTreeRoot,
  toggleNode,
} from "../src/file-tree/store";
import { FileTreePanel, shortenPath } from "../src/views/FileTreePanel";
import {
  newDocument,
  getDocumentContent,
  openDocumentAt,
  setDocumentContent,
} from "../src/ipc/document";

/**
 * 让 `listDirectory` 能被测试**卡住**，用来复现「加载途中用户点了折叠」这个时序。
 *
 * 必须用 `vi.mock` 而不是 `vi.doMock`：本文件已经静态导入了 store，
 * 模块图在导入阶段就固化了，`doMock` 只影响之后的动态导入。
 * 控制对象用 `vi.hoisted` 提到 mock 工厂之前，否则工厂里的引用会撞上 TDZ。
 */
const held = vi.hoisted(() => ({ paths: new Set<string>() }));
const release = vi.hoisted(() => ({ paths: new Map<string, () => void>() }));

vi.mock("../src/ipc/fs", async (importOriginal) => {
  const actual = await importOriginal<typeof FsModule>();
  return {
    ...actual,
    async listDirectory(path: string) {
      if (held.paths.has(path)) {
        held.paths.delete(path);
        await new Promise<void>((resolve) => {
          release.paths.set(path, resolve);
        });
      }
      return actual.listDirectory(path);
    },
  };
});

/** 让所有挂起的 promise 落地 */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  cleanup();
  resetFileTree();
  newDocument();
  held.paths.clear();
  release.paths.clear();
});

describe("路径判断", () => {
  it("isUnder 认前缀但不误伤同名兄弟目录", () => {
    expect(isUnder("/a/b", "/a/b")).toBe(true);
    expect(isUnder("/a/b", "/a/b/c.md")).toBe(true);
    expect(isUnder("/a/b", "/a/bc/d.md")).toBe(false);
    expect(isUnder("/a/b", "/a")).toBe(false);
  });

  it("短路径原样显示，长路径从前面截断并保住尾部", () => {
    expect(shortenPath("/Users/me/notes")).toBe("/Users/me/notes");
    const long = "/Users/someone/Documents/个人文档/我的笔记库/2026 归档";
    const short = shortenPath(long);
    expect(short.startsWith("…")).toBe(true);
    // 尾部（也就是最有信息量的目录名）必须留住
    expect(short.endsWith("2026 归档")).toBe(true);
    // 开头的斜杠不能跑到末尾——那是 CSS direction: rtl 才会犯的错
    expect(short.endsWith("/")).toBe(false);
  });
});

describe("文件树 store", () => {
  it("设置根之后自动展开根一层", async () => {
    await act(() => setTreeRoot(SAMPLE_ROOT));
    await settle();

    const tree = getTree();
    expect(tree.root).toBe(SAMPLE_ROOT);
    // 顺序与 Rust 侧 `sort_entries` 一致（目录在前 + 自然序）：
    // 样例库是真实后端的替身，顺序对不上会让浏览器里的验收结论失真
    expect(childrenOf(tree, SAMPLE_ROOT)?.map((e) => e.name)).toEqual([
      "01 进行中",
      "02 归档",
      "99 空目录",
      "README.md",
      "随手记.MARKDOWN",
    ]);
  });

  it("子目录默认没读过，点开才读", async () => {
    await act(() => setTreeRoot(SAMPLE_ROOT));
    await settle();

    const sub = `${SAMPLE_ROOT}/01 进行中`;
    expect(childrenOf(getTree(), sub)).toBeNull();
    expect(isExpanded(getTree().nodes[sub], SAMPLE_ROOT)).toBe(false);

    await act(async () => {
      toggleNode(sub);
      await Promise.resolve();
    });
    await settle();

    // 断言前端**原样透传**后端顺序、不在前端重排——
    // 排序规则的真相源在 Rust 侧，前端再排一次就成了第二套规则。
    expect(childrenOf(getTree(), sub)?.map((e) => e.name)).toEqual([
      "周报 2.md",
      "周报 10.md",
      "需求池.md",
      "需求.md",
    ]);
  });

  it("再点一次折叠，且清掉已读的子项", async () => {
    const sub = `${SAMPLE_ROOT}/01 进行中`;
    await act(() => setTreeRoot(SAMPLE_ROOT));
    await settle();

    await act(async () => {
      toggleNode(sub);
      await Promise.resolve();
    });
    await settle();
    expect(childrenOf(getTree(), sub)).not.toBeNull();

    await act(async () => {
      toggleNode(sub);
      await Promise.resolve();
    });
    await settle();
    expect(childrenOf(getTree(), sub)).toBeNull();
    expect(isExpanded(getTree().nodes[sub], SAMPLE_ROOT)).toBe(false);
  });

  it("读不出来的目录记下错误，且仍然算「没展开」", async () => {
    await act(() => setTreeRoot("/根本不存在"));

    const node = getTree().nodes["/根本不存在"];
    expect(node.error).toContain("样例库里没有这个目录");
    // children 必须保持 null：null = 没展开，用户再点一次就是重试，
    // 而不是停在一个「展开着但读不出来」的坏状态里
    expect(node.children).toBeNull();
    expect(node.loading).toBe(false);
  });

  it("加载途中折叠：迟到的结果被丢弃，不会把节点重新撑开", async () => {
    const sub = `${SAMPLE_ROOT}/01 进行中`;
    await act(() => setTreeRoot(SAMPLE_ROOT));
    await settle();

    held.paths.add(sub);
    // 展开：这次读会卡住不放行
    await act(async () => {
      toggleNode(sub);
      await Promise.resolve();
    });
    expect(getTree().nodes[sub].loading).toBe(true);

    // 用户在读的过程中点了折叠
    await act(async () => {
      toggleNode(sub);
      await Promise.resolve();
    });
    expect(childrenOf(getTree(), sub)).toBeNull();

    // 现在才放行那次迟到的读
    await act(async () => {
      release.paths.get(sub)?.();
      await Promise.resolve();
    });
    await settle();

    // 折叠必须赢：不然用户点「收起」看到的是「展开」
    expect(childrenOf(getTree(), sub)).toBeNull();
  });

  it("revealDocument：还没选过根时用文档所在目录当根", async () => {
    await act(() => revealDocument(`${SAMPLE_ROOT}/01 进行中/需求.md`));
    const tree = getTree();
    expect(tree.root).toBe(`${SAMPLE_ROOT}/01 进行中`);
    expect(childrenOf(tree, `${SAMPLE_ROOT}/01 进行中`)).not.toBeNull();
  });

  it("revealDocument：文档在根外面时跟着文档走", async () => {
    await act(() => setTreeRoot("/别的地方"));
    await settle();
    expect(getTree().root).toBe("/别的地方");

    await act(() => revealDocument(`${SAMPLE_ROOT}/README.md`));
    expect(getTree().root).toBe(SAMPLE_ROOT);
  });

  it("revealDocument：文档在根里面时逐层展开到它", async () => {
    await act(() => setTreeRoot(SAMPLE_ROOT));
    await settle();
    const sub = `${SAMPLE_ROOT}/02 归档`;
    expect(childrenOf(getTree(), sub)).toBeNull();

    await act(() => revealDocument(`${sub}/2026-01-05 开篇.md`));

    const tree = getTree();
    expect(tree.root).toBe(SAMPLE_ROOT);
    expect(childrenOf(tree, sub)).not.toBeNull();
    expect(isExpanded(tree.nodes[sub], tree.root)).toBe(true);
  });

  it("refreshTree 重读已展开的层，不动没展开的", async () => {
    await act(() => setTreeRoot(SAMPLE_ROOT));
    await settle();
    const opened = `${SAMPLE_ROOT}/02 归档`;
    const closed = `${SAMPLE_ROOT}/01 进行中`;
    await act(async () => {
      toggleNode(opened);
      await Promise.resolve();
    });
    await settle();

    await act(() => refreshTree());

    const tree = getTree();
    expect(childrenOf(tree, opened)).not.toBeNull();
    // 没展开过的目录不该因为「刷新」就被读进来——那会破坏懒加载
    expect(childrenOf(tree, closed)).toBeNull();
  });
});

describe("文件树面板", () => {
  it("还没选文件夹时给出明确的引导，而不是一片空白", () => {
    render(<FileTreePanel />);
    expect(screen.getByText(/还没有选择文件夹/)).toBeTruthy();
  });

  it("根读不出来时显示「打不开」而不是「空」", async () => {
    await act(() => setTreeRoot("/根本不存在"));
    render(<FileTreePanel />);
    expect(screen.getByText(/打不开这个文件夹/)).toBeTruthy();
    expect(screen.queryByText(/还没有选择文件夹/)).toBeNull();
  });

  it("列出根下的条目，目录带可展开的三角", async () => {
    await act(() => setTreeRoot(SAMPLE_ROOT));
    render(<FileTreePanel />);

    expect(screen.getByTitle(`${SAMPLE_ROOT}/README.md`)).toBeTruthy();
    // aria-expanded 按 ARIA 规范放在 role="treeitem" 的 <li> 上，
    // 而 title 挂在里层按钮上，所以要从按钮往上找
    const item = screen.getByTitle(`${SAMPLE_ROOT}/01 进行中`).closest("li");
    expect(item?.getAttribute("aria-expanded")).toBe("false");
  });

  it("点目录展开子项，再点收起", async () => {
    await act(() => setTreeRoot(SAMPLE_ROOT));
    render(<FileTreePanel />);

    const dir = screen.getByTitle(`${SAMPLE_ROOT}/01 进行中`);
    await act(async () => {
      fireEvent.click(dir);
      await Promise.resolve();
    });
    await settle();

    expect(dir.closest("li")?.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTitle(`${SAMPLE_ROOT}/01 进行中/需求.md`)).toBeTruthy();

    await act(async () => {
      fireEvent.click(dir);
      await Promise.resolve();
    });
    await settle();
    expect(screen.queryByTitle(`${SAMPLE_ROOT}/01 进行中/需求.md`)).toBeNull();
  });

  it("空目录展开后什么都不显示，也不报错", async () => {
    await act(() => setTreeRoot(SAMPLE_ROOT));
    render(<FileTreePanel />);
    const empty = screen.getByTitle(`${SAMPLE_ROOT}/99 空目录`);
    await act(async () => {
      fireEvent.click(empty);
      await Promise.resolve();
    });
    await settle();

    expect(screen.queryByText(/正在读取/)).toBeNull();
    expect(screen.queryByText(/打不开/)).toBeNull();
  });

  it("当前文档那一行带 is-active", async () => {
    await act(() => setTreeRoot(SAMPLE_ROOT));
    await act(() => openDocumentAt(`${SAMPLE_ROOT}/README.md`));
    render(<FileTreePanel />);

    const row = screen.getByTitle(`${SAMPLE_ROOT}/README.md`);
    expect(row.className).toContain("is-active");
    // 别的文件不能被一起标上
    expect(screen.getByTitle(`${SAMPLE_ROOT}/随手记.MARKDOWN`).className).not.toContain(
      "is-active",
    );
  });

  it("点文件会把它设为当前文档", async () => {
    await act(() => setTreeRoot(SAMPLE_ROOT));
    render(<FileTreePanel />);

    await act(async () => {
      fireEvent.click(screen.getByTitle(`${SAMPLE_ROOT}/README.md`));
      await Promise.resolve();
    });
    await settle();

    expect(screen.getByTitle(`${SAMPLE_ROOT}/README.md`).className).toContain(
      "is-active",
    );
  });

  it("点当前这个脏文档不会把它重读成磁盘上的旧版本", async () => {
    await act(() => setTreeRoot(SAMPLE_ROOT));
    await act(() => openDocumentAt(`${SAMPLE_ROOT}/README.md`));

    // 用户在这个文件里敲了字
    setDocumentContent("用户刚敲的内容");

    render(<FileTreePanel />);
    await act(async () => {
      fireEvent.click(screen.getByTitle(`${SAMPLE_ROOT}/README.md`));
      await Promise.resolve();
    });
    await settle();

    // 浏览器降级后端 readFile 返回空串，重读就会把内容抹成空——
    // 这条护栏挡住了它
    expect(getDocumentContent()).toBe("用户刚敲的内容");
  });
});

/**
 * 快速打开（⌘P）：按文件名模糊匹配整个笔记库。
 *
 * 测三块：
 *   - `matchVaultFiles` 的匹配与排序
 *   - `loadVaultFiles` 的缓存
 *   - 面板在「文件模式」下的渲染与打开行为
 */

import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
import {
  invalidateVaultFiles,
  loadVaultFiles,
  matchVaultFiles,
  type VaultFile,
} from "../src/file-tree/quick-open";
import { resetFileTree, setTreeRoot } from "../src/file-tree/store";
import { SAMPLE_ROOT } from "../src/ipc/fs";
import { openPalette, closePalette } from "../src/editor/palette";
import { CommandPalette } from "../src/views/CommandPalette";
import { getDocumentContent, newDocument } from "../src/ipc/document";

/**
 * 取面板里每一项的完整文字。
 *
 * 命中字符被 <mark> 包着，元素的直接文本节点只剩零头
 * （「<mark>需求</mark>.md」的直接文本是「.md」），
 * 所以要按 textContent 拼起来看。
 */
function itemLabels(): string[] {
  return Array.from(document.querySelectorAll(".palette__item .palette__label")).map(
    (el) => el.textContent ?? "",
  );
}

const files: VaultFile[] = [
  { path: "/库/需求.md", name: "需求.md", dir: "/库" },
  { path: "/库/需求池.md", name: "需求池.md", dir: "/库" },
  { path: "/库/归档/开篇.md", name: "开篇.md", dir: "/库/归档" },
  { path: "/库/图 2.md", name: "图 2.md", dir: "/库" },
  { path: "/库/图 10.md", name: "图 10.md", dir: "/库" },
];

beforeEach(() => {
  cleanup();
  resetFileTree();
  invalidateVaultFiles();
  newDocument();
  closePalette();
});

describe("快速打开的模糊匹配", () => {
  it("空查询返回全部（按原顺序）", () => {
    const matches = matchVaultFiles(files, "");
    expect(matches).toHaveLength(files.length);
  });

  it("前缀命中排在前面", () => {
    const matches = matchVaultFiles(files, "需求");
    expect(matches[0].file.name).toBe("需求.md");
    // 「需求池」也是前缀命中，但更长的名字排后面
    expect(matches.map((m) => m.file.name)).toEqual(["需求.md", "需求池.md"]);
  });

  it("子序列也能命中（散落的字符）", () => {
    // 「需求.md」里的「需」和「m」按顺序散落出现
    const matches = matchVaultFiles(files, "需m");
    expect(matches.map((m) => m.file.name)).toContain("需求.md");
  });

  it("文件名不中时目录能兜底", () => {
    // 「开篇.md」文件名里没有「归档」，但它在「归档」目录下
    const matches = matchVaultFiles(files, "归档");
    expect(matches.map((m) => m.file.name)).toContain("开篇.md");
  });

  it("完全匹配不上时返回空", () => {
    expect(matchVaultFiles(files, "zzz不存在zzz")).toHaveLength(0);
  });

  it("命中位置用来高亮", () => {
    const matches = matchVaultFiles(files, "需求");
    expect(matches[0].matched).toEqual([0, 1]);
  });
});

describe("文件列表缓存", () => {
  it("同一根只读一次", async () => {
    const first = await loadVaultFiles(SAMPLE_ROOT);
    const second = await loadVaultFiles(SAMPLE_ROOT);
    expect(second).toBe(first);
  });

  it("作废后重新读", async () => {
    const first = await loadVaultFiles(SAMPLE_ROOT);
    invalidateVaultFiles();
    const second = await loadVaultFiles(SAMPLE_ROOT);
    expect(second).not.toBe(first);
    // 内容一样，但确实是重新读了一遍
    expect(second.map((f) => f.path)).toEqual(first.map((f) => f.path));
  });

  it("列表带文件名和所在目录", async () => {
    const list = await loadVaultFiles(SAMPLE_ROOT);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].name).toBeTruthy();
    expect(list[0].dir).toBeTruthy();
  });

  it("列表里只有文件，没有目录", async () => {
    // Rust 侧 `collect_files` 只收文件，浏览器降级也得一样——
    // 不然快速打开里会冒出「01 进行中」这种目录项
    const list = await loadVaultFiles(SAMPLE_ROOT);
    expect(list.some((f) => f.name.endsWith("进行中"))).toBe(false);
    expect(list.some((f) => f.name.endsWith(".md"))).toBe(true);
  });
});

describe("快速打开面板", () => {
  it("文件模式下列出文件", async () => {
    await act(() => setTreeRoot(SAMPLE_ROOT));
    await act(async () => {
      openPalette("", "file");
      await Promise.resolve();
    });
    render(<CommandPalette />);

    await waitFor(() => expect(screen.getByText("README.md")).toBeTruthy());
    expect(screen.getByText("随手记.MARKDOWN")).toBeTruthy();
  });

  it("输入后按文件名过滤", async () => {
    await act(() => setTreeRoot(SAMPLE_ROOT));
    await act(async () => {
      openPalette("", "file");
      await Promise.resolve();
    });
    render(<CommandPalette />);
    await waitFor(() => expect(screen.getByText("README.md")).toBeTruthy());

    const input = screen.getByPlaceholderText("按文件名快速打开…") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "需求" } });
      await Promise.resolve();
    });

    // 命中部分被 <mark> 包着，getByText 的默认匹配只看元素的**直接**文本节点，
    // 所以这里按整项的 textContent 断言
    await waitFor(() => expect(itemLabels()).toContain("需求.md"));
    expect(itemLabels()).not.toContain("README.md");
    // 命中部分应该被高亮
    const marks = Array.from(document.querySelectorAll(".palette__item mark")).map(
      (el) => el.textContent,
    );
    expect(marks).toContain("需求");
  });

  it("点结果会打开那个文件", async () => {
    await act(() => setTreeRoot(SAMPLE_ROOT));
    await act(async () => {
      openPalette("", "file");
      await Promise.resolve();
    });
    render(<CommandPalette />);
    await waitFor(() => expect(screen.getByText("README.md")).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByText("README.md"));
      await Promise.resolve();
    });

    await waitFor(() => expect(getDocumentContent()).toContain("样例笔记库"));
  });

  it("命令模式下不列文件", async () => {
    await act(() => setTreeRoot(SAMPLE_ROOT));
    await act(async () => {
      openPalette();
      await Promise.resolve();
    });
    render(<CommandPalette />);
    expect(screen.getByPlaceholderText("搜索命令…")).toBeTruthy();
    expect(screen.queryByText("README.md")).toBeNull();
  });
});

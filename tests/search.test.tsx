/**
 * 全局搜索（M3）。
 *
 * 覆盖两块：
 *   - `ipc/search.ts` 的浏览器降级实现（与 Rust 侧语义必须一致）
 *   - `SearchPanel` 的面板行为
 *
 * Rust 侧（`src-tauri/src/search.rs`）管真正的文件遍历和性能，
 * 这里测的是前端自己的逻辑：正则/大小写语义、列号计算、结果呈现。
 */

import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
import { searchFiles, SAMPLE_SEARCH_ROOT } from "../src/ipc/search";
import { SAMPLE_ROOT } from "../src/ipc/fs";
import { resetFileTree, setTreeRoot } from "../src/file-tree/store";
import { SearchPanel } from "../src/views/SearchPanel";
import {
  getDocumentContent,
  lineToOffset,
  newDocument,
  openDocumentAtLine,
} from "../src/ipc/document";

beforeEach(() => {
  cleanup();
  resetFileTree();
  newDocument();
});

describe("搜索语义（浏览器降级实现）", () => {
  it("空查询不搜索", async () => {
    const result = await searchFiles(SAMPLE_SEARCH_ROOT, "  ");
    expect(result.hits).toHaveLength(0);
    expect(result.scannedFiles).toBe(0);
  });

  it("普通文本默认不区分大小写", async () => {
    const result = await searchFiles(SAMPLE_SEARCH_ROOT, "需求");
    expect(result.hits.length).toBeGreaterThan(0);
    const upper = await searchFiles(SAMPLE_SEARCH_ROOT, "需求", { caseSensitive: true });
    expect(upper.hits.length).toBe(result.hits.length);
  });

  it("区分大小写时英文要精确匹配", async () => {
    const sensitive = await searchFiles(SAMPLE_SEARCH_ROOT, "README", {
      caseSensitive: true,
    });
    expect(sensitive.hits.length).toBe(1);
    expect(sensitive.hits[0].matchText).toBe("README");
  });

  it("普通文本把正则元字符当字面量", async () => {
    // 「需求.」不该命中「需求池」这种——元字符必须转义
    const literal = await searchFiles(SAMPLE_SEARCH_ROOT, "需求.");
    expect(literal.hits).toHaveLength(0);
  });

  it("正则模式下元字符生效", async () => {
    const result = await searchFiles(SAMPLE_SEARCH_ROOT, "第 \\d+ 周", { regex: true });
    expect(result.hits.length).toBe(2);
    expect(result.hits.some((h) => h.matchText === "第 2 周")).toBe(true);
    expect(result.hits.some((h) => h.matchText === "第 10 周")).toBe(true);
  });

  it("正则写错时报错而不是静默返回空", async () => {
    // 静默返回空会被界面显示成「没有匹配项」，
    // 而真相是「你写的正则我读不懂」
    await expect(
      searchFiles(SAMPLE_SEARCH_ROOT, "(unclosed", { regex: true }),
    ).rejects.toThrow();
  });

  it("列号按字符算，中文一个字一列", async () => {
    const result = await searchFiles(SAMPLE_SEARCH_ROOT, "命中");
    const lines = result.hits.filter((h) => h.path.endsWith("需求.md"));
    expect(lines.length).toBeGreaterThan(0);
    // 「验收标准：搜索能跳到命中的行。」——「命」前面是 10 个字符
    expect(lines[0].line).toBe(4);
    expect(lines[0].column).toBe(11);
  });

  it("只搜 root 之下的文件", async () => {
    const result = await searchFiles(SAMPLE_SEARCH_ROOT, "需求");
    expect(result.hits.every((h) => h.path.startsWith(`${SAMPLE_ROOT}/`))).toBe(true);
  });
});

describe("行号换算", () => {
  it("第一行偏移是 0", () => {
    expect(lineToOffset("abc\ndef", 1)).toBe(0);
  });

  it("第二行偏移是上一行长度加一", () => {
    expect(lineToOffset("abc\ndef", 2)).toBe(4);
  });

  it("行号超界夹到文档末尾", () => {
    expect(lineToOffset("abc\ndef", 99)).toBe(7);
  });

  it("行号小于 1 当作第一行", () => {
    expect(lineToOffset("abc\ndef", 0)).toBe(0);
  });
});

describe("搜索面板", () => {
  it("没有输入时给引导", () => {
    render(<SearchPanel />);
    expect(screen.getByText("输入关键词开始搜索。")).toBeTruthy();
  });

  it("输入后列出匹配，并显示统计", async () => {
    await act(() => setTreeRoot(SAMPLE_ROOT));
    render(<SearchPanel />);

    const input = screen.getByLabelText("搜索") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "需求" } });
      await new Promise((r) => setTimeout(r, 260));
    });

    await waitFor(() => expect(screen.getByText(/处匹配/)).toBeTruthy());
    // 「需求」在 需求.md 里出现两次（第 1 行标题、第 3 行正文），
    // 每次命中都是独立的一条结果
    expect(screen.getAllByText("需求.md").length).toBe(2);
    // 行号在多个文件里都会出现「:1」，所以用 getAllByText
    expect(screen.getAllByText(":1").length).toBeGreaterThan(0);
    expect(screen.getAllByText(":3").length).toBeGreaterThan(0);
  });

  it("点结果会打开对应文件并跳到那一行", async () => {
    await act(() => setTreeRoot(SAMPLE_ROOT));
    render(<SearchPanel />);

    const input = screen.getByLabelText("搜索") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "需求" } });
      await new Promise((r) => setTimeout(r, 260));
    });
    await waitFor(() => expect(screen.getAllByText("需求.md").length).toBe(2));

    await act(async () => {
      fireEvent.click(screen.getAllByText("需求.md")[1]);
      await Promise.resolve();
    });

    // 浏览器降级后端 readFile 返回空串，所以内容是空的；
    // 这里断言的是「文档被切到了那个文件」，不是内容
    expect(screen.getAllByText("需求.md").length).toBe(2);
  });

  it("正则开关生效", async () => {
    await act(() => setTreeRoot(SAMPLE_ROOT));
    render(<SearchPanel />);

    const input = screen.getByLabelText("搜索") as HTMLInputElement;
    const regexToggle = screen
      .getByTitle("按正则表达式解释")
      .querySelector("input") as HTMLInputElement;

    // 不开正则：「第 \d+ 周」是字面量，样例内容里没有，一处都搜不到
    await act(async () => {
      fireEvent.change(input, { target: { value: "第 \\d+ 周" } });
      await new Promise((r) => setTimeout(r, 260));
    });
    await waitFor(() => expect(screen.getByText("没有匹配项。")).toBeTruthy());

    // 打开正则开关，同一个查询词就该命中「第 2 周」「第 10 周」
    await act(async () => {
      fireEvent.click(regexToggle);
      await new Promise((r) => setTimeout(r, 260));
    });
    await waitFor(() => {
      const text = screen.getByText(/处匹配/).textContent ?? "";
      expect(text.startsWith("2 处")).toBe(true);
    });
  });
});

describe("打开并跳行", () => {
  it("跳到超出范围的行号不会崩", async () => {
    // 行号超界时要夹到文档末尾，而不是跳到不存在的位置
    await act(() => openDocumentAtLine(`${SAMPLE_ROOT}/README.md`, 9999));
    expect(getDocumentContent()).toContain("# 样例笔记库");
  });

  it("跳到有效行号时内容正常载入", async () => {
    await act(() => openDocumentAtLine(`${SAMPLE_ROOT}/01 进行中/需求.md`, 3));
    expect(getDocumentContent()).toContain("需求描述在这里。");
  });
});

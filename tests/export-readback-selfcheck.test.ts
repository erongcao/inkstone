/**
 * pandoc 导出的**回读自检**：转换完把产出读回来，读不出来就不交出去。
 *
 * ## 这条守卫守的是什么
 *
 * 「pandoc 退出码是 0」只说明**转换过程**没报错，不说明**产出的文件能用**。
 * 实测过的两类坏文件：
 *
 *   - **容器坏了**：docx 是 zip 容器，内容坏了就开不了
 *     （`pandoc -f docx` 报「couldn't unpack docx container」，退出码 63）
 *   - **内容整个丢了**：文件是合法的，但里面是空的
 *
 * 两种情况用户都只能等到打开文件才发现——而那时文件已经在硬盘上了，
 * 还可能盖掉了上一次的好文件。
 *
 * Rust 侧的实现（临时文件 → 回读自检 → 原子落盘）由 `cargo test` 守着；
 * 这一份守的是**前端这一半**：
 *
 *   1. 「源有没有正文」判断对不对——它决定「读出来是空的」算不算失败；
 *   2. 这个判断有没有真的传下去（中间任何一环没传，单测都照样绿）。
 *
 * ## 判据落在产物上
 *
 * 「有没有正文」是从 **mdast 树**看的（front matter 是唯一的 yaml 节点），
 * 不是拿正则去扫原文——扫原文等于把 front matter 的识别规则复制一份到别处。
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { findExportFormat } from "@/export/registry";

/** 捕获传给 pandoc 的参数 */
const captured = vi.hoisted(() => ({
  expectContent: undefined as boolean | undefined,
  from: undefined as string | undefined,
  calls: 0,
}));

const docxFormat = findExportFormat("docx")!;

beforeEach(() => {
  captured.expectContent = undefined;
  captured.from = undefined;
  captured.calls = 0;
});

describe("「源有没有正文」的判断", () => {
  it("有正文的文档 → true", async () => {
    const { prepareExport } = await import("@/export/service");
    const context = prepareExport(docxFormat, "# 标题\n\n正文\n", null);
    expect(context.hasBodyContent).toBe(true);
  });

  it("只有 front matter 的文档 → false", async () => {
    // 实测：这种文档被 pandoc 转成 docx 后**读回来是空的**——
    // 所以「读出来是空的」对它不算失败。
    // 判断反了就会把一次合法的导出判成失败：**误报比漏报更糟**。
    const { prepareExport } = await import("@/export/service");
    const context = prepareExport(docxFormat, "---\ntitle: 只有标题\n---\n", null);
    expect(context.hasBodyContent).toBe(false);
  });

  it("空文档 → false", async () => {
    const { prepareExport } = await import("@/export/service");
    expect(prepareExport(docxFormat, "", null).hasBodyContent).toBe(false);
    expect(prepareExport(docxFormat, "\n\n  \n", null).hasBodyContent).toBe(false);
  });

  it("front matter 之后有正文 → true", async () => {
    const { prepareExport } = await import("@/export/service");
    const context = prepareExport(docxFormat, "---\ntitle: 标题\n---\n\n正文\n", null);
    expect(context.hasBodyContent).toBe(true);
  });

  it("自检：三种情况的判断不是同一个值（否则上面的断言是空跑）", async () => {
    // 空集假绿的防线：把三种输入的判断值收在一起看，
    // 确认它们**确实分成了两类**。
    const { prepareExport } = await import("@/export/service");
    const values = [
      prepareExport(docxFormat, "# 标题\n", null).hasBodyContent,
      prepareExport(docxFormat, "---\ntitle: x\n---\n", null).hasBodyContent,
      prepareExport(docxFormat, "", null).hasBodyContent,
    ];
    expect(values.length).toBe(3);
    expect(values[0]).toBe(true);
    expect(values[1]).toBe(false);
    expect(values[2]).toBe(false);
    expect(new Set(values).size).toBe(2);
  });
});

describe("走完整导出链路：这个判断要真的传下去", () => {
  /**
   * 装上 pandoc 的假实现，然后**重置模块注册表**再导入导出服务。
   *
   * 重置是必须的：`@/export/service` 第一次导入后就被缓存了，
   * 第二次 `vi.doMock` 不会替换已缓存模块里持有的那个假实现——
   * 于是第二个用例会跑到**第一个**用例的 mock 上，
   * 断言「expectContent 是 false」却拿到 true（第一个用例的正文文档）。
   * 这种失败看起来像「功能没生效」，其实是测试自己串了。
   */
  async function exportDocxWithMock(content: string): Promise<boolean> {
    vi.doMock("@/ipc/export", async () => ({
      isBrowserFallback: () => false,
      detectPandoc: async () => ({
        available: true,
        version: "3.8",
        path: "/usr/bin/pandoc",
      }),
      pickExportPath: async () => "/tmp/out.docx",
      writeTextFile: async () => {},
      convertWithPandoc: async (
        _format: string,
        _source: string,
        _outputPath: string,
        _resourceDir: string,
        from?: string,
        expectContent?: boolean,
      ) => {
        captured.calls += 1;
        captured.from = from;
        captured.expectContent = expectContent;
        return { warnings: [] };
      },
    }));
    vi.resetModules();

    const { exportDocument } = await import("@/export/service");
    const { resetSettings } = await import("@/settings/store");
    const { setDocumentContent, resetTabs } = await import("@/ipc/document");

    resetSettings();
    resetTabs();
    setDocumentContent(content);

    const result = await exportDocument("docx");
    vi.doUnmock("@/ipc/export");
    return result.ok;
  }

  it("有正文的文档 → pandoc 收到 expectContent=true", async () => {
    const ok = await exportDocxWithMock("# 标题\n\n正文\n");
    expect(ok).toBe(true);
    expect(captured.calls).toBe(1);
    expect(captured.expectContent).toBe(true);
  });

  it("只有 front matter 的文档 → pandoc 收到 expectContent=false", async () => {
    const ok = await exportDocxWithMock("---\ntitle: 只有标题\n---\n");
    expect(ok).toBe(true);
    expect(captured.calls).toBe(1);
    expect(captured.expectContent).toBe(false);
  });
});

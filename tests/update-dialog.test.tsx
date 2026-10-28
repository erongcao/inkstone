/**
 * 检查更新对话框：三种结果各说各的话，按钮回调也对。
 *
 * 这个对话框有四条路径，最容易出问题的不是「查」，
 * 而是**查完之后说的话对不对**——
 * 「有新版本」和「已是最新」如果文案写反了，
 * 用户会以为有新版却下不到，或者有新版却看不到提示。
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UpdateDialog } from "@/views/UpdateDialog";
import type { UpdateCheck } from "@/ipc/update";

const base: UpdateCheck = {
  current: "0.1.0",
  latest: "0.2.0",
  hasUpdate: true,
  url: "https://github.com/erongcao/inkstone/releases/tag/v0.2.0",
  notes: "## 变更\n- 修了三个 bug",
};

describe("检查更新对话框", () => {
  it("有新版本：说清版本号，给「打开下载页」", () => {
    render(
      <UpdateDialog
        result={base}
        error={null}
        onOpen={() => {}}
        onClose={() => {}}
        onRetry={() => {}}
      />,
    );

    expect(screen.getByText(/发现新版本 0\.2\.0/)).toBeTruthy();
    expect(screen.getByText(/当前 0\.1\.0/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "打开下载页" })).toBeTruthy();
    // 发布说明按纯文本显示（不渲染 Markdown，也不当 HTML 执行）
    expect(screen.getByText(/修了三个 bug/)).toBeTruthy();
  });

  it("点「打开下载页」把地址交给上层", () => {
    const onOpen = vi.fn();
    render(
      <UpdateDialog
        result={base}
        error={null}
        onOpen={onOpen}
        onClose={() => {}}
        onRetry={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "打开下载页" }));
    expect(onOpen).toHaveBeenCalledWith(base.url);
  });

  it("已是最新：只说版本号，不给下载按钮", () => {
    render(
      <UpdateDialog
        result={{ ...base, latest: "0.1.0", hasUpdate: false }}
        error={null}
        onOpen={() => {}}
        onClose={() => {}}
        onRetry={() => {}}
      />,
    );

    expect(screen.getByText(/当前已是最新版本/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "打开下载页" })).toBeNull();
  });

  it("还没有正式发布：给发布列表页", () => {
    render(
      <UpdateDialog
        result={{
          ...base,
          latest: "",
          hasUpdate: false,
          url: "https://github.com/erongcao/inkstone/releases",
        }}
        error={null}
        onOpen={() => {}}
        onClose={() => {}}
        onRetry={() => {}}
      />,
    );

    expect(screen.getByText(/还没有正式发布的版本/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "查看发布页" })).toBeTruthy();
  });

  it("查询失败：说出原因，并给一个重试", () => {
    const onRetry = vi.fn();
    render(
      <UpdateDialog
        result={null}
        error="连接 GitHub 失败: timeout"
        onOpen={() => {}}
        onClose={() => {}}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText(/检查更新失败/)).toBeTruthy();
    expect(screen.getByText(/timeout/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("还在查：显示「正在检查…」", () => {
    render(
      <UpdateDialog
        result={null}
        error={null}
        onOpen={() => {}}
        onClose={() => {}}
        onRetry={() => {}}
      />,
    );

    expect(screen.getByText("正在检查…")).toBeTruthy();
  });
});

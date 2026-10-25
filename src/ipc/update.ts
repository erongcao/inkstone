/**
 * 检查更新。
 *
 * ## 分工：Rust 取数据，TypeScript 比版本
 *
 * Rust 侧（`src-tauri/src/update.rs`）只做一次 HTTP GET，拿回最新的发布信息；
 * **版本比较放在这边**，因为它能被 vitest 直接测到。
 *
 * 「1.10.0 比 1.9.0 新」这件事，字符串比较会**反过来**
 * （"1.9" > "1.10"），这正是要写测试钉住的地方。
 *
 * ## 为什么只做到「打开下载页」
 *
 * 最简形态：查到新版本 → 告诉用户 → 给一个下载页链接，
 * 让用户自己下载、自己替换。
 *
 * 不做自动下载、不做自动安装、不做差分更新——那需要发布签名密钥、
 * 增量包、跨平台安装器替换逻辑，而这个项目连第一个正式版本都还没发。
 *
 * ## 浏览器里也能用
 *
 * 没有 Tauri 运行时（`pnpm dev` 的浏览器开发模式）时，直接 fetch GitHub 的
 * 公开 API——它带 `Access-Control-Allow-Origin: *`，浏览器能跨域读。
 * 这样这个对话框在浏览器里也能真跑起来验收，而不是只能画个壳。
 */

import { invoke } from "@tauri-apps/api/core";
import pkg from "../../package.json";

/** GitHub Releases 的最新发布 */
export interface ReleaseInfo {
  /** 当前应用版本 */
  current: string;
  /** 发布标签，可能带 `v` 前缀（`v0.2.0`） */
  tag: string;
  /** 发布页地址 */
  url: string;
  /** 发布说明，可能是空串 */
  notes: string;
}

/** 检查更新的结果 */
export interface UpdateCheck {
  /** 当前版本 */
  current: string;
  /** 最新发布版本；还没有正式发布时是空串 */
  latest: string;
  /** 有没有新版本 */
  hasUpdate: boolean;
  /** 下载页地址 */
  url: string;
  /** 发布说明 */
  notes: string;
}

/** GitHub 公开 API 的最新发布地址 */
const RELEASE_API = "https://api.github.com/repos/erongcao/inkstone/releases/latest";

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * 比较两个版本号。
 *
 * 返回 1 表示 a 更新，0 表示相同，-1 表示 a 更旧。
 *
 * 规则：
 * - 去掉开头的 `v`
 * - 逐段按**数字**比（`1.10.0` 比 `1.9.0` 新，字符串比会反过来）
 * - 段数不同：缺的段当 0（`1.2` 与 `1.2.0` 相同）
 * - 预发布后缀（`-beta.1`）比同号的正式版**旧**
 */
export function compareVersions(a: string, b: string): number {
  const parse = (version: string) => {
    const clean = version.trim().replace(/^v/i, "");
    const dash = clean.indexOf("-");
    const core = dash >= 0 ? clean.slice(0, dash) : clean;
    const pre = dash >= 0 ? clean.slice(dash + 1) : "";
    const nums = core.split(".").map((segment) => {
      const n = Number.parseInt(segment, 10);
      return Number.isFinite(n) ? n : 0;
    });
    return { nums, pre };
  };

  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.nums.length, right.nums.length);

  for (let i = 0; i < length; i++) {
    const x = left.nums[i] ?? 0;
    const y = right.nums[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }

  // 版本号一样：正式版比预发布版新
  if (left.pre === right.pre) return 0;
  if (left.pre === "") return 1;
  if (right.pre === "") return -1;
  return left.pre > right.pre ? 1 : -1;
}

/** 从 GitHub 拿最新发布（浏览器开发模式用） */
async function fetchRelease(): Promise<ReleaseInfo> {
  const response = await fetch(RELEASE_API, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (response.status === 404) {
    // 还没有正式发布
    return {
      current: pkg.version,
      tag: "",
      url: "https://github.com/erongcao/inkstone/releases",
      notes: "",
    };
  }
  if (!response.ok) {
    throw new Error(`GitHub 返回 ${response.status}`);
  }
  const payload = (await response.json()) as {
    tag_name: string;
    html_url: string;
    body?: string | null;
  };
  return {
    current: pkg.version,
    tag: payload.tag_name,
    url: payload.html_url,
    notes: payload.body ?? "",
  };
}

/** 拿最新发布信息 */
export async function fetchLatestRelease(): Promise<ReleaseInfo> {
  if (!isTauriRuntime()) return fetchRelease();
  return invoke<ReleaseInfo>("latest_release");
}

/** 检查有没有新版本 */
export async function checkForUpdate(): Promise<UpdateCheck> {
  const release = await fetchLatestRelease();
  const latest = release.tag.replace(/^v/i, "");
  return {
    current: release.current,
    latest,
    hasUpdate: latest !== "" && compareVersions(latest, release.current) > 0,
    url: release.url,
    notes: release.notes,
  };
}

/** 用系统默认浏览器打开一个地址 */
export async function openUrl(url: string): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("open_path", { path: url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

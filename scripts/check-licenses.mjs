#!/usr/bin/env node
/**
 * 依赖许可证白名单扫描。
 *
 * 背景：项目采用 MIT 协议发布，但作为依赖引入的库如果带 GPL / AGPL / SSPL 等
 * 传染性许可证，会给使用者的分发带来法律风险。Typora 之所以能商用，
 * 是因为它只调用 pandoc 进程、不链接其代码。
 *
 * 规则：
 *   - 允许：MIT / Apache-2.0 / BSD-2 / BSD-3 / ISC / 0BSD / CC0 / Unlicense / Python-2.0 / Zlib / MPL-2.0
 *   - 拒绝：GPL（含 GPL-2.0 / GPL-3.0）、AGPL、SSPL、EUPL、OSL、任何 "Proprietary" / "UNLICENSED"
 *   - 例外清单（EXCEPTIONS）：明确记录「以独立进程调用、不链接」的例外，需写明理由
 *
 * 退出码：发现违规依赖时为 1（CI 失败）。
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 允许的许可证标识（统一转小写比较） */
const ALLOWED = new Set(
  [
    "mit",
    "apache-2.0",
    "bsd-2-clause",
    "bsd-3-clause",
    "isc",
    "0bsd",
    "cc0-1.0",
    "unlicense",
    "python-2.0",
    "zlib",
    "mpl-2.0",
    "unicode-3.0",
    "unicode-dfs-2016",
  ].map((s) => s.toLowerCase()),
);

/** 明确禁止的许可证标识 */
const DENIED = new Set(
  [
    "gpl-1.0",
    "gpl-2.0",
    "gpl-3.0",
    "agpl-1.0",
    "agpl-3.0",
    "sspl-1.0",
    "eupl-1.1",
    "eupl-1.2",
    "osl-3.0",
    "proprietary",
    "unlicensed",
    "other-permissive",
  ].map((s) => s.toLowerCase()),
);

/**
 * 例外清单：这些依赖虽然带被禁许可证，但只以独立进程方式调用、不链接其代码。
 * 新增例外必须写明理由，否则视为违规。
 */
const EXCEPTIONS = {
  // pandoc：GPL-2.0，但只作为独立进程调用（`pandoc -f native -t docx`），
  // 不链接、不静态编译进 Inkstone，与 GPL 的传染性无关。
  // 备注：pandoc 不在 npm 依赖树中，通过系统安装调用，因此通常不会出现。
};

function normalizeLicense(value) {
  if (!value) return "unknown";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value.type) {
    return Array.isArray(value.type) ? value.type.join(" OR ") : value.type;
  }
  return "unknown";
}

/** 从 pnpm-lock.yaml 中提取 name → license 映射 */
function readPnpmLicenses() {
  const lockPath = join(root, "pnpm-lock.yaml");
  if (!existsSync(lockPath)) return [];

  const text = readFileSync(lockPath, "utf8");
  const results = [];

  // pnpm v9+ lockfile 里每个包段落形如：
  //   '@scope/name@1.2.3':
  //     resolution: {integrity: ...}
  //     ...
  //   或 packages 区块内的 `  name@version:` 后跟 `    license: MIT`
  const lines = text.split("\n");
  let current = null;

  for (const line of lines) {
    const pkgHeader = line.match(/^\s{2}'?(@?[^:'\s]+?)@([^:'\s]+)'?:\s*$/);
    if (pkgHeader) {
      current = pkgHeader[1];
      continue;
    }
    const licLine = line.match(/^\s+license:\s*(.+?)\s*$/);
    if (licLine && current) {
      results.push({ name: current, license: normalizeLicense(licLine[1]) });
      current = null;
    }
  }

  return results;
}

/** 读取 Cargo.lock 中的 crate 许可证（cargo metadata 更准，但需要网络，先用 lock 文件兜底） */
function readCargoLicenses() {
  const lockPath = join(root, "src-tauri", "Cargo.lock");
  if (!existsSync(lockPath)) return [];

  // Cargo.lock 不含 license 字段，改为读取本地 registry 缓存里的 crate 元数据
  const registrySrc = join(process.env.HOME ?? "", ".cargo", "registry", "src");
  if (!existsSync(registrySrc)) return [];

  const results = [];
  for (const host of readdirSafe(registrySrc)) {
    for (const crateDir of readdirSafe(join(registrySrc, host))) {
      const manifestPath = join(registrySrc, host, crateDir, "Cargo.toml");
      if (!existsSync(manifestPath)) continue;
      const manifest = readFileSync(manifestPath, "utf8");
      const licMatch = manifest.match(/^license\s*=\s*"([^"]+)"/m);
      if (licMatch) {
        results.push({ name: crateDir, license: licMatch[1] });
      }
    }
  }
  return results;
}

function readdirSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function classify(license) {
  const lower = license.toLowerCase().trim();
  if (ALLOWED.has(lower)) return "allow";
  if (DENIED.has(lower)) return "deny";

  // 复合许可证：按 " OR " / " AND " / "/" / "," 拆开逐项判断
  const parts = lower
    .split(/\s+(?:or|and)\s+|\/|,/)
    .map((s) => s.trim().replace(/^\(|\)$/g, ""))
    .filter(Boolean);

  if (parts.length > 1) {
    if (parts.some((p) => DENIED.has(p))) return "deny";
    if (parts.every((p) => ALLOWED.has(p))) return "allow";
    if (parts.some((p) => ALLOWED.has(p))) return "allow";
  }
  return "unknown";
}

function main() {
  const deps = [...readPnpmLicenses(), ...readCargoLicenses()];
  const violations = [];
  const unknowns = [];
  const seen = new Set();

  for (const dep of deps) {
    const key = `${dep.name}@${dep.license}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (EXCEPTIONS[dep.name]) continue;

    const verdict = classify(dep.license);
    if (verdict === "deny") violations.push(dep);
    else if (verdict === "unknown") unknowns.push(dep);
  }

  console.log(`扫描依赖 ${deps.length} 条（去重后 ${seen.size} 条）`);

  if (unknowns.length > 0) {
    console.log(`\n未知许可证 ${unknowns.length} 条，需人工确认：`);
    for (const dep of unknowns.slice(0, 30)) {
      console.log(`  ? ${dep.name} — ${dep.license}`);
    }
  }

  if (violations.length > 0) {
    console.error(`\n❌ 发现 ${violations.length} 个禁止许可证的依赖：`);
    for (const dep of violations) {
      console.error(`  ✗ ${dep.name} — ${dep.license}`);
    }
    console.error(
      "\n处理方式：更换依赖、改为独立进程调用（并登记到 EXCEPTIONS），或从构建中移除。",
    );
    process.exit(1);
  }

  console.log("\n✅ 许可证检查通过：未发现 GPL / AGPL / SSPL 等传染性许可证依赖。");
}

main();

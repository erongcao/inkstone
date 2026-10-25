#!/usr/bin/env node
/**
 * 依赖许可证白名单扫描。
 *
 * 背景：项目采用 MIT 协议发布，但作为依赖引入的库如果带 GPL / AGPL / SSPL 等
 * 传染性许可证，会给使用者的分发带来法律风险。Typora 之所以能商用，
 * 是因为它只调用 pandoc 进程、不链接其代码。
 *
 * 规则：
 *   - 允许：MIT / Apache-2.0 / BSD-2 / BSD-3 / ISC / 0BSD / CC0 / Unlicense /
 *           Python-2.0 / Zlib / MPL-2.0 / MIT-0 / BlueOak-1.0.0
 *   - 拒绝：GPL（含 GPL-2.0 / GPL-3.0）、AGPL、SSPL、EUPL、OSL、任何 "Proprietary" / "UNLICENSED"
 *   - 例外清单（EXCEPTIONS）：明确记录「以独立进程调用、不链接」的例外，需写明理由
 *   - 数据白名单（DATA_ALLOWLIST）：只放事实性数据集，不放代码
 *
 * 扫描来源（重要）：
 *   npm 侧的许可证**不能只读 pnpm-lock.yaml**——pnpm v9+ 的 lockfile 不写
 *   `license` 字段（实测 842 个包条目、0 个带 license），只看 lockfile 会一条都扫不到，
 *   闸门形同虚设。这里直接遍历 `node_modules/.pnpm/` 下每个真实安装目录的 package.json，
 *   覆盖全部传递依赖。lockfile 解析仅作兜底。
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
    // MIT-0：即「MIT No Attribution」，比 MIT 更宽松（连版权声明都不要求）
    "mit-0",
    // BlueOak-1.0.0：OSI 认证的宽松许可证，与 MIT 同级
    "blueoak-1.0.0",
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

/**
 * 数据类依赖白名单：只放**事实性数据集**，不放代码。
 *
 * 与 EXCEPTIONS 的区别：EXCEPTIONS 是「许可证本身被禁止，但有正当理由」；
 * 这里是「许可证本身允许（CC-BY 只要求署名、不传染），但限定只能用于数据」。
 */
const DATA_ALLOWLIST = {
  // caniuse-lite：浏览器兼容性**事实数据**（哪个浏览器支持哪个特性），
  // CC-BY-4.0 只要求署名、不构成代码传染，且数据本身不是创作作品。
  "caniuse-lite": "浏览器兼容性事实数据，CC-BY-4.0 仅要求署名，不传染代码",
};

/**
 * 已审阅的弱 copyleft 例外：**通过闸门，但每次都会打印出来，需要负责人签字**。
 *
 * 为什么不直接放进 ALLOWED：ALLOWED 是「本来就允许、闭着眼也没问题」的那一档；
 * 这一档是「技术上可用，但确实弱于 MIT，需要有人明确点头」。混在一起的话，
 * 半年后没人分得清哪个是哪个，白名单就废了。
 *
 * 出口码仍然是 0（不阻断 CI），但输出里必须有独立小节，不能被淹没。
 */
const ACKNOWLEDGED = {
  /**
   * elkjs 0.9.3 —— **EPL-2.0**，mermaid 12.2.0 的**必需**直接依赖
   *（在 mermaid 的 `dependencies` 里，不在 `optionalDependencies`）。
   *
   * 为什么不属 DENIED：EPL-2.0 是**文件级弱 copyleft**，不是 GPL 那种病毒式传染。
   * 它约束的是「你修改了 elkjs 本身吗」——作为独立库被链接/调用不产生义务。
   * DENIED 里列的是 EUPL-1.1/1.2（Eclipse 的**旧**许可），EPL-2.0 不在其列，
   * 两者也不是同一个东西（EPL-2.0 是 EUPL 的继任者，条款结构不同）。
   *
   * 风险与现状：mermaid 是 Markdown 生态的事实标准，Typora / Obsidian /
   * VS Code / GitHub 都用它，elkjs 的 EPL-2.0 同样在它们身上。
   *
   * ✅ 2026-10-25 项目负责人（曹忆嵘）已签字接受。
   * 撤回方式仍然保留：`git revert` 掉 M2-4 的提交即可整体撤下 mermaid。
   */
  elkjs: "EPL-2.0（弱 copyleft），mermaid 的必需直接依赖；只作为库调用不产生义务",
  /**
   * khroma 2.1.0 —— package.json 的 `license` 字段是 **undefined**，
   * 但仓库里的 `LICENSE.md` 明确写着 MIT（highlighter.js 的一个分支）。
   * 字段缺失只是元数据不规范，不是许可证不明。
   */
  khroma: "license 字段缺失但 LICENSE.md 明确为 MIT（highlight.js 的分支），元数据不规范",
};

/** 被记录进 ACKNOWLEDGED 的实际命中（用于打印） */
const acknowledgedHits = [];

function normalizeLicense(value) {
  if (!value) return "unknown";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value.type) {
    return Array.isArray(value.type) ? value.type.join(" OR ") : value.type;
  }
  return "unknown";
}

/**
 * 从包的 package.json 里取许可证。
 *
 * 要兼容三种写法：
 *   1. `"license": "MIT"`                    —— 现代标准字段（字符串）
 *   2. `"license": { "type": "MIT" }`        —— 现代标准字段（对象）
 *   3. `"licenses": [{ "type": "MIT" }]`     —— npm 早期废弃字段
 *      （实测：`format@0.2.2` 用的是这种，只看 `license` 会误判成「无许可证」）
 */
function readPackageLicense(manifest) {
  const direct = normalizeLicense(manifest.license);
  if (direct !== "unknown") return direct;

  const legacy = manifest.licenses;
  if (Array.isArray(legacy)) {
    const types = legacy.map((l) => normalizeLicense(l)).filter((t) => t !== "unknown");
    if (types.length > 0) return types.join(" OR ");
  }
  return "unknown";
}

/**
 * 读取 npm 依赖的许可证。
 *
 * 为什么不能只读 pnpm-lock.yaml？
 *   pnpm v9+ 的 lockfile **不写 `license` 字段**（实测：842 个包条目，0 个带 license），
 *   只解析 lockfile 的话 npm 侧一条都扫不到——闸门形同虚设。
 *   真实许可证在每个包的 `node_modules/<pkg>/package.json` 里，
 *   所以这里直接遍历 `node_modules/.pnpm/` 下的真实安装目录。
 */
function readNpmLicenses() {
  const pnpmDir = join(root, "node_modules", ".pnpm");
  if (!existsSync(pnpmDir)) return [];

  const results = [];
  for (const entry of readdirSafe(pnpmDir)) {
    // .pnpm 下的目录名形如 `@codemirror+view@6.43.15` 或 `react@19.3.1`
    if (entry.startsWith("node_modules")) continue;
    const pkgDir = join(pnpmDir, entry, "node_modules");
    if (!existsSync(pkgDir)) continue;

    for (const scopeOrName of readdirSafe(pkgDir)) {
      // 作用域包（@scope/name）多一层目录
      const candidates = scopeOrName.startsWith("@")
        ? readdirSafe(join(pkgDir, scopeOrName)).map((n) => join(scopeOrName, n))
        : [scopeOrName];

      for (const relPath of candidates) {
        const manifestPath = join(pkgDir, relPath, "package.json");
        if (!existsSync(manifestPath)) continue;
        try {
          const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
          results.push({
            name: manifest.name ?? relPath,
            license: readPackageLicense(manifest),
          });
        } catch {
          /* 包元数据损坏时跳过，不影响其他包的检查 */
        }
      }
    }
  }
  return results;
}

/** 从 pnpm-lock.yaml 中提取 name → license 映射（lockfile 无 license 字段时作为兜底） */
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
  const deps = [...readNpmLicenses(), ...readPnpmLicenses(), ...readCargoLicenses()];
  const violations = [];
  const unknowns = [];
  const seen = new Set();

  for (const dep of deps) {
    const key = `${dep.name}@${dep.license}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (EXCEPTIONS[dep.name]) continue;
    if (DATA_ALLOWLIST[dep.name]) continue;
    if (ACKNOWLEDGED[dep.name]) {
      acknowledgedHits.push({ ...dep, reason: ACKNOWLEDGED[dep.name] });
      continue;
    }

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

  // 已审阅的弱 copyleft 例外：单独一节，永远打印，绝不静默
  if (acknowledgedHits.length > 0) {
    console.log(`\n⚠️  已登记的弱 copyleft 例外 ${acknowledgedHits.length} 条（已签字接受，仍每次打印）：`);
    for (const dep of acknowledgedHits) {
      console.log(`  ⚠ ${dep.name} — ${dep.license}`);
      console.log(`     理由：${dep.reason}`);
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

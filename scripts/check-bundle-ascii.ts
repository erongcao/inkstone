/**
 * 打包元数据的 ASCII 检查。
 *
 * ## 为什么要有这道闸门
 *
 * Windows 的 MSI 由 WiX 生成，而 **MSI 数据库的代码页是 1252**——
 * 装不下中文。Tauri 的 WiX 模板会把 `fileAssociations[].description`
 * 原样写进每个文件类型的 `<ProgId Description="…">`：
 *
 * ```
 * main.wxs(111) : error LGHT0311 : A string was provided with characters
 * that are not available in the specified database code page '1252'.
 * ```
 *
 * 七个扩展名就是七处报错，整个 Windows 打包 job 直接挂掉——
 * 而且挂的是**编译之后**的打包环节，要等七八分钟才看得到。
 *
 * Tauri 没有提供改 MSI 代码页的选项（`WixConfig` 里只有
 * `language` / `template` / `fragmentPaths` 这些），
 * 而 `bundle.shortDescription` / `longDescription` 是**全局**字段、
 * 不能按平台区分——所以唯一能做的就是：进 MSI 的字符串必须是 ASCII。
 *
 * `shortDescription` / `longDescription` 不在这条链路上
 * （WiX 模板里根本没有这两个占位符），它们只在 macOS 的
 * Info.plist 与 Linux 的 .desktop 里出现，那两处是 UTF-8，
 * 中文没问题——所以它们保持中文。
 *
 * ## 检查范围
 *
 * 只查**会进 MSI** 的字段：
 *   - `productName`、`identifier`
 *   - `bundle.copyright`、`bundle.publisher`、`bundle.homepage`
 *   - `bundle.fileAssociations[].name` / `.description`
 *   - `bundle.fileAssociations[].ext[]`
 *
 * 判据是「**能被 Windows-1252 编码**」，而不是「纯 ASCII」：
 * 1252 是 Latin-1 加上一批排版符号（© ® … — ' ' " "），
 * 这些字符装得下，不必为了保险把 `©` 也换掉。
 * 但中文、日文、韩文一律装不下——那才是真正会让打包挂掉的东西。
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const CONFIG = join(process.cwd(), "src-tauri", "tauri.conf.json");

interface FileAssociation {
  ext: string[];
  name?: string;
  description?: string;
}

interface BundleConfig {
  copyright?: string;
  publisher?: string;
  homepage?: string;
  fileAssociations?: FileAssociation[];
}

interface TauriConfig {
  productName?: string;
  identifier?: string;
  bundle?: BundleConfig;
}

/**
 * Windows-1252 能表示的全部字符。
 *
 * 用 TextDecoder 反查：把 0x00–0xFF 逐个当成一个字节解回来。
 * cp1252 里 0x81/0x8D/0x8F/0x90/0x9D 这几个字节**没有定义**，
 * 解出来是 U+FFFD（替换符），要把它们排除掉。
 */
const CP1252 = (() => {
  const decoder = new TextDecoder("windows-1252");
  const set = new Set<string>();
  for (let byte = 0; byte < 256; byte++) {
    const char = decoder.decode(new Uint8Array([byte]));
    if (char !== "�") set.add(char);
  }
  return set;
})();

/** 收集一条路径上的所有 cp1252 装不下的字符 */
function unencodable(text: string): string[] {
  const out: string[] = [];
  for (const char of text) {
    if (!CP1252.has(char)) out.push(char);
  }
  return out;
}

const raw = readFileSync(CONFIG, "utf8");
const config = JSON.parse(raw) as TauriConfig;

/** 待检查的条目：[路径, 值] */
const checks: [string, string][] = [];

if (config.productName) checks.push(["productName", config.productName]);
if (config.identifier) checks.push(["identifier", config.identifier]);

const bundle = config.bundle ?? {};
if (bundle.copyright) checks.push(["bundle.copyright", bundle.copyright]);
if (bundle.publisher) checks.push(["bundle.publisher", bundle.publisher]);
if (bundle.homepage) checks.push(["bundle.homepage", bundle.homepage]);

for (const [i, assoc] of (bundle.fileAssociations ?? []).entries()) {
  if (assoc.name) checks.push([`bundle.fileAssociations[${i}].name`, assoc.name]);
  if (assoc.description) {
    checks.push([`bundle.fileAssociations[${i}].description`, assoc.description]);
  }
  for (const [j, ext] of assoc.ext.entries()) {
    checks.push([`bundle.fileAssociations[${i}].ext[${j}]`, ext]);
  }
}

const problems: string[] = [];
for (const [path, value] of checks) {
  const bad = unencodable(value);
  if (bad.length > 0) {
    problems.push(
      `${path}: ${JSON.stringify(value)} —— 含 1252 装不下的字符 ${bad.join(" ")}`,
    );
  }
}

if (problems.length > 0) {
  console.error("打包元数据含 Windows-1252 装不下的字符，Windows 的 MSI 打包会失败：\n");
  for (const problem of problems) console.error(`  · ${problem}`);
  console.error("\n把这些字段改成英文即可。");
  process.exit(1);
}

console.log(`打包元数据编码检查通过（${checks.length} 项，均可被 Windows-1252 编码）。`);

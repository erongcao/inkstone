/**
 * 找出「模块作用域里的 t() 调用」。
 *
 * 为什么这件事必须查：`src/i18n/index.ts` 写着「模块常量**不要**在定义处翻译」——
 * 在定义处调 t() 会在**导入时定型**，语言改了也不跟着变。
 *
 * 实际踩过的例子（src/views/Sidebar.tsx）：
 *
 *   const PANELS = [{ id: "outline", label: t("大纲") }];   // ← 导入时就定死了
 *   ...
 *   {t(panel.label)}                                        // ← 再查一次，已经是英文了
 *
 * 结果：侧边栏三个页签在任何语言下都显示英文（第一次导入时是什么语言就定什么）。
 *
 * 用 TypeScript 的语法树判断「这个 t() 调用在不在函数里」，
 * 比正则可靠——正则分不清模块顶层的对象字面量和函数体里的对象字面量。
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const SRC = process.argv[2] ?? "src";

interface Problem {
  path: string;
  line: number;
  text: string;
}

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (full.endsWith(join("i18n", "locales"))) continue;
      out.push(...files(full));
    } else if (name.endsWith(".ts") || name.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

const problems: Problem[] = [];

for (const path of files(SRC)) {
  const source = readFileSync(path, "utf8");
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "t"
    ) {
      // 往上找：有没有祖先是「函数体」
      let insideFunction = false;
      let anc: ts.Node | undefined = node.parent;
      while (anc) {
        if (
          ts.isFunctionDeclaration(anc) ||
          ts.isFunctionExpression(anc) ||
          ts.isArrowFunction(anc) ||
          ts.isMethodDeclaration(anc) ||
          ts.isGetAccessor(anc) ||
          ts.isSetAccessor(anc)
        ) {
          insideFunction = true;
          break;
        }
        anc = anc.parent;
      }
      if (!insideFunction) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
        const text = node.getText(sf).replace(/\s+/g, " ").slice(0, 90);
        problems.push({ path, line: line + 1, text });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

if (problems.length === 0) {
  console.log("✅ 没有模块作用域的 t() 调用");
} else {
  console.log(`❌ 模块作用域里调了 t()（${problems.length} 处）：\n`);
  for (const p of problems) {
    console.log(`  ${p.path}:${p.line}`);
    console.log(`     ${p.text}`);
  }
  process.exitCode = 1;
}

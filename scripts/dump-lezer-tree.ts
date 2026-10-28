/**
 * 打印 lezer/markdown 的语法树，用于确定 Live Preview 装饰器要识别哪些节点。
 *
 * 运行：node --experimental-strip-types scripts/dump-lezer-tree.ts "样例文本"
 */

import { parser as baseParser, GFM } from "@lezer/markdown";

/**
 * 必须和编辑器用**同一个** parser 配置（见 src/editor/live-preview/syntax.ts）。
 *
 * 曾经这里用的是裸 parser，导致「lezer 不认 GFM 表格与任务列表」的错误结论，
 * 白写了一版行扫描实现。验证解析器认不认某个结构时，一定要用实际那份配置。
 */
const parser = baseParser.configure(GFM);
import type { SyntaxNode } from "@lezer/common";

const sample =
  process.argv[2] ??
  `# 标题

这是 **粗体**、*斜体*、\`行内代码\`、~~删除线~~、==高亮== 的文本。

链接：[显示文字](https://example.com "标题") 和 <https://auto.link>

图片：![替代文本](./img.png)

脚注引用[^fn1]

- 列表项 **带粗体**
- [ ] 任务项

> 引用

| A | B |
| --- | --- |
| 1 | 2 |

\`\`\`js
const x = 1;
\`\`\`
`;

const tree = parser.parse(sample);

function text(node: SyntaxNode): string {
  const raw = sample.slice(node.from, node.to);
  return raw.length > 44
    ? `${raw.slice(0, 44).replace(/\n/g, "\\n")}…`
    : raw.replace(/\n/g, "\\n");
}

console.log("\n=== lezer/markdown 语法树 ===\n");

const names = new Set<string>();

tree.iterate({
  enter(ref) {
    names.add(ref.type.name);
    const node = ref.node;
    console.log(
      `  ${"  ".repeat(node.parent ? depthOf(node) : 0)}${ref.type.name} [${ref.from}, ${ref.to}] ${JSON.stringify(text(node))}`,
    );
  },
});

function depthOf(node: SyntaxNode): number {
  let d = 0;
  let p = node.parent;
  while (p) {
    d++;
    p = p.parent;
  }
  return d;
}

console.log("\n=== 全部节点名 ===\n");
console.log([...names].sort().join(", "));
console.log("");

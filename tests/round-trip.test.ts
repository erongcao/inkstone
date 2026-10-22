import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isEquivalent, parseMarkdown, roundTrip } from "../src/parser/markdown";
import { countWords } from "../src/editor/stats";

/** 递归查找第一个满足条件的 mdast 节点 */
function findNode(
  node: unknown,
  predicate: (n: { type: string }) => boolean,
): { type: string } | undefined {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findNode(item, predicate);
      if (found) return found;
    }
    return undefined;
  }
  if (node !== null && typeof node === "object") {
    const obj = node as { type?: string; children?: unknown[] };
    if (typeof obj.type === "string" && predicate(obj)) return obj;
    if (obj.children) return findNode(obj.children, predicate);
  }
  return undefined;
}

const corpusDir = join(dirname(fileURLToPath(import.meta.url)), "corpus");
const corpusFiles = readdirSync(corpusDir)
  .filter((f) => f.endsWith(".md"))
  .sort();

describe("round-trip 语料库", () => {
  it("语料库非空", () => {
    expect(corpusFiles.length).toBeGreaterThan(0);
  });

  it("语料库规模不低于 10 份（防止被误删）", () => {
    expect(corpusFiles.length).toBeGreaterThanOrEqual(10);
  });

  it("语料覆盖关键节点类型", () => {
    // 把所有语料解析一遍，汇总出现过的节点类型
    const seen = new Set<string>();
    for (const file of corpusFiles) {
      const source = readFileSync(join(corpusDir, file), "utf8");
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) {
          node.forEach(walk);
          return;
        }
        if (node !== null && typeof node === "object") {
          const obj = node as { type?: string; children?: unknown[] };
          if (typeof obj.type === "string") seen.add(obj.type);
          if (obj.children) walk(obj.children);
        }
      };
      walk(parseMarkdown(source));
    }
    // 这些是 Live Preview 与渲染层依赖的关键类型，缺一个就说明语料有缺口
    for (const type of [
      "heading",
      "paragraph",
      "list",
      "listItem",
      "blockquote",
      "code",
      "inlineCode",
      "strong",
      "emphasis",
      "link",
      "image",
      "table",
      "tableRow",
      "tableCell",
      "thematicBreak",
      "html",
      "yaml",
      "math",
      "inlineMath",
      "footnoteDefinition",
      "footnoteReference",
      "delete",
    ]) {
      expect(seen.has(type), `语料里没有出现 ${type} 节点`).toBe(true);
    }
  });

  for (const file of corpusFiles) {
    describe(file, () => {
      const source = readFileSync(join(corpusDir, file), "utf8");

      it("解析 → 序列化 → 再解析，结构保持等价", () => {
        const first = parseMarkdown(source);
        const serialized = roundTrip(source);
        const second = parseMarkdown(serialized);

        // 关键断言：第二次解析的结构与第一次完全等价
        // 这保证了「用户写的内容在往返后语义不变」
        expect(isEquivalent(first, second)).toBe(true);
      });

      it("序列化结果仍是合法的 Markdown（能被再次解析）", () => {
        const serialized = roundTrip(source);
        expect(() => parseMarkdown(serialized)).not.toThrow();
        expect(serialized.length).toBeGreaterThan(0);
      });

      it("往返两次后收敛（幂等）", () => {
        const once = roundTrip(source);
        const twice = roundTrip(once);
        expect(twice).toBe(once);
      });
    });
  }
});

describe("解析器插件生效性", () => {
  const source = readFileSync(join(corpusDir, "02-tables-and-tasks.md"), "utf8");
  const tree = parseMarkdown(source);

  it("识别 GFM 表格", () => {
    expect(tree.children.some((n) => n.type === "table")).toBe(true);
  });

  it("识别任务列表", () => {
    // 任务列表项嵌套在 list 节点内，需要递归查找
    const found = findNode(tree, (n) => n.type === "listItem" && "checked" in n);
    expect(found).toBeDefined();
  });

  it("识别 YAML front matter", () => {
    const withFm = parseMarkdown(
      readFileSync(join(corpusDir, "03-math-and-diagrams.md"), "utf8"),
    );
    expect(withFm.children[0].type).toBe("yaml");
  });

  it("识别数学节点", () => {
    const withMath = parseMarkdown(
      readFileSync(join(corpusDir, "03-math-and-diagrams.md"), "utf8"),
    );
    const json = JSON.stringify(withMath);
    expect(json).toContain('"math"');
    expect(json).toContain('"inlineMath"');
  });

  it("识别脚注定义与引用", () => {
    const withFootnotes = parseMarkdown(
      readFileSync(join(corpusDir, "04-footnotes-html-images.md"), "utf8"),
    );
    const json = JSON.stringify(withFootnotes);
    expect(json).toContain('"footnoteDefinition"');
    expect(json).toContain('"footnoteReference"');
  });
});

describe("字数统计", () => {
  it("中英文混合按约定计数", () => {
    // 「你好世界」4 个汉字逐字计数 + 「hello world」2 个英文词 = 6
    expect(countWords("你好世界 hello world").words).toBe(6);
  });

  it("空文本计数为零", () => {
    expect(countWords("")).toEqual({ chars: 0, words: 0 });
  });

  it("标点不计入词数", () => {
    // 「你好，世界」4 个汉字，全角标点不计入
    expect(countWords("你好，世界！").words).toBe(4);
  });

  it("字符数包含标点", () => {
    // 「你好，世界！」共 6 个字符（4 汉字 + 2 全角标点）
    expect(countWords("你好，世界！").chars).toBe(6);
  });
});

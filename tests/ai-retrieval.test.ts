/**
 * 检索层（切块 / 分词 / BM25）的护栏测试。
 *
 * 这里断言的是**运行时事实**：切出来的块、算出来的分词、排序后的命中。
 * 不扫源码——源码扫描只能证明「代码里写了这句话」，
 * 证明不了「切出来的偏移真的能选中原文那一段」。
 *
 * 特别要守住的一条：**标题边界必须来自 mdast**。
 * 「代码围栏里的 `#` 不是标题」「引用块里的 `#` 不是章节」
 * 这两条如果哪天退化成扫行找 `#`，检索就会把代码注释当成章节切一刀。
 */

import { describe, expect, it, beforeAll } from "vitest";
import { ensureMarkdownParser } from "@/parser/markdown-loader";
import { bm25Search, splitDocumentChunks, tokenize } from "@/ai/retrieval";
import type { DocumentChunk, SearchHit } from "@/ai/retrieval";

beforeAll(async () => {
  // remark 管线是懒加载的，没就绪时切块会返回空数组
  await ensureMarkdownParser();
});

const DOC = [
  "# 第一章 总览",
  "",
  "这一章介绍项目的背景与目标，包含设计动机、范围界定以及后续章节的安排。",
  "",
  "## 1.1 背景",
  "",
  "背景部分说明问题从何而来，以及为什么现在要做这件事。",
  "",
  "## 1.2 目标",
  "",
  "目标部分列出三条具体目标，每条都给出可验证的判据。",
  "",
].join("\n");

/** 手工造一个块（BM25 测试不需要真的切文档） */
function chunk(id: string, text: string): DocumentChunk {
  return {
    id,
    title: "",
    headingPath: [],
    text,
    searchText: text,
    from: 0,
    to: text.length,
  };
}

describe("切块：标题边界", () => {
  it("按 ATX 标题切块，标题路径逐级累积", () => {
    const chunks = splitDocumentChunks(DOC, { minChars: 0 });
    expect(chunks).toHaveLength(3);
    expect(chunks[0].headingPath).toEqual(["第一章 总览"]);
    expect(chunks[1].headingPath).toEqual(["第一章 总览", "1.1 背景"]);
    expect(chunks[2].headingPath).toEqual(["第一章 总览", "1.2 目标"]);
    expect(chunks[1].title).toBe("1.1 背景");
  });

  it("偏移精确：切片就是原文的那一段", () => {
    const chunks = splitDocumentChunks(DOC, { minChars: 0 });

    // 首块覆盖标题区域（标题行不算进正文，但区域里要有）
    expect(chunks[0].from).toBe(0);
    expect(DOC.slice(chunks[0].from, chunks[0].to)).toBe(
      "# 第一章 总览\n\n这一章介绍项目的背景与目标，包含设计动机、范围界定以及后续章节的安排。",
    );
    expect(chunks[0].text).toBe(
      "这一章介绍项目的背景与目标，包含设计动机、范围界定以及后续章节的安排。",
    );

    // 第二块从二级标题开始
    expect(chunks[1].from).toBe(DOC.indexOf("## 1.1 背景"));
    expect(DOC.slice(chunks[1].from, chunks[1].to)).toBe(
      "## 1.1 背景\n\n背景部分说明问题从何而来，以及为什么现在要做这件事。",
    );

    // 第三块到文末
    expect(chunks[2].from).toBe(DOC.indexOf("## 1.2 目标"));
    expect(DOC.slice(chunks[2].from, chunks[2].to)).toBe(
      "## 1.2 目标\n\n目标部分列出三条具体目标，每条都给出可验证的判据。",
    );
  });

  it("第一个标题之前的内容单独成一块，路径为空", () => {
    const src = "开头的导语，没有标题。\n\n# 标题\n\n正文内容。";
    const chunks = splitDocumentChunks(src, { minChars: 0 });
    expect(chunks).toHaveLength(2);
    expect(chunks[0].headingPath).toEqual([]);
    expect(chunks[0].title).toBe("");
    expect(chunks[0].text).toBe("开头的导语，没有标题。");
    expect(chunks[0].from).toBe(0);
    expect(src.slice(chunks[0].from, chunks[0].to)).toBe("开头的导语，没有标题。");
  });

  it("代码围栏里的 # 不是标题，不切块", () => {
    const src = "# 真标题\n\n```sh\n# 这是注释\n```\n\n正文。";
    const chunks = splitDocumentChunks(src, { minChars: 0 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].headingPath).toEqual(["真标题"]);
    expect(chunks[0].text).toContain("# 这是注释");
  });

  it("引用块里的标题不算文档章节", () => {
    const src = "> # 引用里的标题\n\n正文。";
    const chunks = splitDocumentChunks(src, { minChars: 0 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].headingPath).toEqual([]);
  });

  it("列表项里的标题不算文档章节（只看顶层标题）", () => {
    // 这一行确实以 `#` 开头，扫行找 `#` 会把它当成章节——
    // 但它在 mdast 里是 listItem 的子节点，不是文档章节
    const src = "- 项目\n  # 列表里的标题\n\n正文。";
    const chunks = splitDocumentChunks(src, { minChars: 0 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].headingPath).toEqual([]);
    expect(chunks[0].text).toContain("# 列表里的标题");
  });

  it("Setext 标题（=== / ---）不切块——规格只认 ATX", () => {
    const src = "标题一\n===\n\n正文一。\n\n标题二\n---\n\n正文二。";
    const chunks = splitDocumentChunks(src, { minChars: 0 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].headingPath).toEqual([]);
  });

  it("空文档返回空数组", () => {
    expect(splitDocumentChunks("")).toEqual([]);
    expect(splitDocumentChunks("   \n  ")).toEqual([]);
  });

  it("每块都有稳定 id", () => {
    const chunks = splitDocumentChunks(DOC, { minChars: 0 });
    expect(chunks.map((c) => c.id)).toEqual(["chunk-1", "chunk-2", "chunk-3"]);
  });
});

describe("切块：长度门槛", () => {
  it("跨节的短块**不**并进前一块——溯源要精确到节", () => {
    const src = `# 长块\n\n${"长".repeat(300)}\n\n# 短块\n\n短。`;
    const chunks = splitDocumentChunks(src, { minChars: 200, maxChars: 2000 });

    // 两节各成一块：短节虽然不足门槛，也不能吞掉前一节的标题路径
    expect(chunks).toHaveLength(2);
    expect(chunks[0].headingPath).toEqual(["长块"]);
    expect(chunks[1].headingPath).toEqual(["短块"]);
    expect(chunks[1].text).toBe("短。");
    // 区域仍落在原文对应的那一段
    expect(src.slice(chunks[1].from, chunks[1].to)).toBe("# 短块\n\n短。");
  });

  it("同一节里被切碎的尾巴并回前一块", () => {
    // 同一节，两段：第一段 10 字、第二段 300 字。
    // maxChars=200 把它们切成两块，minChars=200 又把短的那块并回来
    const src = `# 甲\n\n${"甲".repeat(10)}\n\n${"乙".repeat(300)}`;
    const chunks = splitDocumentChunks(src, { minChars: 200, maxChars: 200 });

    expect(chunks).toHaveLength(1);
    expect(chunks[0].from).toBe(0);
    expect(chunks[0].text).toBe(`${"甲".repeat(10)}\n\n${"乙".repeat(300)}`);
    expect(chunks[0].headingPath).toEqual(["甲"]);
  });

  it("同一节里第一块太短时与后一块合并", () => {
    // 第一节之前有一段没标题的导言（很短），后面是「长块」这一节
    const src = `短。\n\n# 长块\n\n${"长".repeat(300)}`;
    const chunks = splitDocumentChunks(src, { minChars: 200, maxChars: 2000 });

    // 导言与「长块」是**两节**，不再合并——溯源要能指到具体那一节
    expect(chunks).toHaveLength(2);
    expect(chunks[0].headingPath).toEqual([]);
    expect(chunks[0].text).toBe("短。");
    expect(chunks[1].headingPath).toEqual(["长块"]);
  });

  it("超长块在段落边界切开，不切开段落内部", () => {
    const p1 = "甲".repeat(600);
    const p2 = "乙".repeat(600);
    const src = `# 标题\n\n${p1}\n\n${p2}`;
    const chunks = splitDocumentChunks(src, { minChars: 0, maxChars: 800 });

    expect(chunks).toHaveLength(2);
    expect(chunks[0].text).toBe(p1);
    expect(chunks[1].text).toBe(p2);
    // 首块覆盖标题区域
    expect(chunks[0].from).toBe(0);
    expect(src.slice(chunks[0].from, chunks[0].to)).toBe(`# 标题\n\n${p1}`);
    // 第二块从段落起点开始
    expect(chunks[1].from).toBe(src.indexOf(p2));
    expect(src.slice(chunks[1].from, chunks[1].to)).toBe(p2);
    // 两块同属一节，标题路径一致
    expect(chunks[1].headingPath).toEqual(["标题"]);
  });

  it("长度刚好等于门槛时不合并（门槛是「短于」才合并）", () => {
    const src = `# 甲\n\n${"甲".repeat(10)}\n\n${"乙".repeat(300)}`;
    // 门槛 10：第一块（正好 10 字）不算短 → 两块
    expect(splitDocumentChunks(src, { minChars: 10, maxChars: 200 })).toHaveLength(2);
    // 门槛 11：第一块太短 → 并回后一块 → 一块
    expect(splitDocumentChunks(src, { minChars: 11, maxChars: 200 })).toHaveLength(1);
  });

  it("只有标题、正文为空的那一节也成块（这一节在文档里确实存在）", () => {
    const src = "# 空节\n\n# 有内容\n\n正文。";
    const chunks = splitDocumentChunks(src, { minChars: 200 });
    expect(chunks).toHaveLength(2);
    expect(chunks[0].headingPath).toEqual(["空节"]);
    expect(chunks[0].text).toBe("");
    // 标题照样进索引——不然这一节永远检索不到
    expect(chunks[0].searchText).toContain("空节");
  });
});

describe("切块：标题进检索索引", () => {
  it("正文不重复标题词时，靠标题也能检索到那一节", () => {
    // 「# 安装」这一节的正文里一个「安装」都没有——
    // 只索引正文的话，搜「安装怎么操作」会一个词都对不上（假阴性）
    const src = "# 安装\n\n打开终端，输入下面的命令。\n\n# 卸载\n\n在设置里点卸载即可。";
    const chunks = splitDocumentChunks(src);

    const hits = bm25Search("安装怎么操作", chunks);
    expect(hits).toHaveLength(1);
    expect(hits[0].chunk.headingPath).toEqual(["安装"]);
    // 检索文本里有标题，正文里没有——这正是要守住的那条
    expect(hits[0].chunk.searchText).toContain("安装");
    expect(hits[0].chunk.text).not.toContain("安装");
  });

  it("标题路径逐级进索引（祖先标题也是可检索的词）", () => {
    const src = "# 第一章\n\n## 安装\n\n打开终端。";
    const chunks = splitDocumentChunks(src);
    const install = chunks.find((c) => c.headingPath.includes("安装"));
    expect(install).toBeDefined();
    // 这一块的祖先标题与自己的标题都进索引
    expect(install!.searchText).toContain("第一章");
    expect(install!.searchText).toContain("安装");
  });
});

describe("分词", () => {
  it("中文按字符 bigram 切", () => {
    expect(tokenize("实现功能")).toEqual(["实现", "现功", "功能"]);
  });

  it("英文转小写并按非字母数字切", () => {
    expect(tokenize("Hello, snake_case World!")).toEqual([
      "hello",
      "snake",
      "case",
      "world",
    ]);
  });

  it("过滤停用词", () => {
    expect(tokenize("the quick fox")).toEqual(["quick", "fox"]);
    // 单字与常见双字词都在停用词表里
    expect(tokenize("我")).toEqual([]);
    expect(tokenize("我们")).toEqual([]);
    // bigram 里含停用字的二元组仍会保留——这是 bigram 的固有代价
    expect(tokenize("我们的方案")).toEqual(["们的", "的方", "方案"]);
  });

  it("空文本得到空列表", () => {
    expect(tokenize("")).toEqual([]);
  });
});

describe("BM25 检索", () => {
  const CHUNKS = [
    chunk("c1", "苹果是一种常见的水果，口感脆甜。"),
    chunk("c2", "编译器的词法分析阶段负责把字符流切成记号。"),
    chunk("c3", "今天的会议改到下午三点，会议室在三楼。"),
  ];

  it("命中的块排第一，没命中的块不出现在结果里", () => {
    const hits = bm25Search("词法分析", CHUNKS);
    expect(hits).toHaveLength(1);
    expect(hits[0].chunk.id).toBe("c2");
    expect(hits[0].score).toBeGreaterThan(0);
  });

  it("同样输入跑两次结果一致（确定性）", () => {
    const a = bm25Search("编译 词法", CHUNKS);
    const b = bm25Search("编译 词法", CHUNKS);
    expect(a.map((h) => h.chunk.id)).toEqual(b.map((h) => h.chunk.id));
    expect(a.map((h) => h.score)).toEqual(b.map((h) => h.score));
    expect(a).toEqual(b);
  });

  it("同分按块在数组里的先后排序", () => {
    const same = [chunk("c1", "同样的内容在这里"), chunk("c2", "同样的内容在这里")];
    const hits = bm25Search("同样", same, { topK: 2 });
    expect(hits.map((h) => h.chunk.id)).toEqual(["c1", "c2"]);
    expect(hits[0].score).toBe(hits[1].score);
  });

  it("最多返回 topK 条", () => {
    const many = [chunk("c1", "苹果"), chunk("c2", "苹果"), chunk("c3", "苹果")];
    expect(bm25Search("苹果", many, { topK: 2 })).toHaveLength(2);
    expect(bm25Search("苹果", many)).toHaveLength(3);
  });

  it("查询里没有有效词时不返回任何命中", () => {
    expect(bm25Search("的", CHUNKS)).toEqual([]);
    expect(bm25Search("", CHUNKS)).toEqual([]);
  });

  it("返回的命中带着原来的块对象", () => {
    const hits: SearchHit[] = bm25Search("苹果", CHUNKS);
    expect(hits[0].chunk).toBe(CHUNKS[0]);
  });

  it("分数符合 BM25 公式（默认 k1=1.5 / b=0.75）", () => {
    const chunks = [chunk("c1", "苹果 苹果"), chunk("c2", "香蕉")];
    const hits = bm25Search("苹果", chunks);
    expect(hits).toHaveLength(1);

    // 手算一遍：
    //   N = 2，df = 1，avgdl = (2 + 1) / 2 = 1.5
    //   IDF = ln(1 + (2 - 1 + 0.5) / (1 + 0.5)) = ln 2
    //   norm = 1 - 0.75 + 0.75 * (2 / 1.5) = 1.25
    //   score = IDF * (2 * 2.5) / (2 + 1.5 * 1.25)
    const idf = Math.log(1 + (2 - 1 + 0.5) / (1 + 0.5));
    const norm = 1 - 0.75 + 0.75 * (2 / 1.5);
    const expected = (idf * (2 * (1.5 + 1))) / (2 + 1.5 * norm);
    expect(hits[0].score).toBeCloseTo(expected, 12);
    // 再钉一个具体数值：k1 / b 被改动就会露馅
    expect(hits[0].score).toBeCloseTo(Math.log(2) * (5 / 3.875), 12);
  });
});

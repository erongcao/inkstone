/**
 * 问答模式（请求构造 + 引用解析）的护栏测试。
 *
 * 引用溯源是这个功能的核心承诺：模型说「答案是 X，出自 [1]」，
 * 用户点 [1] 就得跳到**那一段**原文。所以这里守住三条：
 *   1. 请求里的来源编号与检索命中一一对应
 *   2. 引用序号能正确映射回命中（含越界）
 *   3. 代码块里的 `[1]` 是字面量，不是引用
 */

import { describe, expect, it, beforeAll } from "vitest";
import { buildQaRequest, parseCitations } from "@/ai/qa";
import { bm25Search, splitDocumentChunks, type SearchHit } from "@/ai/retrieval";
import { ensureMarkdownParser } from "@/parser/markdown-loader";

beforeAll(async () => {
  // remark 管线是懒加载的，没就绪时切块会返回空数组
  await ensureMarkdownParser();
});

const HITS: SearchHit[] = [
  {
    chunk: {
      id: "chunk-1",
      title: "1.1 节",
      headingPath: ["第一章", "1.1 节"],
      text: "第一段正文。",
      searchText: "第一章 1.1 节 第一段正文。",
      from: 0,
      to: 6,
    },
    score: 3.2,
  },
  {
    chunk: {
      id: "chunk-2",
      title: "第二章",
      headingPath: ["第二章"],
      text: "第二段正文。",
      searchText: "第二章 第二段正文。",
      from: 20,
      to: 26,
    },
    score: 1.1,
  },
];

describe("问答请求", () => {
  it("system 原样透传", () => {
    const req = buildQaRequest("这里讲了什么", HITS, "你是写作助手");
    expect(req.system).toBe("你是写作助手");
  });

  it("恰好一条 user 消息", () => {
    const req = buildQaRequest("问题", HITS, "s");
    expect(req.messages).toHaveLength(1);
    expect(req.messages[0].role).toBe("user");
  });

  it("user 消息里有问题与编号来源", () => {
    const content = buildQaRequest("这里讲了什么", HITS, "s").messages[0].content;
    expect(content).toContain("这里讲了什么");
    expect(content).toContain("[1] 标题路径：第一章 > 1.1 节");
    expect(content).toContain("第一段正文。");
    expect(content).toContain("[2] 标题路径：第二章");
    expect(content).toContain("第二段正文。");
  });

  it("指令要求用 [n] 标注来源，并规定答不出时的说法", () => {
    const content = buildQaRequest("问题", HITS, "s").messages[0].content;
    expect(content).toContain("[n]");
    expect(content).toContain("根据文档无法回答");
  });

  it("不设 maxTokens / temperature（由调用方按能力位补）", () => {
    const req = buildQaRequest("问题", HITS, "s");
    expect(req.maxTokens).toBeUndefined();
    expect(req.temperature).toBeUndefined();
  });

  it("没有命中时也给出「没有来源」的提示", () => {
    const content = buildQaRequest("问题", [], "s").messages[0].content;
    expect(content).toContain("没有检索到任何来源");
  });
});

describe("引用解析", () => {
  it("解析 [1] 并映射回命中", () => {
    const got = parseCitations("结论来自 [1]。", HITS);
    expect(got).toHaveLength(1);
    expect(got[0].index).toBe(1);
    expect(got[0].hit).toBe(HITS[0]);
  });

  it("解析 [1,2] 与 [1, 2]", () => {
    expect(parseCitations("见 [1,2]", HITS).map((c) => c.index)).toEqual([1, 2]);
    expect(parseCitations("见 [1, 2]", HITS).map((c) => c.index)).toEqual([1, 2]);
  });

  it("解析区间 [1-3]", () => {
    const got = parseCitations("见 [1-3]", HITS);
    expect(got.map((c) => c.index)).toEqual([1, 2, 3]);
    expect(got[0].hit).toBe(HITS[0]);
    expect(got[1].hit).toBe(HITS[1]);
    // 第 3 条越界
    expect(got[2].hit).toBeUndefined();
  });

  it("去重并按序号升序", () => {
    expect(parseCitations("先 [2] 后 [1] 又 [2]", HITS).map((c) => c.index)).toEqual([
      1, 2,
    ]);
  });

  it("越界的序号仍然返回，但 hit 是 undefined", () => {
    const got = parseCitations("见 [5]", HITS);
    expect(got).toHaveLength(1);
    expect(got[0].index).toBe(5);
    expect(got[0].hit).toBeUndefined();
  });

  it("[0] 非法，整个忽略", () => {
    expect(parseCitations("见 [0]", HITS)).toEqual([]);
    expect(parseCitations("见 [0] 与 [1]", HITS).map((c) => c.index)).toEqual([1]);
  });

  it("代码围栏里的标记不解析", () => {
    const text = "答案来自 [1]。\n\n```python\nprint(arr[1])\n```\n\n还有 [2]。";
    expect(parseCitations(text, HITS).map((c) => c.index)).toEqual([1, 2]);
  });

  it("整段都在代码围栏里时一个都不解析", () => {
    expect(parseCitations("```\n[1]\n[2]\n```", HITS)).toEqual([]);
  });

  it("Markdown 链接 [1](url) 不算引用", () => {
    expect(parseCitations("见 [1](https://example.com)", HITS)).toEqual([]);
  });

  it("没有引用时返回空数组", () => {
    expect(parseCitations("模型只是随口一说。", HITS)).toEqual([]);
    expect(parseCitations("", HITS)).toEqual([]);
  });
});

describe("端到端：切块 → 检索 → 请求 → 引用", () => {
  const DOC = [
    "# 部署手册",
    "",
    "生产环境部署前需要先申请域名证书，证书有效期是一年。",
    "",
    "## 常见问题",
    "",
    "问：部署失败怎么办？答：先看容器日志，再检查端口占用。",
    "",
  ].join("\n");

  it("检索命中 → 编号来源 → 引用能映射回同一个块", () => {
    const chunks = splitDocumentChunks(DOC, { minChars: 0 });
    const hits = bm25Search("证书有效期", chunks, { topK: 2 });
    expect(hits.length).toBeGreaterThan(0);

    const req = buildQaRequest("证书有效期多久", hits, "你是助手");
    const content = req.messages[0].content;
    expect(content).toContain("证书有效期多久");
    expect(content).toContain("[1] 标题路径：部署手册");

    // 模型回答里的 [1] 必须指回请求里的第 1 个来源
    const citations = parseCitations("证书有效期是一年 [1]。", hits);
    expect(citations).toHaveLength(1);
    expect(citations[0].index).toBe(1);
    expect(citations[0].hit).toBe(hits[0]);
    expect(citations[0].hit?.chunk.text).toContain("证书有效期");
  });

  it("来源编号与检索命中的顺序一致（[2] 指第二个命中）", () => {
    const chunks = splitDocumentChunks(DOC, { minChars: 0 });
    const hits = bm25Search("部署失败 端口 容器日志", chunks, { topK: 2 });
    const citations = parseCitations("见 [2]", hits);
    expect(citations[0].index).toBe(2);
    expect(citations[0].hit).toBe(hits[1]);
  });
});

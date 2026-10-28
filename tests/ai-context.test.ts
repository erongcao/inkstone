/**
 * AI 上下文切片与动作构造的护栏测试。
 *
 * 这里验证的是两条契约：
 *   1. 切片边界来自 **mdast**（不是 lezer），所以和语义层一致
 *   2. 模型返回值的清洗只剥「包裹形式」，不动正文内容
 */

import { describe, expect, it, beforeAll } from "vitest";
import { ensureMarkdownParser } from "@/parser/markdown-loader";
import { sliceContext, resolveContext, type ContextSlice } from "@/ai/context";
import {
  buildRewriteRequest,
  buildSummarizeRequest,
  cleanModelOutput,
  REWRITE_LABELS,
  SUMMARIZE_LABELS,
} from "@/ai/actions";

beforeAll(async () => {
  await ensureMarkdownParser();
});

const DOC = [
  "# 一级标题",
  "",
  "这是引言段落。",
  "",
  "## 小节甲",
  "",
  "小节甲的第一段，内容足够长以便通过最小长度门槛判断逻辑是否生效。",
  "",
  "### 更深一层",
  "",
  "更深一层里的内容。",
  "",
  "## 小节乙",
  "",
  "小节乙的内容。",
  "",
  "# 第二个一级标题",
  "",
  "结尾段落。",
].join("\n");

function slice(
  source: string,
  cursor: number,
  kind: Parameters<typeof sliceContext>[0]["kind"],
) {
  return sliceContext({ source, cursor, kind });
}

describe("切片：选区", () => {
  it("有选区时按选区切", () => {
    const source = "第一段\n\n第二段里有 $x$ 和别的内容。";
    const from = source.indexOf("$x$");
    const got = sliceContext({
      source,
      cursor: from,
      selection: { from, to: from + 3 },
      kind: "selection",
    });
    expect(got?.text).toBe("$x$");
  });

  it("选区全是空白时返回 null", () => {
    expect(
      sliceContext({
        source: "abc   def",
        cursor: 3,
        selection: { from: 3, to: 6 },
        kind: "selection",
      }),
    ).toBeNull();
  });

  it("没有选区却要求选区级切片 → null", () => {
    expect(sliceContext({ source: "abc", cursor: 0, kind: "selection" })).toBeNull();
  });
});

describe("切片：段落", () => {
  it("切出光标所在的顶层块", () => {
    const at = DOC.indexOf("这是引言段落");
    const got = slice(DOC, at, "paragraph");
    expect(got?.text).toBe("这是引言段落。");
  });

  it("光标在标题上时带出标题文本", () => {
    const at = DOC.indexOf("# 一级标题");
    const got = slice(DOC, at, "paragraph");
    expect(got?.title).toBe("# 一级标题");
  });

  it("列表项整体作为一块，不切出里面的段落", () => {
    const source = "- 第一项很长很长很长很长很长很长很长很长很长很长很长很长\n- 第二项";
    const got = slice(source, source.indexOf("第一项"), "paragraph");
    expect(got?.text).toBe(source.trim());
  });
});

describe("切片：章节", () => {
  it("从最近的前置标题切到下一个同级或更高级标题", () => {
    const at = DOC.indexOf("小节甲的第一段");
    const got = slice(DOC, at, "section");
    expect(got?.text).toContain("小节甲的第一段");
    expect(got?.text).toContain("更深一层里的内容");
    // 不能越界到同级的小节乙
    expect(got?.text).not.toContain("小节乙");
    // 更不能越界到下一个一级标题
    expect(got?.text).not.toContain("结尾段落");
  });

  it("光标在 ### 下时，章节取最内层（最近的前置标题）", () => {
    // 起点取**最近的前置标题**（你在哪一节就给哪一节），
    // 终点取下一个「深度 <= 起点」的标题——
    // 只看同级的话 ## 小节甲 的内容会被 ### 更深一层 截断。
    const at = DOC.indexOf("更深一层里的内容");
    const got = slice(DOC, at, "section");
    expect(got?.text).toBe("### 更深一层\n\n更深一层里的内容。");
    expect(got?.title).toBe("### 更深一层");
  });

  it("文档开头之前没有标题时，从文档开头切起", () => {
    const source = "开头的段落，没有标题。\n\n第二段。";
    const got = slice(source, 0, "section");
    expect(got?.text).toBe(source);
  });
});

describe("切片：文档", () => {
  it("返回全文", () => {
    const got = slice(DOC, 0, "document");
    expect(got?.text).toBe(DOC.trim());
  });

  it("空文档返回 null", () => {
    expect(sliceContext({ source: "   \n  ", cursor: 0, kind: "document" })).toBeNull();
  });
});

describe("上下文降级", () => {
  it("段落够长就用段落，不浪费上下文", () => {
    const at = DOC.indexOf("小节甲的第一段");
    // 显式给一个比段落短的门槛，才能验证「够长」这条分支
    const got = resolveContext({ source: DOC, cursor: at, kind: "paragraph" }, 10);
    expect(got?.kind).toBe("paragraph");
    expect(got?.text).toBe(
      "小节甲的第一段，内容足够长以便通过最小长度门槛判断逻辑是否生效。",
    );
  });

  it("段落太短就自动扩到章节（避免拿一句话去改写）", () => {
    const at = DOC.indexOf("这是引言段落");
    const got = resolveContext({ source: DOC, cursor: at, kind: "paragraph" });
    expect(got?.kind).toBe("section");
    expect(got?.text).toContain("这是引言段落。");
    expect(got?.text).toContain("更深一层里的内容");
  });

  it("有选区时优先用选区", () => {
    const source = "很短的一段话。";
    const got = resolveContext({
      source,
      cursor: 1,
      // 「很短」是前两个字符（中文按字符计，不是按字节）
      selection: { from: 0, to: 2 },
      kind: "paragraph",
    });
    expect(got?.kind).toBe("selection");
    expect(got?.text).toBe("很短");
  });
});

describe("动作构造", () => {
  const ctx: ContextSlice = {
    kind: "paragraph",
    from: 0,
    to: 5,
    text: "原始文字",
    title: "章节甲",
  };

  it("改写请求带上 system 与章节标题", () => {
    const req = buildRewriteRequest("polish", ctx, "你是写作助手");
    expect(req.system).toBe("你是写作助手");
    expect(req.messages).toHaveLength(1);
    const content = req.messages[0].content;
    expect(content).toContain("章节甲");
    expect(content).toContain("原始文字");
    expect(content).toContain("润色");
  });

  it("总结请求用各自的指令", () => {
    const oneLine = buildSummarizeRequest("one-line", ctx, "s");
    const outline = buildSummarizeRequest("outline", ctx, "s");
    expect(oneLine.messages[0].content).toContain("一句话");
    expect(outline.messages[0].content).toContain("大纲");
    expect(oneLine.messages[0].content).not.toBe(outline.messages[0].content);
  });

  it("五种改写与四种总结都有中文标签", () => {
    expect(Object.keys(REWRITE_LABELS)).toHaveLength(5);
    expect(Object.keys(SUMMARIZE_LABELS)).toHaveLength(4);
    for (const label of [
      ...Object.values(REWRITE_LABELS),
      ...Object.values(SUMMARIZE_LABELS),
    ]) {
      expect(label).toMatch(/[一-龥]/);
    }
  });
});

describe("模型返回值清洗", () => {
  it("剥掉整体的 markdown 代码块包裹", () => {
    expect(cleanModelOutput("```markdown\n**粗体**\n```")).toBe("**粗体**");
    expect(cleanModelOutput("```\n普通内容\n```")).toBe("普通内容");
  });

  it("剥掉客套前缀", () => {
    expect(cleanModelOutput("以下是改写后的内容：\n\n改好的正文")).toBe("改好的正文");
    expect(cleanModelOutput("好的，这是润色后的版本：改好的正文")).toBe("改好的正文");
  });

  it("**不**动正文里合法的代码块", () => {
    // 一刀切会把用户笔记里的代码示例弄坏
    const raw = "说明文字\n\n```js\nconst a = 1;\n```\n\n结尾";
    expect(cleanModelOutput(raw)).toBe(raw);
  });

  it("不做无依据的改写：原文没变就原样返回", () => {
    const raw = "这段话本来就干净，不需要任何处理。";
    expect(cleanModelOutput(raw)).toBe(raw);
  });

  it("保留正文里的冒号", () => {
    const raw = "时间：下午三点\n地点：会议室";
    expect(cleanModelOutput(raw)).toBe(raw);
  });
});

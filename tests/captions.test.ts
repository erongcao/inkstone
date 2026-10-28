/**
 * 题注（图题 / 表注）与自动编号。
 *
 * 三个层次，缺一不可：
 *
 * 1. **语义层规则**（mdast）：什么算题注、编号怎么算。
 * 2. **对拍**：编辑层（lezer）那版必须与语义层给出**同一个结论**。
 *    两版的位置来源不同（lezer 的树 vs remark 的树），
 *    「谁挨着谁」只能各看各的——所以必须钉死。
 * 3. **产物**：导出的 HTML 里有编号、源文里没有。
 *    判据落在产物上，而不是「代码里调用过某个函数」。
 *
 * 另有一条例外规则要守住：**编号只出现在渲染结果里**，
 * 用户的 .md 文件一个字节都不改（架构红线 1）。
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseMarkdown } from "@/parser/markdown";
import {
  applyCaptions,
  applyCaptionsToSource,
  collectCaptions,
  type CaptionOptions,
} from "@/parser/captions";
import { findCaptions } from "@/editor/render/captions";
import { parseSyntax } from "@/editor/live-preview/syntax";
import { buildLivePreviewDecorations } from "@/editor/live-preview/decorations";
import { markdownToHtml } from "@/parser/html";

const CHAPTER: CaptionOptions = { numbering: "chapter" };
const CONTINUOUS: CaptionOptions = { numbering: "continuous" };

/** 一条题注的可比较形状（不看 label 的大小写规范化） */
interface Shape {
  kind: string;
  label: string;
  number: string;
  markerFrom: number;
  markerTo: number;
  targetFrom: number;
}

/** 把题注摊平成可断言的形状 */
function shape(list: ReturnType<typeof collectCaptions>): Shape[] {
  return list.map((c) => ({
    kind: c.kind,
    label: c.label,
    number: c.number,
    markerFrom: c.markerFrom,
    markerTo: c.markerTo,
    targetFrom: c.targetFrom,
  }));
}

/** 语义层（mdast）算出来的题注 */
function semantic(source: string, options: CaptionOptions = CHAPTER) {
  return shape(collectCaptions(parseMarkdown(source), source, options));
}

/** 编辑层（lezer）算出来的题注 */
function editorial(source: string, options: CaptionOptions = CHAPTER) {
  return shape(findCaptions(parseSyntax(source), source, options));
}

/* ── 语义层规则 ── */

describe("什么算题注", () => {
  it("图片后面紧跟的「图：」段落是图题", () => {
    const source = "![架构图](arch.png)\n\n图：系统总体架构\n";
    expect(semantic(source)).toEqual([
      {
        kind: "figure",
        label: "图",
        number: "1",
        markerFrom: 18,
        markerTo: 20,
        targetFrom: 0,
      },
    ]);
  });

  it("表格前面紧跟的「表：」段落是表题", () => {
    const source =
      "表：用户角色一览\n\n| 角色 | 权限 |\n| --- | --- |\n| 管理员 | 全部 |\n";
    expect(semantic(source)).toEqual([
      {
        kind: "table",
        label: "表",
        number: "1",
        markerFrom: 0,
        markerTo: 2,
        targetFrom: 10,
      },
    ]);
  });

  it("表格后面紧跟的「表：」段落也是表题", () => {
    const source = "| A | B |\n| --- | --- |\n| 1 | 2 |\n\n表：数据\n";
    const captions = semantic(source);
    expect(captions).toHaveLength(1);
    expect(captions[0].kind).toBe("table");
  });

  it("不挨着图片或表格的段落不是题注", () => {
    expect(semantic("图：这不是题注\n")).toEqual([]);
    expect(semantic("图：也不是\n\n普通段落\n")).toEqual([]);
  });

  it("「图」只能配图片，「表」只能配表格", () => {
    // 图题挨着表格 → 不成立
    expect(semantic("| A | B |\n| --- | --- |\n| 1 | 2 |\n\n图：不是图题\n")).toEqual([]);
    // 表题挨着图片 → 不成立
    expect(semantic("![a](a.png)\n\n表：不是表题\n")).toEqual([]);
  });

  it("标签不在表里的不算题注（「图形：说明」是普通句子）", () => {
    expect(semantic("![a](a.png)\n\n图形：说明\n")).toEqual([]);
  });

  it("全角冒号与半角冒号都认", () => {
    expect(semantic("![a](a.png)\n\n图: 半角\n")[0]?.label).toBe("图");
    expect(semantic("![a](a.png)\n\n图：全角\n")[0]?.label).toBe("图");
  });

  it("英文标记也认（标签按文档语言走，不看界面语言）", () => {
    expect(semantic("![a](a.png)\n\nFigure: An english caption\n")[0]?.label).toBe(
      "Figure",
    );
    expect(semantic("![a](a.png)\n\nfig: short form\n")[0]?.label).toBe("Fig");
    expect(semantic("| A |\n| --- |\n| 1 |\n\nTable: A table\n")[0]?.label).toBe("Table");
  });

  it("繁体标签也认", () => {
    expect(semantic("![a](a.png)\n\n圖：繁體題註\n")[0]?.label).toBe("圖");
  });

  it("标记不在段落开头就不算（「**图：**说明」不是题注）", () => {
    expect(semantic("![a](a.png)\n\n**图：**说明\n")).toEqual([]);
  });

  it("图片段落里还有别的文字就不算图片段落", () => {
    expect(semantic("![a](a.png) 旁边还有字\n\n图：说明\n")).toEqual([]);
  });
});

describe("编号怎么算", () => {
  it("图与表各自计数", () => {
    const source = [
      "![a](a.png)",
      "",
      "图：甲",
      "",
      "| A |",
      "| --- |",
      "| 1 |",
      "",
      "表：乙",
      "",
      "![b](b.png)",
      "",
      "图：丙",
      "",
    ].join("\n");
    const captions = semantic(source);
    expect(captions.map((c) => `${c.kind}${c.number}`)).toEqual([
      "figure1",
      "table1",
      "figure2",
    ]);
  });

  it("一级标题分章，章内重新计数", () => {
    const source = [
      "# 第一章",
      "",
      "![a](a.png)",
      "",
      "图：甲",
      "",
      "![b](b.png)",
      "",
      "图：乙",
      "",
      "# 第二章",
      "",
      "![c](c.png)",
      "",
      "图：丙",
      "",
    ].join("\n");
    expect(semantic(source).map((c) => c.number)).toEqual(["1-1", "1-2", "2-1"]);
  });

  it("第一个一级标题之前没有章号", () => {
    const source = [
      "![a](a.png)",
      "",
      "图：甲",
      "",
      "# 第一章",
      "",
      "![b](b.png)",
      "",
      "图：乙",
      "",
    ].join("\n");
    expect(semantic(source).map((c) => c.number)).toEqual(["1", "1-1"]);
  });

  it("引用块里的一级标题不算章（章节是文档骨架）", () => {
    const source = ["> # 引用块里的标题", "", "![a](a.png)", "", "图：甲", ""].join("\n");
    expect(semantic(source).map((c) => c.number)).toEqual(["1"]);
  });

  it("全篇连续模式不带章号", () => {
    const source = [
      "# 第一章",
      "",
      "![a](a.png)",
      "",
      "图：甲",
      "",
      "# 第二章",
      "",
      "![b](b.png)",
      "",
      "图：乙",
      "",
    ].join("\n");
    expect(semantic(source, CONTINUOUS).map((c) => c.number)).toEqual(["1", "2"]);
  });

  it("不是题注的段落不消耗编号", () => {
    // 「图：不是题注」前后都是普通段落 → 它不挨着图片 → 不是题注 → 不占号
    const source = [
      "![a](a.png)",
      "",
      "普通段落",
      "",
      "图：不是题注",
      "",
      "普通段落二",
      "",
      "![b](b.png)",
      "",
      "图：乙",
      "",
    ].join("\n");
    expect(semantic(source).map((c) => c.number)).toEqual(["1"]);
  });
});

/* ── 对拍：编辑层必须与语义层一致 ── */

/** 对拍样例：覆盖各种「挨着谁」的形状 */
const PARITY_SAMPLES: Record<string, string> = {
  图题在图下: "![架构图](arch.png)\n\n图：系统总体架构\n",
  表题在表上: "表：用户角色一览\n\n| 角色 | 权限 |\n| --- | --- |\n| 管理员 | 全部 |\n",
  表题在表下: "| A | B |\n| --- | --- |\n| 1 | 2 |\n\n表：数据\n",
  分章: "# 第一章\n\n![a](a.png)\n\n图：甲\n\n## 小节\n\n![b](b.png)\n\n图：乙\n\n# 第二章\n\n![c](c.png)\n\n图：丙\n",
  章前内容: "![a](a.png)\n\n图：章前\n\n# 第一章\n\n![b](b.png)\n\n图：章内\n",
  图表夹心:
    "![a](a.png)\n\n图：图题\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n表：表题\n",
  列表里: "- 列表项\n\n![a](a.png)\n\n图：图题\n",
  引用里: "> ![a](a.png)\n>\n> 图：引用里的图题\n",
  任务项里: "- [ ] ![a](a.png)\n\n  图：任务里的图题\n",
  行内标记: "![a](a.png)\n\n图：**加粗**说明\n",
  标记不在开头: "**图：**说明\n\n![a](a.png)\n",
  英文: "![a](a.png)\n\nFigure: An english caption\n",
  半角冒号: "![a](a.png)\n\n图: 半角冒号\n",
  没有目标: "图：没有图片\n\n普通段落\n",
};

describe("编辑层与语义层对拍", () => {
  for (const [name, source] of Object.entries(PARITY_SAMPLES)) {
    it(`样例「${name}」两版结论一致`, () => {
      expect(editorial(source)).toEqual(semantic(source));
    });
  }

  it("对拍样例本身真的产生了题注（别对着空集对拍）", () => {
    // 自检：对拍断言两边相等，而「相等」在**空集**上恒成立。
    // 所以先确认样例确实产出���题注——否则这条对拍就是空转。
    const total = Object.values(PARITY_SAMPLES).reduce(
      (sum, source) => sum + semantic(source).length,
      0,
    );
    expect(total).toBeGreaterThan(0);
  });

  it("语料库上两版结论一致（不许有假阳性）", () => {
    const dir = join(process.cwd(), "tests", "corpus");
    const files = readdirSync(dir).filter((name) => name.endsWith(".md"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(join(dir, file), "utf8");
      expect({ file, editorial: editorial(source) }).toEqual({
        file,
        editorial: semantic(source),
      });
    }
  });
});

/* ── 产物 ── */

describe("导出产物", () => {
  it("导出的 HTML 里有编号，段落带题注样式", () => {
    const html = markdownToHtml("![a](a.png)\n\n图：系统总体架构\n", {
      captions: CHAPTER,
    });
    expect(html).toContain("图 1 系统总体架构");
    expect(html).toContain("ink-caption");
  });

  it("编号只出现在渲染结果里，源文不改", () => {
    const source = "![a](a.png)\n\n图：系统总体架构\n";
    const tree = parseMarkdown(source);
    applyCaptions(tree, source, CHAPTER);
    // 树里的段落正文被换成编号前缀……
    expect(JSON.stringify(tree)).toContain("图 1 系统总体架构");
    // ……但源码一个字都没动
    expect(source).toBe("![a](a.png)\n\n图：系统总体架构\n");
  });

  it("关掉题注就没有编号", () => {
    const html = markdownToHtml("![a](a.png)\n\n图：系统总体架构\n", { captions: null });
    expect(html).not.toContain("图 1-1");
    expect(html).toContain("图：系统总体架构");
  });

  it("给 pandoc 的源码里也有编号（它不认识「图：」这种约定）", () => {
    const source = "![a](a.png)\n\n图：系统总体架构\n";
    const captions = collectCaptions(parseMarkdown(source), source, CHAPTER);
    expect(applyCaptionsToSource(source, captions)).toBe(
      "![a](a.png)\n\n图 1 系统总体架构\n",
    );
  });

  it("多张图的编号依次排下去（源码改写从后往前，偏移量才不会错位）", () => {
    const source = [
      "![a](a.png)",
      "",
      "图：甲",
      "",
      "![b](b.png)",
      "",
      "图：乙",
      "",
    ].join("\n");
    const captions = collectCaptions(parseMarkdown(source), source, CHAPTER);
    expect(applyCaptionsToSource(source, captions)).toBe(
      ["![a](a.png)", "", "图 1 甲", "", "![b](b.png)", "", "图 2 乙", ""].join("\n"),
    );
  });
});

/* ── 编辑器里的渲染 ── */

describe("Live Preview 里的题注", () => {
  /** 把替换装饰里的 widget 渲染出来，取它的文字 */
  function prefixTexts(source: string, cursor: number): string[] {
    const set = buildLivePreviewDecorations(
      source,
      cursor,
      "live",
      parseSyntax(source),
      undefined,
      {
        numbering: "chapter",
      },
    );
    const out: string[] = [];
    const it = set.iter();
    while (it.value !== null) {
      const spec = it.value.spec as { widget?: { toDOM(): HTMLElement } };
      if (spec.widget) {
        const dom = spec.widget.toDOM();
        if (dom.classList.contains("cm-md-caption-prefix"))
          out.push(dom.textContent ?? "");
      }
      it.next();
    }
    return out;
  }

  it("「图：」被换成编号前缀", () => {
    const source = "![a](a.png)\n\n图：系统总体架构\n";
    expect(prefixTexts(source, 0)).toEqual(["图 1 "]);
  });

  it("光标进入题注段落 → 露出原文（标记要看得见才改得动）", () => {
    const source = "![a](a.png)\n\n图：系统总体架构\n";
    // 光标落在题注段落里
    expect(prefixTexts(source, source.indexOf("系统总体架构"))).toEqual([]);
  });

  it("题注段落挂上行样式（居中、小一号）", () => {
    const source = "![a](a.png)\n\n图：系统总体架构\n";
    const set = buildLivePreviewDecorations(
      source,
      0,
      "live",
      parseSyntax(source),
      undefined,
      {
        numbering: "chapter",
      },
    );
    const classes: string[] = [];
    const it = set.iter();
    while (it.value !== null) {
      const spec = it.value.spec as { class?: string };
      if (spec.class?.includes("cm-md-caption")) classes.push(spec.class);
      it.next();
    }
    expect(classes.length).toBeGreaterThan(0);
  });

  it("关掉题注就不换前缀", () => {
    const source = "![a](a.png)\n\n图：系统总体架构\n";
    expect(prefixTexts(source, 0)).toEqual(["图 1 "]);
    const set = buildLivePreviewDecorations(
      source,
      0,
      "live",
      parseSyntax(source),
      undefined,
      null,
    );
    let found = false;
    const it = set.iter();
    while (it.value !== null) {
      const spec = it.value.spec as { widget?: { toDOM(): HTMLElement } };
      if (spec.widget) {
        const dom = spec.widget.toDOM();
        if (dom.classList.contains("cm-md-caption-prefix")) found = true;
      }
      it.next();
    }
    expect(found).toBe(false);
  });
});

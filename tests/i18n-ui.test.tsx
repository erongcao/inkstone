/**
 * 界面级漏译检查：把 App 真的渲染出来，看 DOM 里有没有漏网的语言。
 *
 * 字典层的测试（`tests/i18n.test.ts`）守住「两份字典键集一致 / 文案在字典里」，
 * 但它**看不出插值漏译**——
 * 那种漏是「`t()` 的参数里塞了一个没翻译的中文常量」：
 * 字典里明明有对应的 key，字典层测试全绿，可界面上就是夹了一段中文。
 *
 * 实际踩过的例子（M5-3 收尾时在浏览器里发现的）：
 * 工具栏那个按钮的 `title` 是「显示策略：{mode}（点击切换）」，
 * 而 `{mode}` 填的是 `MARKER_DISPLAY_MODES[i].label`——
 * 那是**中文原文**（它就是翻译表的 key），没先 `t()` 就插进去了。
 * 结果是：按钮正文是英文，鼠标悬停的提示里夹着一句中文。
 *
 * 这类漏只有在**真实渲染出来**之后才看得见，所以要在这里渲染一次。
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import App from "@/App";
import { resetSettings, updateSettings } from "@/settings/store";

/** 简体里才有的字（繁体用同形的字不算） */
const SIMPLIFIED_ONLY = new Set(
  "与专丢两严个为么义书于产从们价众会体侧储关内写决击则刚删别务动区华协单卫却厂压参发变叶号吗启响国图块处备头夹学实宽对导并广库应开弃张当录径态总户扩扫择换数断无时显暂术机权条来极构标栏树样档检欢气汉沟没浅浊测济浏浓涂润涨渐渔温溃满滨潜灯灵点烦热牵状独环现电画疗监盖盘码确礼离积称竞笔简类粘粮紧纠红级纪纯纲纳纸纹线练组细织终经绑结绕绘给络绝统继续维编缩网罗罚职联脑脚脸节苏药见观规视览计订认议记设词试话该语误请读课调谈谊谋谐谓谢谨谱贝负财责败账货质购贴费资赏赔赖赞赢车转轮软轻载较辅辆辈辉辑输边达迁过运还这进远违连迟适选逊递逻遗邓郑酱释钟钥银链锁错锚键长门闭问间阅队阳阴阵际陆随隐难雾静页顶项顺须顽顾预颗题颜额风飘馆马验鱼鸟鸡麦黄齐龙龟".split(
    "",
  ),
);

/** 任意汉字 */
const CJK = /[一-鿿]/;

/**
 * 取 DOM 里所有**会显示给用户**的字符串。
 *
 * 光看 `textContent` 不够——`title` / `aria-label` / `placeholder` 这些
 * **属性**同样会出现在界面上（悬停提示、读屏软件念出来的名字），
 * 而 `textContent` 里根本没有它们。
 *
 * 实际踩过的那个漏就藏在 `title` 里：按钮正文是英文，
 * 鼠标一悬停，提示里冒出来一句中文。
 */
function visibleText(): string[] {
  const parts: string[] = [];
  for (const node of document.body.querySelectorAll("*")) {
    const own = Array.from(node.childNodes)
      .filter((child) => child.nodeType === 3)
      .map((child) => child.textContent ?? "")
      .join(" ");
    if (own) parts.push(own);
    for (const attr of ["title", "aria-label", "placeholder", "alt"]) {
      const value = node.getAttribute(attr);
      if (value) parts.push(value);
    }
  }
  return parts;
}

describe("界面级漏译", () => {
  beforeEach(() => {
    cleanup();
    resetSettings();
  });

  afterEach(() => {
    cleanup();
    resetSettings();
  });

  it("英文界面里不出现任何中文", () => {
    updateSettings({ general: { language: "en" } });
    render(<App />);

    const leaked = visibleText()
      .filter((text) => CJK.test(text))
      .map((text) => text.trim());

    expect(leaked).toEqual([]);
  });

  it("繁体界面里不出现简体字", () => {
    updateSettings({ general: { language: "zh-TW" } });
    render(<App />);

    const leaked = visibleText().filter((text) =>
      [...text].some((char) => SIMPLIFIED_ONLY.has(char)),
    );
    expect(leaked).toEqual([]);
  });

  it("简体界面就是中文原文", () => {
    updateSettings({ general: { language: "zh-CN" } });
    render(<App />);

    // 简体没有字典文件——原文即译文
    expect(visibleText().join(" ")).toContain("实时预览");
  });

  it("繁体界面的文案不与英文界面完全相同（同一句话没被翻译）", () => {
    // 这一条抓的是「**该翻没翻**」：
    // 英文界面上看不出问题（本来就是英文），
    // 但切到繁体还是同一句英文，就说明那条根本没走翻译。
    //
    // 实际踩过的例子：侧边栏页签的 label 在**模块常量定义处**就调了 t()，
    // 导入时定型成英文，之后 `t("Outline")` 查不到译文 —— 任何语言下都是英文。
    updateSettings({ general: { language: "en" } });
    render(<App />);
    const english = new Set(visibleText().map((text) => text.trim()).filter(Boolean));

    cleanup();
    updateSettings({ general: { language: "zh-TW" } });
    render(<App />);
    const traditional = visibleText().map((text) => text.trim()).filter(Boolean);

    // 这些本来就不该翻译：产品名、格式名、语言名
    const ALLOWED = new Set([
      "AI",
      "Markdown",
      "English",
      "AI 助手",
      "Inkstone Light",
      "GitHub",
      "Academic Writing",
    ]);

    // 只看「含字母」的文案——「×」「9」「1」这类符号与数字
    // 在任何语言下都一样，不是漏译
    const untranslated = [
      ...new Set(
        traditional.filter(
          (text) =>
            /[A-Za-z]/.test(text) &&
            english.has(text) &&
            !ALLOWED.has(text),
        ),
      ),
    ];
    expect(untranslated).toEqual([]);
  });
});

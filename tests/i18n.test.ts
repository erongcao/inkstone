/**
 * i18n 层：字典完整性、回退行为、插值与分段渲染。
 *
 * ## 为什么这层要单独钉死
 *
 * 手写轻量 i18n 最大的风险不是「翻译得不好」，而是**漏了还不报错**：
 * 缺一条译文，界面上那个位置就退回中文原文，看起来像是「翻译没覆盖到」，
 * 但开发期根本不会有人发现——直到一个繁体用户来提 issue。
 *
 * M5-3 实际就踩了这个坑：`zh-TW.ts` 当初是用 358 条的采集集生成的，
 * 之后 `en.ts` 补到了 415 条，**两份字典的键集悄悄漂移了**，
 * 繁体界面有 50 多个位置露着简体。没人报错，因为回退逻辑是对的——
 * 回退到简体原文本来就是设计行为。
 *
 * 所以这里守的是三条：
 *
 * 1. **两份字典的键集必须完全相同**（漂移 = 漏译）
 * 2. **代码里 `t("…")` 的每个字面量都必须在字典里**（漏登记 = 静默漏译）
 * 3. **繁体译文里不能有简体字**（转换漏了也是漏译）
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOCALES, LOCALE_LABELS, getLocale, t, tParts } from "@/i18n";
import { en } from "@/i18n/locales/en";
import { zhTW } from "@/i18n/locales/zh-TW";
import { resetSettings, updateSettings } from "@/settings/store";

const SRC_DIR = join(process.cwd(), "src");

/** 递归列出 src 下的所有 .ts / .tsx（排除字典目录本身） */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (full.endsWith(join("i18n", "locales"))) continue;
      out.push(...sourceFiles(full));
    } else if (name.endsWith(".ts") || name.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

/** 去掉注释——否则文档里的示例代码会被当成真的调用点 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'\\])\/\/[^\n]*/g, "$1");
}

const ALL_SOURCE = sourceFiles(SRC_DIR)
  .map((file) => stripComments(readFileSync(file, "utf8")))
  .join("\n");

/**
 * 「字面量 + 字面量 + …」的拼接链。
 *
 * 为什么要专门处理：界面文案如果是由几段字面量拼出来的，
 * 运行时是**拼完之后**那个整串去查字典的——
 * 字典里登记的却是拼接前的某一段，就永远对不上，
 * 表现是「这条文案在英文/繁体下一直是中文」，而且**不报错**。
 * （src/ai/endpoints.ts 的 MiniMax note 就是这么踩过。）
 */
const CHAIN = /("(?:[^"\\]|\\.)*")(?:\s*\+\s*"(?:[^"\\]|\\.)*")+/g;

/** 把一条拼接链还原成运行时那个整串 */
function chainText(whole: string): string {
  const parts = whole.match(/"(?:[^"\\]|\\.)*"/g) ?? [];
  return parts.map((part) => part.slice(1, -1)).join("");
}

/** 源文件里所有拼接出来的整串 */
function concatenatedGroups(): string[] {
  const out: string[] = [];
  for (const match of ALL_SOURCE.matchAll(CHAIN)) {
    const joined = chainText(match[0]);
    if (/[一-鿿]/.test(joined)) out.push(joined);
  }
  return out;
}

/** 把拼接链接成一条字面量，这样源文件里就能查到拼接后的整串 */
const JOINED_SOURCE = ALL_SOURCE.replace(CHAIN, (whole) => `"${chainText(whole)}"`);

/** 代码里 `t("…")` / `tParts("…")` 的第一个字面量参数 */
function calledLiterals(): string[] {
  const pattern = /\bt(?:Parts)?\(\s*"((?:[^"\\]|\\.)*)"/g;
  const out: string[] = [];
  for (const match of ALL_SOURCE.matchAll(pattern)) out.push(match[1]);
  return out;
}

/**
 * 只在繁体里写成别样的简体字。
 *
 * 这些字在繁体里**也用同样的字形**（如 复/復、注/註、里/裡 的用法分语境），
 * 所以不能一概判错——那属于词级覆盖的活，不在这张表里。
 */
const SIMPLIFIED_ONLY = new Set(
  "与专丢两严个为么义书于产从们价众会体侧储关内写决击则刚删别务动区华协单卫却厂压参发变叶号吗启响国图块处备头夹学实宽对导并广库应开弃张当录径态总户扩扫择换数断无时显暂术机权条来极构标栏树样档检欢气汉沟没浅浊测济浏浓涂润涨渐渔温溃满滨潜灯灵点烦热牵状独环现电画疗监盖盘码确礼离积称竞笔简类粘粮紧纠红级纪纯纲纳纸纹线练组细织终经绑结绕绘给络绝统继续维编缩网罗罚职联脑脚脸节苏药见观规视览计订认议记设词试话该语误请读课调谈谊谋谐谓谢谨谱贝负财责败账货质购贴费资赏赔赖赞赢车转轮软轻载较辅辆辈辉辑输边达迁过运还这进远违连迟适选逊递逻遗邓郑酱释钟钥银链锁错锚键长门闭问间阅队阳阴阵际陆随隐难雾静页顶项顺须顽顾预颗题颜额风飘馆马验鱼鸟鸡麦黄齐龙龟".split(
    "",
  ),
);

describe("字典完整性", () => {
  it("英文与繁体的键集完全相同", () => {
    const onlyEn = Object.keys(en).filter((key) => !(key in zhTW));
    const onlyTw = Object.keys(zhTW).filter((key) => !(key in en));
    expect({ onlyEn, onlyTw }).toEqual({ onlyEn: [], onlyTw: [] });
  });

  it("代码里 t() 的每个字面量都在字典里（漏登记 = 静默漏译）", () => {
    const missing = [...new Set(calledLiterals())]
      .filter((text) => text && /[一-鿿]/.test(text))
      .filter((text) => !(text in en));
    expect(missing).toEqual([]);
  });

  it("字典里没有用不到的条目", () => {
    /*
     * 两种写法都算「用到了」：
     *   - 原文：绝大多数键（"保存"）
     *   - 转义形式：含换行的键。语法速查表里的多行示例
     *     （代码块、表格、块级公式）在源码里是 "```js\nconst a = 1;\n```"
     *     这种带转义的字面量，运行时才是真正的换行——
     *     直接拿运行时键去比源码文本，比不到。
     */
    const unused = Object.keys(en).filter((key) => {
      if (JOINED_SOURCE.includes(key)) return false;
      return !JOINED_SOURCE.includes(JSON.stringify(key).slice(1, -1));
    });
    expect(unused).toEqual([]);
  });

  it("拼接出来的界面文案都登记进了字典（拼接后再查表，对不上就一直显示中文）", () => {
    // AI 提示词是有意不翻译的——它们是给模型看的指令，不是界面文案
    const PROMPTS = ["你是一位中文"];
    const missing = [...new Set(concatenatedGroups())]
      .filter((text) => !PROMPTS.some((prefix) => text.startsWith(prefix)))
      .filter((text) => !(text in en));
    expect(missing).toEqual([]);
  });

  it("繁体译文里不残留简体字", () => {
    const leaked: string[] = [];
    for (const [key, value] of Object.entries(zhTW)) {
      for (const char of value) {
        if (SIMPLIFIED_ONLY.has(char)) leaked.push(`${key} → ${value}（${char}）`);
      }
    }
    expect(leaked).toEqual([]);
  });

  it("占位符在译文里原样保留", () => {
    // 占位符名集合必须一致，否则插值会丢值
    const placeholders = (text: string) =>
      [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(en)) {
      expect(placeholders(zhTW[key]), `zh-TW 占位符与原文不一致：${key}`).toEqual(
        placeholders(key),
      );
      expect(placeholders(en[key]), `英文占位符与原文不一致：${key}`).toEqual(
        placeholders(key),
      );
    }
  });
});

describe("语言列表", () => {
  it("三种语言都有自称名", () => {
    for (const locale of LOCALES) {
      expect(LOCALE_LABELS[locale]).toBeTruthy();
    }
  });

  it("默认是简体中文", () => {
    resetSettings();
    expect(getLocale()).toBe("zh-CN");
  });
});

describe("t() 的回退与插值", () => {
  it("简体中文返回原文（简体没有字典文件）", () => {
    resetSettings();
    expect(t("保存")).toBe("保存");
  });

  it("英文返回译文", () => {
    resetSettings();
    updateSettings({ general: { language: "en" } });
    expect(t("保存")).toBe("Save");
  });

  it("繁体返回译文", () => {
    resetSettings();
    updateSettings({ general: { language: "zh-TW" } });
    expect(t("保存")).toBe("儲存");
  });

  it("缺译回退到中文原文，而不是显示 key", () => {
    resetSettings();
    updateSettings({ general: { language: "en" } });
    expect(t("这句没被收录进字典")).toBe("这句没被收录进字典");
  });

  it("缺译时占位符不丢", () => {
    resetSettings();
    updateSettings({ general: { language: "en" } });
    expect(t("这句没被收录进字典：{error}", { error: "EACCES" })).toBe(
      "这句没被收录进字典：EACCES",
    );
  });

  it("插值替换占位符", () => {
    resetSettings();
    updateSettings({ general: { language: "en" } });
    expect(
      t("{hits} 处匹配 · 扫了 {files} 个文件 · {ms} ms", {
        hits: 3,
        files: 2,
        ms: 17,
      }),
    ).toContain("3");
  });

  it("语言一变，t() 立刻跟着变（不重启、不刷新）", () => {
    resetSettings();
    const before = t("保存");
    updateSettings({ general: { language: "en" } });
    const after = t("保存");
    expect(before).not.toBe(after);
    expect(after).toBe("Save");
  });
});

describe("tParts()：把译文按占位符拆成三段", () => {
  it("中文：数字在句中", () => {
    resetSettings();
    const parts = tParts(
      "有 {count} 个标签页在 {time} 还有没保存的版本。",
      { count: 3, time: "10:30" },
      "count",
    );
    expect(parts.before).toBe("有 ");
    expect(parts.value).toBe("3");
    expect(parts.after).toBe(" 个标签页在 10:30 还有没保存的版本。");
  });

  it("英文：数字在句首——拆的仍然是译文，所以不会拆错", () => {
    resetSettings();
    updateSettings({ general: { language: "en" } });
    const parts = tParts(
      "有 {count} 个标签页在 {time} 还有没保存的版本。",
      { count: 3, time: "10:30" },
      "count",
    );
    expect(parts.before).toBe("");
    expect(parts.value).toBe("3");
    expect(parts.after).toBe(" tabs still have unsaved versions from 10:30.");
  });

  it("译文里没有该占位符时不炸，整句当前半段", () => {
    resetSettings();
    updateSettings({ general: { language: "en" } });
    const parts = tParts("保存", { count: 3 }, "count");
    expect(parts.before).toBe("Save");
    expect(parts.value).toBe("");
    expect(parts.after).toBe("");
  });
});

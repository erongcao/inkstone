/**
 * 界面国际化（手写轻量方案，零依赖）。
 *
 * ## 为什么用「简体中文原文」当 key
 *
 * 五百多条界面文案如果要用语义化 key（`toolbar.save`），
 * 就得先给每一条起名字、再维护一张「名字 ↔ 文案」的映射——
 * **抽象与翻译两件事叠在一起，漏一条就是界面上一处硬编码**，
 * 而且漏了不报错，只是那个位置显示成 `toolbar.save`。
 *
 * 用原文当 key：
 *
 * - 原文留在代码里，翻译表能一眼对照，**漏译一眼看得出**
 * - 不用给五百多条文案起名字（起名字本身就会出错）
 * - 缺翻译时**回退到中文原文**——界面显示中文，
 *   而不是显示一个用户看不懂的 key
 *
 * 代价：中文原文改了，key 就跟着变了（翻译会失效）。
 * 缓解办法是缺译时 `console.warn`，开发期立刻能发现。
 *
 * ## 翻译放哪
 *
 * `src/i18n/locales/<locale>.ts`：键是中文原文，值是译文。
 *
 * 简体没有字典文件——**原文即译文**，所以 `zh-CN` 的字典是空的。
 * 这不是偷懒：简体是源语言，多一份字典就多一处可能不同步的地方。
 *
 * ## 语言存在哪
 *
 * 设置里的 `general.language`（`src/settings/schema.ts` 早就定义好了，
 * 但一直**没有接到任何东西**——下拉框能选，选了不生效）。
 *
 * 本模块不自己存一份：它读的就是设置 store，
 * 所以「设置面板改语言 → 界面立刻变」不需要任何同步代码。
 *
 * ## 两种用法
 *
 * ```ts
 * // 渲染时翻译（组件、模板字符串、运行时消息都走这一条）
 * return <button>{t("保存")}</button>;
 *
 * // 模块常量**不要**在定义时翻译：
 * // 那会在导入时定型，语言改了也不跟着变。
 * // 常量保留中文原文（它就是翻译表的 key），渲染时再 t()。
 * const LABELS = [{ id: "save", label: "保存" }];
 * // 渲染时：t(LABELS[0].label)
 * ```
 *
 * `t()` 必须在**渲染时**调用——模块常量里的 `t()` 会在导入时就定型，
 * 那条路只能用于「不随语言变化的场合」。
 */

import { useSyncExternalStore } from "react";
import { readSettings, subscribeSettings } from "@/settings/store";
import { en } from "./locales/en";
import { zhTW } from "./locales/zh-TW";

/** 支持的语言 */
export type Locale = "zh-CN" | "zh-TW" | "en";

/** 全部语言（顺序即设置面板里的显示顺序） */
export const LOCALES: readonly Locale[] = ["zh-CN", "zh-TW", "en"];

/**
 * 语言名用**自称**（endonym）——英文界面里也显示「简体中文」。
 *
 * 这是通用惯例：用户认得自己的语言名，
 * 「Chinese (Simplified)」对不懂英文的人反而不友好。
 */
export const LOCALE_LABELS: Record<Locale, string> = {
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  en: "English",
};

/** 翻译表：中文原文 → 译文 */
type Dictionary = Readonly<Record<string, string>>;

const DICTIONARIES: Record<Locale, Dictionary> = {
  // 简体：原文即译文
  "zh-CN": {},
  "zh-TW": zhTW,
  en,
};

/**
 * 已报过的缺译（去重，避免同一个词刷屏）
 */
const reported = new Set<string>();

/**
 * 缺翻译时提醒一次。
 *
 * 只在开发模式提醒——生产环境里一条警告换不来任何收益，
 * 反而会淹没真正重要的错误。
 */
function reportMissing(locale: Locale, text: string): void {
  if (!import.meta.env.DEV) return;
  const key = `${locale} ${text}`;
  if (reported.has(key)) return;
  reported.add(key);
  console.warn(`[i18n] ${locale} 缺少译文：${text}`);
}

/** 插值占位符：`{error}` 这样的形式 */
const PLACEHOLDER = /\{(\w+)\}/g;

/** 插值：把 `{name}` 换成实际值；没有对应值就原样留着 */
function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(PLACEHOLDER, (whole, name: string) => {
    const value = values[name];
    return value === undefined ? whole : String(value);
  });
}

/**
 * 按语言查译文；查不到就回退到中文原文。
 *
 * 占位符原样保留：`自动保存失败：{error}` 译成
 * `Autosave failed: {error}`——**错误信息本身不翻译**，
 * 因为那是运行时的事实（文件名、报错原文），不是界面文案。
 */
function translate(
  locale: Locale,
  text: string,
  values?: Record<string, string | number>,
): string {
  if (!text) return text;
  const hit = locale === "zh-CN" ? undefined : DICTIONARIES[locale][text];
  if (locale !== "zh-CN" && hit === undefined) reportMissing(locale, text);
  const template = hit ?? text;
  if (!values) return template;
  return interpolate(template, values);
}

/**
 * 把译文按某个占位符拆成「前 / 该值 / 后」三段。
 *
 * 用来表达「句子里的某个值要单独加粗」——
 * 拆的是**译文**，所以英文把数字挪到句首、
 * 中文把数字放在中间，两边拆出来的位置都对：
 *
 * - 中文 `有 {count} 个标签页在 {time} 还有没保存的版本。`
 *   → 前=`有 `，值=`3`，后=` 个标签页在 10:30 还有没保存的版本。`
 * - 英文 `{count} tabs still have unsaved versions from {time}.`
 *   → 前=``，值=`3`，后=` tabs still have unsaved versions from 10:30.`
 *
 * 只拆一次（第一个匹配），所以译文里别处再出现同一个占位符不会出错。
 */
export function tParts(
  text: string,
  values: Record<string, string | number>,
  emphasis: string,
): { before: string; value: string; after: string } {
  const locale = getLocale();
  const hit = locale === "zh-CN" ? undefined : DICTIONARIES[locale][text];
  if (locale !== "zh-CN" && hit === undefined) reportMissing(locale, text);
  const template = hit ?? text;

  const marker = `{${emphasis}}`;
  const at = template.indexOf(marker);
  if (at < 0) {
    // 译文里没有这个占位符：整句当「前」，另两段留空
    return { before: interpolate(template, values), value: "", after: "" };
  }

  const value = values[emphasis];
  return {
    before: interpolate(template.slice(0, at), values),
    value: value === undefined ? marker : String(value),
    after: interpolate(template.slice(at + marker.length), values),
  };
}

/** 当前语言（同步读取，给组件外的调用点用） */
export function getLocale(): Locale {
  return readSettings().general.language;
}

/**
 * 语言 → HTML 的 `lang` 属性值（BCP 47）。
 *
 * ## 为什么单独列一张表
 *
 * 导出的 HTML 要写 `lang="…"`。它不是装饰：
 *   - 屏幕阅读器靠它选发音规则（英文文档标成 `zh-CN` 会被读成中文）
 *   - 浏览器断词换行也靠它
 *
 * 值目前与 `Locale` 同名，但**不直接用 `Locale` 当 `lang`**——
 * 界面语言与文档语言是两件事，将来可能需要分开
 * （界面是 `zh-TW`，导出的文档标记成 `zh-Hant-HK`）。
 * 改这一张表就行，不用散在各处改。
 */
export const LOCALE_HTML_LANG: Record<Locale, string> = {
  "zh-CN": "zh-CN",
  "zh-TW": "zh-TW",
  en: "en",
};

/**
 * 取某个语言对应的 HTML `lang` 属性值。
 *
 * @param locale 语言；不传 = 当前语言
 */
export function htmlLang(locale: Locale = getLocale()): string {
  return LOCALE_HTML_LANG[locale] ?? locale;
}

/** 订阅语言变化 */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribeSettings, getLocale, getLocale);
}

/**
 * 翻译一段中文原文。
 *
 * 给**组件外**的调用点用（模块常量、运行时消息、错误提示）。
 *
 * 组件里也用它：根组件订阅了 `useLocale()`，语言一变整棵树重渲染，
 * 渲染时调用的 `t()` 自然拿到新语言。
 */
export function t(text: string, values?: Record<string, string | number>): string {
  return translate(getLocale(), text, values);
}

/**
 * 翻译函数的绑定版本（按当前语言）。
 *
 * 组件里一般**不需要**用这个——直接用 `t()` 就行：
 * 语言一变，根组件订阅了 `useLocale()`，整棵树重新渲染，
 * 渲染时调用的 `t()` 自然拿到新语言。
 *
 * 只有「不想跟着整棵树重渲染」的组件才需要它
 * （比如自己订阅语言、只重渲染自己那一小块）。
 */
export function bindTranslator(
  locale: Locale,
): (text: string, values?: Record<string, string | number>) => string {
  return (text: string, values?: Record<string, string | number>) =>
    translate(locale, text, values);
}

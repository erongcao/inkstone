/**
 * Mermaid 的按需加载与渲染。
 *
 * ## 为什么必须懒加载
 *
 * mermaid 带 d3、dagre、cytoscape、elk、khroma 一大票传递依赖。
 * 实测构建产物（`vite build`，非压缩）：
 *
 * | | assets 总计 | JS 总计 |
 * | --- | --- | --- |
 * | 不含 mermaid | 3172 KB | 2601 KB |
 * | 含 mermaid | 8396 KB | 7573 KB |
 *
 * **+5.0 MB**。绝大多数文档里根本没有图表图，放进主 chunk 等于让所有人
 * 为一个不用的功能付冷启动代价。所以走 `import()`，
 * 第一次真的遇到 ` ```mermaid ` 才下载那个 chunk——与 KaTeX、remark 同一套理由。
 *
 * ## 为什么不能直接同步渲染
 *
 * `BlockRenderer.render()` 是**同步**接口（装饰器管线要它同步产出 DOM）。
 * 而 `mermaid.render()` 是异步的，而且慢：一个中等流程图实测 50–300 ms。
 * 所以这里做成「同步接口 + 异步补齐」：
 *
 *   1. `renderDiagram()` 先查缓存，命中就同步返回 DOM
 *   2. 没命中 → 登记一次待渲染，返回 null（块暂时保持源码形态）
 *   3. 异步渲染完成 → 通知监听者 → 编辑器重算装饰器 → 图表出现
 *
 * 这和 KaTeX 的 `onMathRendererReady` 是同一个套路。
 *
 * ## 防抖：这是必须的，不是优化
 *
 * 装饰器在**每次击键**都重算。没有防抖的话，用户在图表块里打一个字符
 * 就会发起一次 50–300 ms 的渲染——打字直接卡死。
 * 所以只有在代码**静默 250 ms** 之后才真正发起渲染。
 */

/** `initialize` 只用到的配置项（其余走 mermaid 自己的默认值） */
interface MermaidInitConfig {
  startOnLoad?: boolean;
  securityLevel?: "strict" | "loose" | "antiscript" | "sandbox";
  theme?: "default" | "base" | "dark";
  flowchart?: { htmlLabels?: boolean; useMaxWidth?: boolean };
  sequence?: { useMaxWidth?: boolean };
}

/** 渲染结果：SVG 文本或错误文本 */
export interface DiagramResult {
  ok: boolean;
  /** `ok` 时是 SVG 源码，`!ok` 时是错误说明 */
  output: string;
}

/**
 * mermaid 只用到三个方法，声明一个最小结构而不是引它的完整类型。
 *
 * 引 `mermaid` 的类型会把整个包的 `.d.ts` 图拉进 tsc 的检查范围，
 * 慢；而我们只调 `initialize` / `render`，其余一律不碰。
 * 同时它也让我们不必在类型层面依赖 mermaid 的内部导出路径
 * （`mermaid/config.type` 这种深层路径在版本间会变）。
 */
type MermaidApi = {
  initialize(config: MermaidInitConfig): void;
  render(
    id: string,
    text: string,
    container?: Element,
  ): Promise<{
    svg: string;
    bindFunctions?: (element: Element) => void;
  }>;
  parse(text: string, options?: { suppressErrors?: boolean }): Promise<unknown>;
};

let api: Promise<MermaidApi> | null = null;

/** 缓存：`主题 + 代码` → 结果。上限 40 条，超了按插入顺序淘汰 */
const CACHE_LIMIT = 40;
const cache = new Map<string, DiagramResult>();

/** 已挂起、还没渲染的键 */
const queued = new Set<string>();

/** 防抖计时器 */
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** 静默多久才真正发起渲染 */
const DEBOUNCE_MS = 250;

/** `mermaid.render` 要求 id 唯一；用自增计数避开与文档内容冲突 */
let renderSeq = 0;

/** 当前 `initialize` 用的是哪个主题；主题是**全局**配置，不是每次 render 的参数 */
let activeMode: string | null = null;

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * 当前明暗模式。
 *
 * 实现在主题层（`src/theme/themes.ts`）——那里才是主题系统的所在地，
 * 导出链路也要用同一个（见那里的说明）。
 */
import { currentColorMode } from "@/theme/themes";

export { currentColorMode as currentMode };
/**
 * 缓存键的分隔符。
 *
 * 用 NUL 而不是空格：图表源码里**到处是空格**
 * （`graph TD\n  A-->B`），用空格分隔会切错位置。
 */
const KEY_SEP = "\u0000";

function cacheKey(code: string, mode: string): string {
  return `${mode}${KEY_SEP}${code}`;
}

/**
 * 加载并初始化 mermaid。
 *
 * `securityLevel: "strict"` —— mermaid 自己的默认值，写出来是为了表明这是**刻意的**：
 * strict 会净化标签里的 HTML、并禁用 click 回调。图表文本是用户内容，
 * 而编辑器会渲染别人给的 Markdown，loose 等于开了注入的口子。
 *
 * `startOnLoad: false` —— 我们按需调 `render`，不需要它自动扫描页面。
 *
 * `fontFamily` 留空：让 mermaid 用继承的字体，跟正文排版一致。
 * 写死一个字体会让图表和正文的字形对不上。
 */
function load(): Promise<MermaidApi> {
  if (!api) {
    api = import("mermaid").then((mod) => {
      const mermaid = (mod.default ?? mod) as unknown as MermaidApi;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        // 图表里的文字不参与文档选区，也不该被 Live Preview 的行内规则影响
        flowchart: { htmlLabels: true, useMaxWidth: true },
        sequence: { useMaxWidth: true },
        // 主题切换时重新 initialize 会换掉整套 CSS 变量，所以主题名要跟着 mode 走
      });
      return mermaid;
    });
  }
  return api;
}

/** 缓存满时淘汰最早插入的一条 */
function remember(key: string, result: DiagramResult): void {
  cache.set(key, result);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/** 真正发起渲染（已在防抖之后调用） */
async function flush(): Promise<void> {
  const keys = [...queued];
  queued.clear();
  if (keys.length === 0) return;

  try {
    const mermaid = await load();
    for (const key of keys) {
      const cut = key.indexOf(KEY_SEP);
      const keyMode = key.slice(0, cut);
      const code = key.slice(cut + 1);
      // 主题变了就重新 initialize（theme 是全局配置，不是每次 render 的参数）
      if (keyMode !== activeMode) {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: keyMode === "dark" ? "dark" : "base",
          flowchart: { htmlLabels: true, useMaxWidth: true },
          sequence: { useMaxWidth: true },
        });
        activeMode = keyMode;
      }
      try {
        renderSeq += 1;
        const { svg } = await mermaid.render(`inkstone-mermaid-${renderSeq}`, code);
        remember(key, { ok: true, output: svg });
      } catch (error) {
        // 用户正在打字，中间状态本来就不是合法的图表语法。
        // 抛出去会让整块消失——所以把错误文本存进缓存，让渲染层显示成错误块。
        remember(key, { ok: false, output: describeError(error) });
      }
    }
  } catch (error) {
    for (const key of keys) {
      remember(key, { ok: false, output: describeError(error) });
    }
  }
  // 无论成败都要通知：成功才能出图，失败才能出错误块
  notify();
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    // mermaid 的报错常带一大段 SVG 噪音，截断一下更可读
    const text = error.message
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text.length > 400 ? `${text.slice(0, 400)}…` : text;
  }
  return String(error);
}

/**
 * 取一张图。
 *
 * @returns 命中缓存时同步返回；未命中时登记并返回 null（调用方保持源码形态）。
 */
export function renderDiagram(code: string): DiagramResult | null {
  const trimmed = code.trim();
  if (!trimmed) return null;
  const key = cacheKey(trimmed, currentColorMode());

  const cached = cache.get(key);
  if (cached) return cached;

  queued.add(key);
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void flush();
  }, DEBOUNCE_MS);

  return null;
}

/**
 * 订阅「有新结果」事件，返回取消订阅函数。
 *
 * 订阅时如果缓存里已经有东西会**立即**回调一次——
 * 否则「先渲染完、后挂监听」会漏掉这次通知，图表要敲一个字符才出现。
 */
export function onDiagramRendered(listener: () => void): () => void {
  if (cache.size > 0) listener();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 预加载 mermaid。
 *
 * ⚠️ **不要在应用启动时调用**——mermaid 连同传递依赖实测 5.0 MB。
 * 正确时机是「文档里真的出现了 ` ```mermaid ` 围栏」（见 MarkdownEditor 里的接法）。
 * KaTeX 可以启动就预热（603 KB），mermaid 不行，量级差一个数量级。
 */
export function primeMermaid(): void {
  void load().catch(() => {
    /* 预加载失败不影响主流程：图表块会保持源码形态 */
  });
}

/** 测试用：清空缓存与队列 */
export function resetDiagramCache(): void {
  cache.clear();
  queued.clear();
  activeMode = null;
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

/** 测试用：等防抖与渲染跑完 */
export async function flushDiagramQueue(): Promise<void> {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  await flush();
}

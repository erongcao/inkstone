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

/**
 * 正在飞的渲染：`主题 + 代码` → promise。
 *
 * 为什么要单独记一份：编辑器那条路是「排队 + 防抖」，
 * 导出那条路是「立刻渲染」（`renderDiagramAsync`）——
 * 两条路完全可能同时盯上同一段代码（用户一边改图一边导出）。
 * 没有这张表的话，同一段图会被渲染两次：
 * mermaid 一次 50–300 ms，而且两次渲染产出的 SVG id 会撞车。
 */
const inFlight = new Map<string, Promise<DiagramResult>>();

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

/**
 * 渲染串行化用的链。
 *
 * ## 为什么必须串行
 *
 * mermaid 的主题是**全局配置**——`initialize()` 一调，整个实例就换了主题，
 * 而 `render()` 本身**没有**「用哪个主题渲染」这个参数。
 * 于是两张不同主题的图并发渲染时会互相把对方的主题换掉，
 * 出来的图有一张配色是错的，而且错得**很难发现**。
 *
 * 排成一队、一次只跑一个：慢一点，但结果一定对。
 * 代价很小——一次导出通常也就几张图。
 */
let renderChain: Promise<unknown> = Promise.resolve();

/** 把一个渲染任务挂到串行链的末尾 */
function serialize<T>(task: () => Promise<T>): Promise<T> {
  // `then(task, task)`：前一个任务失败时**也要**继续跑下一个——
  // 一张图画崩了不能把后面的图一起带死。
  const run = renderChain.then(task, task);
  // 链本身不能被拒绝，否则后面的任务会全被跳过
  renderChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * 让 mermaid 的全局主题跟目标模式对上。
 *
 * 主题是全局配置而不是 render 的参数，所以换模式必须重新 `initialize`。
 * `activeMode` 记的就是「现在全局是哪个主题」。
 */
function ensureTheme(mermaid: MermaidApi, mode: string): void {
  if (mode === activeMode) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: mode === "dark" ? "dark" : "base",
    flowchart: { htmlLabels: true, useMaxWidth: true },
    sequence: { useMaxWidth: true },
  });
  activeMode = mode;
}

/**
 * 渲染一张图并写进缓存。
 *
 * ## 为什么不抛异常
 *
 * 渲染失败是**正常情况**——用户正在打字时，图本来就还是半成品。
 * 抛出去会让整块消失（编辑器那边），或者整次导出失败（导出那边）。
 * 所以失败被转成 `{ ok: false, output: 错误文本 }` 的缓存条目，
 * 由调用方自己决定怎么表现（显示错误块 / 退回源码块）。
 */
async function renderKey(
  code: string,
  mode: string,
  key: string,
): Promise<DiagramResult> {
  return serialize(async () => {
    // 排队期间可能已经有别的路径渲染好了（编辑器与导出链路会撞上）
    const cached = cache.get(key);
    if (cached) return cached;

    try {
      const mermaid = await load();
      ensureTheme(mermaid, mode);
      renderSeq += 1;
      const { svg } = await mermaid.render(`inkstone-mermaid-${renderSeq}`, code);
      const result: DiagramResult = { ok: true, output: svg };
      remember(key, result);
      return result;
    } catch (error) {
      const result: DiagramResult = { ok: false, output: describeError(error) };
      remember(key, result);
      return result;
    }
  });
}

/** 真正发起渲染（已在防抖之后调用） */
async function flush(): Promise<void> {
  const keys = [...queued];
  queued.clear();
  if (keys.length === 0) return;

  for (const key of keys) {
    const cut = key.indexOf(KEY_SEP);
    const keyMode = key.slice(0, cut);
    const code = key.slice(cut + 1);
    // 逐张渲染。`renderKey` **从不抛异常**——失败会变成
    // `{ ok: false }` 的缓存条目（用户正在打字时，中间状态本来就不是
    // 合法语法，抛出去会让整块消失），所以这里不用自己 try/catch。
    await renderKey(code, keyMode, key);
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
 * 同步等到某段图表渲染完成（导出链路用）。
 *
 * ## 与 `renderDiagram()` 的分工
 *
 * - `renderDiagram()` 是**同步**的：没命中缓存就登记排队、返回 null，
 *   块暂时保持源码形态。编辑器要的就是这个——
 *   装饰器管线是同步的，不能被一个 50–300 ms 的渲染卡住。
 * - 这里要的是「**现在就要**」的结果：没命中就**立刻**渲染，**不等防抖**。
 *   导出时用户正等着文件写盘，不能让图表以源码形态落进导出物。
 *
 * ## 为什么复用同一个缓存
 *
 * 导出出来的图必须和屏幕上那张**一模一样**（架构约束 C：屏幕与导出必须一致）。
 * 复用同一份缓存就保证了同一套 mermaid 配置（主题 / securityLevel /
 * flowchart 选项）——两份实现各配各的，迟早会漂移。
 *
 * ## 失败不抛异常
 *
 * 语法错误的图在编辑器里是「渲染成错误块」，导出侧应当能**退回源码块**。
 * 所以失败被转成 `{ ok: false, output: 错误文本 }`（与缓存条目同形状），
 * 调用方据此决定要不要保留原代码块。
 *
 * @param code 图表源码
 */
export async function renderDiagramAsync(code: string): Promise<DiagramResult | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;

  const mode = currentColorMode();
  const key = cacheKey(trimmed, mode);

  // 命中缓存：和屏幕上那张是同一个结果，直接复用
  const cached = cache.get(key);
  if (cached) return cached;

  // 同一段图已经在渲染了 → 复用那个 promise，不要起第二次渲染
  const pending = inFlight.get(key);
  if (pending) return pending;

  const promise = renderKey(trimmed, mode, key).finally(() => {
    inFlight.delete(key);
    // 通知监听者：编辑器可能正等着这张图刷新
    notify();
  });
  inFlight.set(key, promise);
  return promise;
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
  // 在飞的那张也要忘掉：否则下一次调用会复用上一个测试留下的 promise，
  // 拿到一个跟当前测试无关的结果。
  inFlight.clear();
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

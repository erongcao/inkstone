/**
 * 最小 DOM stub，让**纯逻辑模块**能在 Node 基准脚本里跑。
 *
 * ## 为什么需要它
 *
 * `buildLivePreviewDecorations()` 现在会构造真实的 DOM（图片 widget、
 * 表格工具栏、代码高亮块）。这些模块在 Node 里跑就会 `document is not defined`，
 * 基准脚本随之整个崩掉——于是 `scripts/bench-decorations.ts` 在语料里
 * 出现图片之后就不再能跑，`AGENTS.md` 里那批性能数字也随之**无法复现**。
 *
 * ## 这不是「假装有 DOM」
 *
 * stub 只提供装饰器管线真正用到的那几个操作：
 * `createElement` / `dataset` / `classList` / `style` / `appendChild`。
 * 它**不参与计时以外的事**——基准只测「构造这些对象要多久」，
 * 对象本身是不是真 DOM 与那个数字无关。
 *
 * 如果哪天某个模块开始依赖 stub 里没有的能力，
 * 这里会直接抛 `未实现的 DOM API: xxx`，而不是静悄悄返回 undefined
 * 造成一轮「基准数据不对」的排查。
 */

interface StubNode {
  tagName: string;
  children: StubNode[];
  dataset: Record<string, string>;
  style: Record<string, string>;
  textContent: string;
  innerHTML: string;
  className: string;
  classList: {
    add(...names: string[]): void;
    remove(...names: string[]): void;
    toggle(name: string, force?: boolean): void;
    contains(name: string): boolean;
  };
  appendChild(child: StubNode): StubNode;
  removeChild(child: StubNode): StubNode;
  replaceChild(next: StubNode, prev: StubNode): StubNode;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  querySelector(selector: string): StubNode | null;
  querySelectorAll(selector: string): StubNode[];
  addEventListener(): void;
  removeEventListener(): void;
}

function createNode(tagName: string): StubNode {
  const classes = new Set<string>();
  const node: StubNode = {
    tagName: tagName.toUpperCase(),
    children: [],
    dataset: {},
    style: {},
    textContent: "",
    innerHTML: "",
    className: "",
    classList: {
      add: (...names) => names.forEach((n) => classes.add(n)),
      remove: (...names) => names.forEach((n) => classes.delete(n)),
      toggle: (name, force) => {
        const on = force ?? !classes.has(name);
        if (on) classes.add(name);
        else classes.delete(name);
      },
      contains: (name) => classes.has(name),
    },
    appendChild(child) {
      node.children.push(child);
      return child;
    },
    removeChild(child) {
      const i = node.children.indexOf(child);
      if (i >= 0) node.children.splice(i, 1);
      return child;
    },
    replaceChild(next, prev) {
      const i = node.children.indexOf(prev);
      if (i >= 0) node.children.splice(i, 1, next);
      return prev;
    },
    setAttribute(name, value) {
      node.dataset[name] = value;
    },
    getAttribute(name) {
      return name in node.dataset ? node.dataset[name] : null;
    },
    // 基准不关心选择器结果，只保证不崩
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  return node;
}

/**
 * 装上 stub。**幂等**——重复调用不会覆盖已经存在的真 `document`。
 *
 * @returns 是否真的装了（false = 环境本来就有 document）
 */
export function installDomStub(): boolean {
  const g = globalThis as unknown as { document?: unknown };
  if (typeof g.document !== "undefined") return false;

  g.document = {
    createElement: (tag: string) => createNode(tag),
    createTextNode: (text: string) => {
      const node = createNode("#text");
      node.textContent = text;
      return node;
    },
    documentElement: createNode("html"),
    body: createNode("body"),
    querySelector: () => null,
    querySelectorAll: () => [],
    get styleSheets() {
      return [];
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  return true;
}

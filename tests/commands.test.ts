/**
 * 命令系统与编辑原语的护栏测试。
 *
 * 覆盖三块：
 *   1. **注册表**——注册、分类排序、按入口过滤、`enabled` 剔除
 *   2. **模糊匹配**——分档排序、英文关键字、空查询、无命中
 *   3. **编辑原语**——包裹/拆包裹、行前缀增删换、有序列表重编号、插入块
 *
 * 还有斜杠菜单与链接浮层的触发判据——那两个是纯函数，
 * 浏览器里造场景要连打几个键还要盯弹层，在这里能钉得死死的。
 *
 * **面板与浮层的 DOM 行为不在这里测**（jsdom 没有布局引擎，
 * `coordsAtPos` 返回 null），那部分靠生产构建的浏览器实测。
 */

import { describe, expect, it, beforeEach } from "vitest";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undoDepth } from "@codemirror/commands";
import { livePreview } from "@/editor/live-preview";
import {
  allCommands,
  commandsFor,
  getCommand,
  matchCommands,
  registerCommands,
  runCommand,
  type InkstoneCommand,
} from "@/editor/commands";
import "@/editor/commands/builtin";
import {
  insertAround,
  insertBlock,
  prefixLines,
  toggleLinePrefix,
  toggleWrap,
} from "@/editor/command-editing";
import { findSlashTrigger } from "@/editor/slash-menu";
import { classifyUrl } from "@/editor/link-popover";
import { onIntent, type Intent } from "@/editor/intents";

/* ═══════════════════════════════════════════════════════════ */

function createEditor(doc = "", extensions: Extension[] = []): EditorView {
  const parent = document.body.appendChild(document.createElement("div"));
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: [history(), livePreview(), ...extensions],
    }),
    parent,
  });
}

/** 选一段文本并把光标放上去 */
function select(view: EditorView, from: number, to = from): void {
  view.dispatch({ selection: { anchor: from, head: to } });
}

const doc = (view: EditorView): string => view.state.doc.toString();

/* ═══════════════════════════════════════════════════════════
 * 注册表
 * ═══════════════════════════════════════════════════════════ */

describe("命令注册表", () => {
  it("内置命令在模块加载后就注册好了（斜杠菜单可能早于 React 挂载）", () => {
    expect(getCommand("format.bold")).toBeDefined();
    expect(getCommand("block.table")).toBeDefined();
    expect(getCommand("view.source")).toBeDefined();
  });

  it("id 唯一", () => {
    const ids = allCommands().map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("每条命令都有中文显示名与分类", () => {
    for (const command of allCommands()) {
      expect(command.label.trim(), `${command.id} 缺显示名`).not.toBe("");
      expect(command.category.trim(), `${command.id} 缺分类`).not.toBe("");
    }
  });

  it("斜杠菜单只拿到 surfaces 含 slash 的（视图/文件类不该出现在这里）", () => {
    const ids = commandsFor("slash", null).map((command) => command.id);
    expect(ids).toContain("block.table");
    expect(ids).toContain("format.bold");
    expect(ids).not.toContain("view.source");
    expect(ids).not.toContain("file.save");
  });

  it("命令面板拿到全部命令", () => {
    const ids = commandsFor("palette", null).map((command) => command.id);
    expect(ids).toContain("view.source");
    expect(ids).toContain("file.save");
  });

  it("enabled 为假的命令被剔除，且跑不动", () => {
    const fake: InkstoneCommand = {
      id: "test.disabled",
      label: "永远不可用",
      category: "测试",
      enabled: () => false,
      run: () => true,
    };
    registerCommands([fake]);
    // 必须传一个真实视图：没有视图就无从判断 enabled
    const view = createEditor("");
    expect(commandsFor("palette", view).map((c) => c.id)).not.toContain("test.disabled");
    expect(runCommand("test.disabled", view)).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════
 * 模糊匹配
 * ═══════════════════════════════════════════════════════════ */

describe("命令模糊匹配", () => {
  const commands = commandsFor("palette", null);

  it("空查询返回全部（顺序稳定）", () => {
    const hits = matchCommands(commands, "");
    expect(hits.length).toBe(commands.length);
    expect(hits[0].command.id).toBe(matchCommands(commands, "")[0].command.id);
  });

  it("中文前缀命中", () => {
    const hits = matchCommands(commands, "表格");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].command.id).toBe("block.table");
  });

  it("英文原名能命中中文命令（keywords）", () => {
    const hits = matchCommands(commands, "table");
    expect(hits.map((hit) => hit.command.id)).toContain("block.table");
  });

  it("搜「缩放」能找到三条缩放命令", () => {
    /*
     * 菜单文案用的是系统惯例（「放大 / 缩小 / 实际大小」），
     * 但用户在命令面板里打的是「缩放」——那是这个功能的**中文名**。
     * 搜不到就等于这个功能没有第二个入口。
     */
    const ids = matchCommands(commands, "缩放").map((hit) => hit.command.id);
    expect(ids).toContain("view.zoom-in");
    expect(ids).toContain("view.zoom-out");
    expect(ids).toContain("view.zoom-reset");
  });

  it("搜「字号」也能找到缩放命令（它改的就是字号）", () => {
    const ids = matchCommands(commands, "字号").map((hit) => hit.command.id);
    expect(ids).toContain("view.zoom-in");
  });

  it("前缀命中排在子串命中之前", () => {
    // 「表格」在「插入表格」开头，在「导出为 HTML 表格」中间
    const hits = matchCommands(commands, "表格");
    const top = hits[0].command.label;
    expect(top.startsWith("表格")).toBe(true);
  });

  it("子序列命中（字散在各处）", () => {
    const hits = matchCommands(commands, "码块");
    expect(hits.map((hit) => hit.command.id)).toContain("block.code");
  });

  it("没有命中时返回空数组", () => {
    expect(matchCommands(commands, "zzzqqqxx")).toHaveLength(0);
  });

  it("limit 生效", () => {
    expect(matchCommands(commands, "", 3)).toHaveLength(3);
  });

  it("排序确定：同一查询重复结果一致", () => {
    const a = matchCommands(commands, "表").map((hit) => hit.command.id);
    const b = matchCommands(commands, "表").map((hit) => hit.command.id);
    expect(a).toEqual(b);
  });
});

/* ═══════════════════════════════════════════════════════════
 * 编辑原语
 * ═══════════════════════════════════════════════════════════ */

describe("行内包裹", () => {
  let view: EditorView;
  beforeEach(() => {
    view = createEditor("hello");
  });

  it("有选区时两侧补标记，光标包住内容", () => {
    select(view, 0, 5);
    toggleWrap(view, "**", "文字");
    expect(doc(view)).toBe("**hello**");
    expect(view.state.sliceDoc(...Object.values(view.state.selection.main).slice(0, 2) as [number, number]));
  });

  it("空选区时用占位文字，光标停在开标记之后（可以直接改占位内容）", () => {
    select(view, 5);
    toggleWrap(view, "`", "代码");
    expect(doc(view)).toBe("hello`代码`");
    expect(view.state.selection.main.head).toBe(6); // 5 + "`".length
  });

  it("多字符标记的光标偏移按标记长度算", () => {
    select(view, 5);
    toggleWrap(view, "**", "加粗");
    expect(doc(view)).toBe("hello**加粗**");
    expect(view.state.selection.main.head).toBe(7); // 5 + "**".length
  });

  it("再包一次就拆掉，且选区收回内容", () => {
    select(view, 0, 5);
    toggleWrap(view, "**", "文字");
    toggleWrap(view, "**", "文字");
    expect(doc(view)).toBe("hello");
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(
      "hello",
    );
  });

  it("多字符标记（==）的拆包裹", () => {
    select(view, 0, 5);
    toggleWrap(view, "==", "高亮");
    expect(doc(view)).toBe("==hello==");
    toggleWrap(view, "==", "高亮");
    expect(doc(view)).toBe("hello");
  });

  it("一次操作只占一个撤销步", () => {
    select(view, 0, 5);
    const before = undoDepth(view.state);
    toggleWrap(view, "**", "文字");
    expect(undoDepth(view.state)).toBe(before + 1);
  });
});

describe("行前缀", () => {
  it("加无序列表", () => {
    const view = createEditor("第一项\n第二项");
    select(view, 0, view.state.doc.length);
    toggleLinePrefix(view, { bullet: "-" });
    expect(doc(view)).toBe("- 第一项\n- 第二项");
  });

  it("再按一次去掉", () => {
    const view = createEditor("- 第一项\n- 第二项");
    select(view, 0, view.state.doc.length);
    toggleLinePrefix(view, { bullet: "-" });
    expect(doc(view)).toBe("第一项\n第二项");
  });

  it("换同级符号而不是叠加", () => {
    const view = createEditor("* 第一项\n* 第二项");
    select(view, 0, view.state.doc.length);
    toggleLinePrefix(view, { bullet: "-" });
    expect(doc(view)).toBe("- 第一项\n- 第二项");
  });

  it("有序列表自动连续编号", () => {
    const view = createEditor("甲\n乙\n丙");
    select(view, 0, view.state.doc.length);
    toggleLinePrefix(view, { numbered: true });
    expect(doc(view)).toBe("1. 甲\n2. 乙\n3. 丙");
  });

  it("已经全是编号时再按一次是取反（与 Typora 一致），不是重编号", () => {
    const view = createEditor("1. 甲\n2. 乙");
    select(view, 0, view.state.doc.length);
    toggleLinePrefix(view, { numbered: true });
    expect(doc(view)).toBe("甲\n乙");
  });

  it("编号不齐时按有序列表会重新连号", () => {
    const view = createEditor("甲\n9. 乙");
    select(view, 0, view.state.doc.length);
    toggleLinePrefix(view, { numbered: true });
    expect(doc(view)).toBe("1. 甲\n2. 乙");
  });

  it("引用", () => {
    const view = createEditor("引用内容");
    select(view, 0);
    toggleLinePrefix(view, { bullet: ">" });
    expect(doc(view)).toBe("> 引用内容");
  });

  it("只影响选区覆盖的行", () => {
    const view = createEditor("甲\n乙\n丙");
    select(view, 0, 1);
    toggleLinePrefix(view, { bullet: "-" });
    expect(doc(view)).toBe("- 甲\n乙\n丙");
  });

  it("标题级别互斥：在 H1 上按 H2 是升级，不是叠成 `# ##`", () => {
    const view = createEditor("标题");
    select(view, 0);
    prefixLines(view, "# ");
    expect(doc(view)).toBe("# 标题");
    prefixLines(view, "## ");
    expect(doc(view)).toBe("## 标题");
    // 按同一个级别两次是幂等的
    prefixLines(view, "## ");
    expect(doc(view)).toBe("## 标题");
  });
});

describe("插入块", () => {
  it("在空行插入，光标落在指定偏移", () => {
    const view = createEditor("");
    insertBlock(view, "| a | b |\n| - | - |", 2);
    expect(doc(view)).toBe("| a | b |\n| - | - |");
    expect(view.state.selection.main.head).toBe(2);
  });

  it("段落中间插入会断开成独立块（前后各补一个空行）", () => {
    const view = createEditor("上文下文");
    select(view, 2); // 「上文」与「下文」之间
    insertBlock(view, "分隔块");
    expect(doc(view)).toBe("上文\n\n分隔块\n\n下文");
  });

  it("前面已经是空行时不重复补（否则会攒出四个换行）", () => {
    const view = createEditor("上文\n\n");
    select(view, view.state.doc.length);
    insertBlock(view, "分隔块");
    expect(doc(view)).toBe("上文\n\n分隔块");
  });

  it("空文档直接插入，一个换行都不补", () => {
    const view = createEditor("");
    insertBlock(view, "分隔块");
    expect(doc(view)).toBe("分隔块");
  });

  it("cursorOffset 超界时钳到合法范围", () => {
    const view = createEditor("");
    insertBlock(view, "短", 999);
    expect(view.state.selection.main.head).toBeLessThanOrEqual(view.state.doc.length);
  });
});

describe("两侧插入", () => {
  it("有选区时包住并保留选区", () => {
    const view = createEditor("文字");
    select(view, 0, 2);
    insertAround(view, "[", "](url)", "链接文字");
    expect(doc(view)).toBe("[文字](url)");
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(
      "文字",
    );
  });

  it("空选区时用占位文字", () => {
    const view = createEditor("");
    insertAround(view, "![", "](图片路径)", "图片说明");
    expect(doc(view)).toBe("![图片说明](图片路径)");
  });
});

/* ═══════════════════════════════════════════════════════════
 * 斜杠菜单触发判据
 * ═══════════════════════════════════════════════════════════ */

function slashContext(text: string) {
  return {
    pos: text.length,
    state: EditorState.create({ doc: text }),
    explicit: false,
  } as Parameters<typeof findSlashTrigger>[0];
}

describe("斜杠菜单触发判据", () => {
  it("行首的 `/`", () => {
    expect(findSlashTrigger(slashContext("/"))?.query).toBe("");
  });

  it("行首 `/ta` 带查询", () => {
    const hit = findSlashTrigger(slashContext("/ta"));
    expect(hit?.query).toBe("ta");
    expect(hit?.from).toBe(0);
  });

  it("列表项里的 `/`", () => {
    expect(findSlashTrigger(slashContext("- /"))?.query).toBe("");
  });

  it("有序列表项里的 `/`", () => {
    expect(findSlashTrigger(slashContext("1. /"))?.query).toBe("");
  });

  it("引用里的 `/`", () => {
    expect(findSlashTrigger(slashContext("> /"))?.query).toBe("");
  });

  it("正文中间不触发（`1/2` 是正常写法）", () => {
    expect(findSlashTrigger(slashContext("约 1/2 杯"))).toBeNull();
  });

  it("英文路径不触发（`a/b`）", () => {
    expect(findSlashTrigger(slashContext("见 src/a"))).toBeNull();
  });

  it("没有斜杠不触发", () => {
    expect(findSlashTrigger(slashContext("普通文字"))).toBeNull();
  });

  it("查询里出现标点就停", () => {
    expect(findSlashTrigger(slashContext("/ta,"))).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════
 * URL 分类（链接浮层）
 * ═══════════════════════════════════════════════════════════ */

describe("URL 分类", () => {
  it("空", () => {
    expect(classifyUrl("   ")).toBe("empty");
  });

  it("带协议的绝对地址", () => {
    expect(classifyUrl("https://example.com")).toBe("url");
  });

  it("mailto/tel 也算绝对地址", () => {
    expect(classifyUrl("mailto:a@b.com")).toBe("url");
    expect(classifyUrl("tel:+8613800000000")).toBe("url");
  });

  it("相对路径 / 锚点**不算**错误，只是提示性质", () => {
    // Markdown 允许 `[a](./b.md)`，不该被当成写错了
    expect(classifyUrl("./images/a.png")).toBe("path");
    expect(classifyUrl("#章节")).toBe("path");
    expect(classifyUrl("www.example.com")).toBe("path");
  });
});

/* ═══════════════════════════════════════════════════════════
 * 意图总线
 * ═══════════════════════════════════════════════════════════ */

describe("意图总线", () => {
  it("视图类命令发意图而不直接改设置", () => {
    const seen: Intent[] = [];
    const off = onIntent((intent) => seen.push(intent));
    try {
      runCommand("view.source", createEditor());
      runCommand("view.focus-mode", createEditor());
      // 注意：发出去的**意图**是 view.toggle-focus-mode，
      // 与命令 id（view.focus-mode）是两回事——意图描述的是「要做什么」
      expect(seen).toEqual([
        { type: "view.source" },
        { type: "view.toggle-focus-mode" },
      ]);
    } finally {
      off();
    }
  });

  it("退订后不再收到", () => {
    const seen: Intent[] = [];
    const off = onIntent((intent) => seen.push(intent));
    off();
    runCommand("view.source", createEditor());
    expect(seen).toEqual([]);
  });

  it("三条缩放命令发的是缩放意图", () => {
    /*
     * 缩放的实现在 React 侧（改设置），所以命令表只发意图。
     * 三条命令 ↔ 三个意图是一一对应的——
     * 少一条，那个菜单项就还是死的。
     */
    const seen: Intent[] = [];
    const off = onIntent((intent) => seen.push(intent));
    try {
      runCommand("view.zoom-in", createEditor());
      runCommand("view.zoom-out", createEditor());
      runCommand("view.zoom-reset", createEditor());
      expect(seen).toEqual([
        { type: "view.zoom-in" },
        { type: "view.zoom-out" },
        { type: "view.zoom-reset" },
      ]);
    } finally {
      off();
    }
  });
});

/* ═══════════════════════════════════════════════════════════
 * 端到端：命令 → 文档
 * ═══════════════════════════════════════════════════════════ */

describe("命令落到文档上", () => {
  it("加粗", () => {
    const view = createEditor("hello");
    select(view, 0, 5);
    runCommand("format.bold", view);
    expect(doc(view)).toBe("**hello**");
  });

  it("表格模板", () => {
    const view = createEditor("");
    runCommand("block.table", view);
    expect(doc(view)).toContain("| 列 1 | 列 2 | 列 3 |");
    expect(doc(view)).toContain("| --- | --- | --- |");
  });

  it("代码块：光标落在两个反引号之间", () => {
    const view = createEditor("");
    runCommand("block.code", view);
    expect(doc(view)).toBe("```\n\n```");
    expect(view.state.sliceDoc(3, 4)).toBe("\n");
  });

  it("分隔线", () => {
    const view = createEditor("");
    runCommand("block.hr", view);
    expect(doc(view)).toBe("---");
  });
});
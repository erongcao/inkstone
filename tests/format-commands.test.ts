/**
 * 格式命令不许说谎。
 *
 * 命令面板里的格式命令，用户点了之后屏幕上**必须**有变化。
 * 插进去一段不生效的标记，比没有这个命令更糟：
 * 用户以为成功了，屏幕上什么都没变——
 * 他不会想到是自己用错了，只会以为编辑器坏了。
 *
 * 这不是假设：`==高亮==` 就是这么活了很久。
 * 命令在、标记也在，解析层却不认，屏幕上永远是裸的等号。
 *
 * 所以这里拿**解析器**去验每一个格式标记：
 * 标记必须被当成语法吃掉，不能只是普通文本。
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Node, Parent } from "mdast";
import { parseMarkdown } from "@/parser/markdown";
import { FORMAT_SPECS } from "@/editor/commands/builtin";
import { commandsFor } from "@/editor/commands";
import { livePreview } from "@/editor/live-preview";
import { resetSettings, updateSettings } from "@/settings/store";
import "@/editor/commands/builtin";

/**
 * 已知「命令在、但渲染还没做」的格式。
 *
 * 每一条都要写清为什么没做——
 * 否则这份清单会变成垃圾桶，最后谁都往里塞。
 *
 * 这两条的共同点：`~x~` 与 `^x^` 是 Typora 的 P1 功能，
 * 而 Inkstone 的 lezer 侧**其实已经有现成扩展**
 * （`@lezer/markdown` 导出了 `Subscript` / `Superscript`），
 * 但 remark 侧没有对应的解析规则——
 * 只开一半就会破「解析规则唯一」那条红线
 * （编辑器认一套、导出认另一套），所以两条一起等。
 */
const KNOWN_PENDING = new Map<string, string>([
  ["format.sub", "lezer 侧有 Subscript 扩展，remark 侧还没有对应解析规则"],
  ["format.super", "lezer 侧有 Superscript 扩展，remark 侧还没有对应解析规则"],
]);

/** 取段落里直接子节点的类型 */
function childTypes(source: string): string[] {
  const tree = parseMarkdown(source) as unknown as Node;
  const paragraph = tree.children[0] as Parent;
  if (!Array.isArray(paragraph.children)) return [];
  return paragraph.children.map((c) => c.type);
}

describe("格式命令：插进去的标记必须真的会渲染", () => {
  for (const spec of FORMAT_SPECS) {
    const id = `format.${spec.id}`;
    it(`${spec.label}（${spec.marker}）`, () => {
      const source = `${spec.marker}字${spec.marker}`;
      const types = childTypes(source);

      if (KNOWN_PENDING.has(id)) {
        // 已知没做的：断言它**确实**还没做——
        // 一旦有人实现了，这条会红，提醒把清单里的条目删掉。
        expect(
          types.every((t) => t === "text"),
          `${id} 已经能渲染了（节点类型 ${types.join(",")}），` +
            `请把它从 KNOWN_PENDING 里移出去`,
        ).toBe(true);
        return;
      }

      expect(
        types.some((t) => t !== "text"),
        `${spec.label}（${spec.marker}）插进去之后没有被当成语法：` +
          `解析结果是纯文本，用户点了命令屏幕上却什么都没变`,
      ).toBe(true);
    });
  }
});

describe("KNOWN_PENDING 清单本身不许有陈旧条目", () => {
  it("每一条都对应一个真实存在的格式命令", () => {
    const ids = new Set(FORMAT_SPECS.map((s) => `format.${s.id}`));
    for (const id of KNOWN_PENDING.keys()) {
      expect(ids.has(id), `${id} 已经不在格式命令表里了，清单该更新`).toBe(true);
    }
  });

  it("每一条都写清了为什么没做", () => {
    for (const [id, reason] of KNOWN_PENDING) {
      expect(reason.length, `${id} 没写原因`).toBeGreaterThan(0);
    }
  });
});

/* ═══════════════════════════════════════════════════════════
   受开关控制的格式命令
   ═══════════════════════════════════════════════════════════ */

/** 造一个真实编辑器（`commandsFor` 要有 view 才会检查 `enabled`） */
function createEditor(): EditorView {
  const parent = document.body.appendChild(document.createElement("div"));
  return new EditorView({
    // 必须挂 livePreview：表格命令的 `enabled` 要读语法树，
    // 没有那个字段会抛 "Field is not present in this state"。
    state: EditorState.create({ doc: "", extensions: [livePreview()] }),
    parent,
  });
}

describe("格式命令：依赖扩展开关的那些", () => {
  beforeEach(() => {
    resetSettings();
  });
  afterEach(() => {
    resetSettings();
  });

  it("高亮命令声明了它依赖「行内高亮」开关", () => {
    const spec = FORMAT_SPECS.find((s) => s.id === "highlight");
    expect(spec?.feature).toBe("highlight");
  });

  it("开关开着时，高亮命令在面板里", () => {
    const view = createEditor();
    const ids = commandsFor("palette", view).map((c) => c.id);
    expect(ids).toContain("format.highlight");
  });

  it("开关关掉后，高亮命令从面板里消失", () => {
    // 关掉高亮之后插进去的 `==…==` 不会被解析层认，
    // 屏幕上永远是裸的等号——那这条命令就不该出现。
    updateSettings({ markdown: { highlight: false } });
    const view = createEditor();
    const ids = commandsFor("palette", view).map((c) => c.id);
    expect(ids).not.toContain("format.highlight");
  });

  it("关掉高亮不影响其它格式命令", () => {
    updateSettings({ markdown: { highlight: false } });
    const view = createEditor();
    const ids = commandsFor("palette", view).map((c) => c.id);
    expect(ids).toContain("format.bold");
    expect(ids).toContain("format.italic");
    expect(ids).toContain("format.strike");
  });

  it("斜杠菜单里同样受开关控制", () => {
    updateSettings({ markdown: { highlight: false } });
    const view = createEditor();
    const ids = commandsFor("slash", view).map((c) => c.id);
    expect(ids).not.toContain("format.highlight");
  });
});

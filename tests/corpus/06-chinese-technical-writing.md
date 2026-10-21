# 中文技术写作样例

这份语料的目标是覆盖**中文作者真实会写出来的内容**：
中英混排的句子、全角标点、术语、代码块、表格、命令输出。

## 中英混排的句子

在 macOS 上用 `brew install --cask` 安装 Inkstone 之后，可以在终端里用
`inkstone --version` 确认版本号。

性能方面，remark 的解析耗时是 10.96 ms（p95），而 lezer 只有 1.05 ms，
差距主要来自 AST 节点的分配。

> 注意：这里的数字全部来自 2026-10-20 的实测，不是估算。

## 术语对照表

| 中文 | English | 备注 |
| :--- | :--- | --- |
| 单一真相源 | single source of truth | 架构红线之一 |
| 实时预览 | live preview | Typora 式混合编辑 |
| 零宽占位 | zero-width placeholder | 隐藏标记符的实现 |
| 撤销栈 | undo stack | CM6 的 `history()` |

## 命令行示例

```bash
# 安装依赖
pnpm install

# 跑质量闸门
pnpm typecheck && pnpm lint && pnpm test

# 构建 Tauri 应用
pnpm tauri build --bundles app
```

## 代码块里的中文注释

```typescript
/**
 * 构造编辑器扩展列表。
 *
 * 注意：autoPairBox 是 Compartment，运行时切换级别不用重建编辑器。
 */
function buildExtensions(options: MarkdownEditorOptions, autoPairBox: Compartment) {
  return [history(), livePreview(), autoPairBox.of(autoPair(options.autoPairMode))];
}
```

## 输出与报错

```text
扫描依赖 1828 条（去重后 675 条）

✅ 许可证检查通过：未发现 GPL / AGPL / SSPL 等传染性许可证依赖。
```

## 段落中的软换行

这一段刻意写成很长的一行，
中间只有换行符没有空行，
在 Markdown 里属于同一个段落。

## 列表里的中英混排

- 第一项：把 `editor.markerDisplay` 设成 `dimmed`，标记符会弱化显示
- 第二项：把 `editor.autoPairMode` 设成 `off`，自动配对全部关闭
  - 嵌套项：这样就不会在写 `2*3` 的时候被自动补成 `2*3*`
  - 嵌套项：写 `snake_case` 也不会被拆坏
- 第三项：以上两项可以同时生效，互不干扰

## 数字与单位

- 1080p 的视频在 60 fps 下需要约 1.5 MB/s 的码率
- 一个 UTF-8 汉字占 3 字节，UTF-16 占 2 字节
- emoji 多数占 4 字节（Unicode 码点 U+1F600 起的那些）

## 省略号与破折号

行文中……省略号用六个点，破折号用——两个 em dash。
它们都不应该被解析成特殊语法。

---
title: 脚注、HTML 与图片
tags: [脚注, HTML]
---

# 脚注、HTML 与图片

## 脚注

这里有一个脚注引用[^1]，还有另一个[^long-note]。

也可以重复引用同一个脚注[^1]。

[^1]: 这是脚注一的正文，包含 **粗体** 和 `代码`。

[^long-note]: 这是一个较长的脚注说明。
    它跨越多行，并且包含一个列表：

    - 列表项一
    - 列表项二

    以及一段代码：

    ```js
    console.log("脚注里的代码块");
    ```

## HTML 块

<div align="center">
  <strong>居中的 HTML 块</strong>
</div>

<details>
<summary>点击展开</summary>

折叠区域里的内容。

</details>

<table>
  <tr><td>HTML 表格</td><td>第二列</td></tr>
</table>

行内 HTML：<span style="color: red;">这段文字是红色</span>，还有 <u>下划线</u> 和 <mark>高亮</mark>。

## 图片

带标题的图片：

![替代文本](./images/example.png "图片标题")

不含标题的图片：

![](./images/no-title.png)

网络图片：

![网络图片](https://example.com/remote.png)

带链接的图片：

[![链接图片](./images/linked.png)](https://example.com)

## 图片引用式

![引用式图片][img-ref]

[img-ref]: ./images/reference.png "引用式标题"

# 链接与图片的各种形式

## 行内链接

这是 [Typora 官网](https://typora.io)，也是 [Inkstone 的仓库](https://github.com/example/inkstone)。

带标题的链接：[Typora](https://typora.io "Typora 官方站点")。

## 引用式链接

[行内链接][inline-ref] 与 [引用链接][ref-link] 是两种写法。

[inline-ref]: https://example.com/inline "行内引用定义"
[ref-link]: https://example.com/reference

## 自动链接

<https://example.com/auto-link> 会自动成为链接。

联系邮箱：<mailto:someone@example.com>。

## 图片

带 alt 文本的图片：![Inkstone 界面](images/inkstone.png)

带标题的图片：![Inkstone 界面](images/inkstone.png "主界面截图")

没有 alt 文本：![](images/empty.png)

## 图片里带链接

[![Inkstone 徽章](images/badge.svg)](https://github.com/example/inkstone)

## URL 里的特殊字符

行内出现的裸 URL 不会被自动解析：https://example.com/path?a=1&b=2#section

但下面这个会：<https://example.com/path?a=1&b=2#section>

## 链接文字里的强调

[**加粗的链接文字**](https://example.com) 和 [*斜体的链接文字*](https://example.com)。

## 链接文字里的代码

[`code` 作为链接文字](https://example.com)

## 尖括号与下划线

文件名 like_this_file.md 不该变成斜体。
带空格的路径 /Users/name/My Documents/file.md 同理。

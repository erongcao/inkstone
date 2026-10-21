# Inkstone 使用手册（长文档语料）

> 这份语料用于压测解析与序列化：内容结构规整、块类型齐全、篇幅较长。

## 目录

- [安装与配置](#安装与配置)
- [编辑内核](#编辑内核)
- [实时预览](#实时预览)
- [源码模式](#源码模式)
- [自动配对](#自动配对)
- [粘贴](#粘贴)
- [文件管理](#文件管理)
- [导出](#导出)

## 第 1 部分：安装与配置

把 Inkstone 装到机器上只需要一条命令，随后在设置面板里挑一个主题。

### 1. 安装与配置要点

这一段是对第 1 个要点的展开说明，包含 **加粗**、*斜体*、`行内代码` 与 [链接](https://example.com/1)。文中还会出现 $x_{1}$ 这样的行内数学，以及 `pnpm test` 这样的命令。

```ts
export function step1(input: string): number {
  // 第 1 步
  return input.length * 1;
}
```

| 步骤 | 输入 | 输出 |
| :--- | :---: | ---: |
| 1 | `input` | 2 |

> 提示：这一条引用是第 1 个要点的补充说明。

- 列表项 1
  - 嵌套项 1

### 2. 编辑内核要点

这一段是对第 2 个要点的展开说明，包含 **加粗**、*斜体*、`行内代码` 与 [链接](https://example.com/2)。文中还会出现 $x_{2}$ 这样的行内数学，以及 `pnpm test` 这样的命令。

```ts
export function step2(input: string): number {
  // 第 2 步
  return input.length * 2;
}
```

| 步骤 | 输入 | 输出 |
| :--- | :---: | ---: |
| 2 | `input` | 4 |

### 3. 实时预览要点

这一段是对第 3 个要点的展开说明，包含 **加粗**、*斜体*、`行内代码` 与 [链接](https://example.com/3)。文中还会出现 $x_{3}$ 这样的行内数学，以及 `pnpm test` 这样的命令。

```ts
export function step3(input: string): number {
  // 第 3 步
  return input.length * 3;
}
```

| 步骤 | 输入 | 输出 |
| :--- | :---: | ---: |
| 3 | `input` | 6 |

> 提示：这一条引用是第 3 个要点的补充说明。

### 4. 源码模式要点

这一段是对第 4 个要点的展开说明，包含 **加粗**、*斜体*、`行内代码` 与 [链接](https://example.com/4)。文中还会出现 $x_{4}$ 这样的行内数学，以及 `pnpm test` 这样的命令。

```ts
export function step4(input: string): number {
  // 第 4 步
  return input.length * 4;
}
```

| 步骤 | 输入 | 输出 |
| :--- | :---: | ---: |
| 4 | `input` | 8 |

- 列表项 4
  - 嵌套项 4

## 第 2 部分：编辑内核

编辑区由 CodeMirror 6 承担，文档内容始终是纯 Markdown 文本。

### 5. 编辑内核要点

这一段是对第 5 个要点的展开说明，包含 **加粗**、*斜体*、`行内代码` 与 [链接](https://example.com/5)。文中还会出现 $x_{5}$ 这样的行内数学，以及 `pnpm test` 这样的命令。

```ts
export function step5(input: string): number {
  // 第 5 步
  return input.length * 5;
}
```

| 步骤 | 输入 | 输出 |
| :--- | :---: | ---: |
| 5 | `input` | 10 |

> 提示：这一条引用是第 5 个要点的补充说明。

- 列表项 5
  - 嵌套项 5

### 6. 实时预览要点

这一段是对第 6 个要点的展开说明，包含 **加粗**、*斜体*、`行内代码` 与 [链接](https://example.com/6)。文中还会出现 $x_{6}$ 这样的行内数学，以及 `pnpm test` 这样的命令。

```ts
export function step6(input: string): number {
  // 第 6 步
  return input.length * 6;
}
```

| 步骤 | 输入 | 输出 |
| :--- | :---: | ---: |
| 6 | `input` | 12 |

### 7. 源码模式要点

这一段是对第 7 个要点的展开说明，包含 **加粗**、*斜体*、`行内代码` 与 [链接](https://example.com/7)。文中还会出现 $x_{7}$ 这样的行内数学，以及 `pnpm test` 这样的命令。

```ts
export function step7(input: string): number {
  // 第 7 步
  return input.length * 7;
}
```

| 步骤 | 输入 | 输出 |
| :--- | :---: | ---: |
| 7 | `input` | 14 |

> 提示：这一条引用是第 7 个要点的补充说明。

### 8. 自动配对要点

这一段是对第 8 个要点的展开说明，包含 **加粗**、*斜体*、`行内代码` 与 [链接](https://example.com/8)。文中还会出现 $x_{8}$ 这样的行内数学，以及 `pnpm test` 这样的命令。

```ts
export function step8(input: string): number {
  // 第 8 步
  return input.length * 8;
}
```

| 步骤 | 输入 | 输出 |
| :--- | :---: | ---: |
| 8 | `input` | 16 |

- 列表项 8
  - 嵌套项 8

## 第 3 部分：实时预览

行内标记会被零宽 widget 顶替，光标进入结构时才显露原文。

### 9. 实时预览要点

这一段是对第 9 个要点的展开说明，包含 **加粗**、*斜体*、`行内代码` 与 [链接](https://example.com/9)。文中还会出现 $x_{9}$ 这样的行内数学，以及 `pnpm test` 这样的命令。

```ts
export function step9(input: string): number {
  // 第 9 步
  return input.length * 9;
}
```

| 步骤 | 输入 | 输出 |
| :--- | :---: | ---: |
| 9 | `input` | 18 |

> 提示：这一条引用是第 9 个要点的补充说明。

- 列表项 9
  - 嵌套项 9

### 10. 源码模式要点

这一段是对第 10 个要点的展开说明，包含 **加粗**、*斜体*、`行内代码` 与 [链接](https://example.com/10)。文中还会出现 $x_{10}$ 这样的行内数学，以及 `pnpm test` 这样的命令。

```ts
export function step10(input: string): number {
  // 第 10 步
  return input.length * 10;
}
```

| 步骤 | 输入 | 输出 |
| :--- | :---: | ---: |
| 10 | `input` | 20 |

### 11. 自动配对要点

这一段是对第 11 个要点的展开说明，包含 **加粗**、*斜体*、`行内代码` 与 [链接](https://example.com/11)。文中还会出现 $x_{11}$ 这样的行内数学，以及 `pnpm test` 这样的命令。

```ts
export function step11(input: string): number {
  // 第 11 步
  return input.length * 11;
}
```

| 步骤 | 输入 | 输出 |
| :--- | :---: | ---: |
| 11 | `input` | 22 |

> 提示：这一条引用是第 11 个要点的补充说明。

### 12. 粘贴要点

这一段是对第 12 个要点的展开说明，包含 **加粗**、*斜体*、`行内代码` 与 [链接](https://example.com/12)。文中还会出现 $x_{12}$ 这样的行内数学，以及 `pnpm test` 这样的命令。

```ts
export function step12(input: string): number {
  // 第 12 步
  return input.length * 12;
}
```

| 步骤 | 输入 | 输出 |
| :--- | :---: | ---: |
| 12 | `input` | 24 |

- 列表项 12
  - 嵌套项 12

## 第 4 部分：源码模式

源码模式与实时预览共用同一个 EditorView，切换只是换装饰器。

### 13. 源码模式要点

这一段是对第 13 个要点的展开说明，包含 **加粗**、*斜体*、`行内代码` 与 [链接](https://example.com/13)。文中还会出现 $x_{13}$ 这样的行内数学，以及 `pnpm test` 这样的命令。

```ts
export function step13(input: string): number {
  // 第 13 步
  return input.length * 13;
}
```

| 步骤 | 输入 | 输出 |
| :--- | :---: | ---: |
| 13 | `input` | 26 |

> 提示：这一条引用是第 13 个要点的补充说明。

- 列表项 13
  - 嵌套项 13

### 14. 自动配对要点

这一段是对第 14 个要点的展开说明，包含 **加粗**、*斜体*、`行内代码` 与 [链接](https://example.com/14)。文中还会出现 $x_{14}$ 这样的行内数学，以及 `pnpm test` 这样的命令。

```ts
export function step14(input: string): number {
  // 第 14 步
  return input.length * 14;
}
```

| 步骤 | 输入 | 输出 |
| :--- | :---: | ---: |
| 14 | `input` | 28 |

### 15. 粘贴要点

这一段是对第 15 个要点的展开说明，包含 **加粗**、*斜体*、`行内代码` 与 [链接](https://example.com/15)。文中还会出现 $x_{15}$ 这样的行内数学，以及 `pnpm test` 这样的命令。

```ts
export function step15(input: string): number {
  // 第 15 步
  return input.length * 15;
}
```

| 步骤 | 输入 | 输出 |
| :--- | :---: | ---: |
| 15 | `input` | 30 |

> 提示：这一条引用是第 15 个要点的补充说明。

### 16. 文件管理要点

这一段是对第 16 个要点的展开说明，包含 **加粗**、*斜体*、`行内代码` 与 [链接](https://example.com/16)。文中还会出现 $x_{16}$ 这样的行内数学，以及 `pnpm test` 这样的命令。

```ts
export function step16(input: string): number {
  // 第 16 步
  return input.length * 16;
}
```

| 步骤 | 输入 | 输出 |
| :--- | :---: | ---: |
| 16 | `input` | 32 |

- 列表项 16
  - 嵌套项 16

## 第 5 部分：自动配对

输入左括号自动补右括号，星号连敲两次会从斜体升级成粗体。

### 17. 自动配对要点

这一段是对第 17 个要点的展开说明，包含 **加粗**、*斜体*、`行内代码` 与 [链接](https://example.com/17)。文中还会出现 $x_{17}$ 这样的行内数学，以及 `pnpm test` 这样的命令。

```ts
export function step17(input: string): number {
  // 第 17 步
  return input.length * 17;
}
```

| 步骤 | 输入 | 输出 |
| :--- | :---: | ---: |
| 17 | `input` | 34 |

> 提示：这一条引用是第 17 个要点的补充说明。

- 列表项 17
  - 嵌套项 17

### 18. 粘贴要点

这一段是对第 18 个要点的展开说明，包含 **加粗**、*斜体*、`行内代码` 与 [链接](https://example.com/18)。文中还会出现 $x_{18}$ 这样的行内数学，以及 `pnpm test` 这样的命令。

```ts
export function step18(input: string): number {
  // 第 18 步
  return input.length * 18;
}
```

| 步骤 | 输入 | 输出 |
| :--- | :---: | ---: |
| 18 | `input` | 36 |

### 19. 文件管理要点

这一段是对第 19 个要点的展开说明，包含 **加粗**、*斜体*、`行内代码` 与 [链接](https://example.com/19)。文中还会出现 $x_{19}$ 这样的行内数学，以及 `pnpm test` 这样的命令。

```ts
export function step19(input: string): number {
  // 第 19 步
  return input.length * 19;
}
```

| 步骤 | 输入 | 输出 |
| :--- | :---: | ---: |
| 19 | `input` | 38 |

> 提示：这一条引用是第 19 个要点的补充说明。

### 20. 导出要点

这一段是对第 20 个要点的展开说明，包含 **加粗**、*斜体*、`行内代码` 与 [链接](https://example.com/20)。文中还会出现 $x_{20}$ 这样的行内数学，以及 `pnpm test` 这样的命令。

```ts
export function step20(input: string): number {
  // 第 20 步
  return input.length * 20;
}
```

| 步骤 | 输入 | 输出 |
| :--- | :---: | ---: |
| 20 | `input` | 40 |

- 列表项 20
  - 嵌套项 20

## 第 6 部分：粘贴

从网页复制过来的富文本会被转成 Markdown，脚本与样式表会被剥掉。

### 21. 粘贴要点

这一段是对第 21 个要点的展开说明，包含 **加粗**、*斜体*、`行内代码` 与 [链接](https://example.com/21)。文中还会出现 $x_{21}$ 这样的行内数学，以及 `pnpm test` 这样的命令。

```ts
export function step21(input: string): number {
  // 第 21 步
  return input.length * 21;
}
```

| 步骤 | 输入 | 输出 |
| :--- | :---: | ---: |
| 21 | `input` | 42 |

> 提示：这一条引用是第 21 个要点的补充说明。

- 列表项 21
  - 嵌套项 21

### 22. 文件管理要点

这一段是对第 22 个要点的展开说明，包含 **加粗**、*斜体*、`行内代码` 与 [链接](https://example.com/22)。文中还会出现 $x_{22}$ 这样的行内数学，以及 `pnpm test` 这样的命令。

```ts
export function step22(input: string): number {
  // 第 22 步
  return input.length * 22;
}
```

| 步骤 | 输入 | 输出 |
| :--- | :---: | ---: |
| 22 | `input` | 44 |

### 23. 导出要点

这一段是对第 23 个要点的展开说明，包含 **加粗**、*斜体*、`行内代码` 与 [链接](https://example.com/23)。文中还会出现 $x_{23}$ 这样的行内数学，以及 `pnpm test` 这样的命令。

```ts
export function step23(input: string): number {
  // 第 23 步
  return input.length * 23;
}
```

| 步骤 | 输入 | 输出 |
| :--- | :---: | ---: |
| 23 | `input` | 46 |

> 提示：这一条引用是第 23 个要点的补充说明。

### 24. 安装与配置要点

这一段是对第 24 个要点的展开说明，包含 **加粗**、*斜体*、`行内代码` 与 [链接](https://example.com/24)。文中还会出现 $x_{24}$ 这样的行内数学，以及 `pnpm test` 这样的命令。

```ts
export function step24(input: string): number {
  // 第 24 步
  return input.length * 24;
}
```

| 步骤 | 输入 | 输出 |
| :--- | :---: | ---: |
| 24 | `input` | 48 |

- 列表项 24
  - 嵌套项 24

## 附录

| 名称 | 版本 | 说明 |
| :--- | :---: | :--- |
| Tauri | 2.12 | 外壳 |
| CodeMirror | 6.43 | 编辑内核 |
| remark | 11.0 | 解析层 |

脚注在这里[^1]。

[^1]: 脚注的内容。

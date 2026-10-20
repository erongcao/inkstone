---
title: 数学与图表
author: Inkstone
category: 学术写作
tags: [数学, 图表, LaTeX]
date: 2026-10-20
---

# 数学与图表

## 行内数学

质能方程 $E = mc^2$，欧拉恒等式 $e^{i\pi} + 1 = 0$。

带上下标的公式：$a_1 + a_2 = b_n$。

行内公式里可以有中文：$f(x) = \text{中文测试}$。

## 数学块

$$
\begin{align}
y = y(x,t) &= A e^{i\theta} \\
&= A (\cos \theta + i \sin \theta) \\
&= A\cos(kx - \omega t) + i A\sin(kx - \omega t)
\end{align}
$$

行间公式（单行）：

$$\frac{\partial X}{\partial u} = \frac{\partial Y}{\partial u} = 0$$

带编号的公式：

$$
x + 1 \over \sqrt{1-x^2} \label{ref1} \tag{1}
$$

这是一个引用：$\ref{ref1}$。

## 化学公式

$\ce{CH4 + 2 O2 -> CO2 + 2 H2O}$

## Mermaid 图表

```mermaid
graph TD
    A[开始] --> B{判断条件}
    B -->|是| C[执行动作]
    B -->|否| D[跳过]
    C --> E[结束]
    D --> E
```

```mermaid
sequenceDiagram
    participant U as 用户
    participant E as 编辑器
    participant F as 文件系统
    U->>E: 输入内容
    E->>F: 自动保存
    F-->>E: 确认
    E-->>U: 显示已保存
```

```mermaid
gantt
    title 项目排期
    dateFormat YYYY-MM-DD
    section 阶段
    M0 地基       :done,    m0, 2026-10-01, 7d
    M1 编辑内核   :active,  m1, 2026-10-08, 42d
    M2 写作体验   :         m2, after m1, 28d
```

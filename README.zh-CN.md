# Prompter

<p align="center">
  <a href="./README.md"><strong>English</strong></a> | <a href="./README.zh-CN.md"><strong>简体中文</strong></a>
</p>

<p align="center">
  <img src="icon.png" width="160" alt="Prompter 图标" />
</p>

<p align="center">
  一个面向 VS Code 的实用 Prompt 工作区。
</p>

<p align="center">
  更快地收集上下文、更高质量地组织 Prompt、复用高频提示词结构，并把 Prompt 历史沉淀下来。
</p>

Prompter 是为每天都在 VS Code 里和 AI 协作的用户设计的。

它不只是一个输入框，而是一个专门的 Prompt 工作区。你可以在这里收集代码上下文、导入文件路径和终端输出、组织 Prompt 状态、复用模块化片段，并持续回看历史 Prompt。

它尤其适合搭配 Codex、Claude Code、Roo Code、Cursor 等 AI 编码工具一起使用。

## 目录

- [为什么需要 Prompter](#为什么需要-prompter)
- [核心功能](#核心功能)
- [命令与快捷键](#命令与快捷键)
- [一个典型工作流](#一个典型工作流)
- [会话同步](#会话同步)
- [设置与存储](#设置与存储)
- [适合哪些用户](#适合哪些用户)

## 为什么需要 Prompter

Prompt 工作天然是高频、重复、分散的。

在没有专门工作流时，你往往需要反复做这些事：

- 把代码片段复制进 AI 对话
- 手动补文件路径
- 从终端复制报错和输出
- 一遍遍重写相似的 Prompt 结构
- 一个好 Prompt 用完就丢
- 分不清哪些 Prompt 还在进行中，哪些已经结束

Prompter 的目标就是把这些零散操作，收敛成一个清晰的 VS Code 内部工作流。

它要解决的是四件事：

- 降低上下文切换
- 降低重复 Prompt 准备成本
- 提高 Prompt 的复用率
- 让 Prompt 使用记录持续可见

## 核心功能

### 独立 Prompt 工作区

执行 `Prompter: Open` 后，会打开主工作区。

在这里你可以：

- 先整理 Prompt，再发送给 AI 工具
- 按 `Unused`、`Active`、`Completed` 管理卡片
- 重新打开旧 Prompt 并继续编辑
- 让当天的 Prompt 工作保持有序，而不是散落在多个聊天窗口里

### 快速导入上下文

Prompter 最实用的一点，是它把上下文收集做得足够快。

你可以直接导入：

- 当前编辑器选区
- 资源管理器中的文件或文件夹路径
- 当前终端选中内容
- 拖入编辑区的文件路径

这能明显减少手工复制、补格式和遗漏上下文的情况。

### 手动确认后即可复制使用

当你在工作区里手动确认一个 Prompt 时：

- 该 Prompt 会被保存成卡片
- 内容会自动复制到剪贴板
- 界面会给出明确的复制反馈

这很适合“在本地整理 Prompt，再粘贴到外部 AI 工具”的使用方式。

### 模块化 Prompt 片段复用

Prompter 支持沉淀和复用高频 Prompt 结构。

你可以把常用片段保存下来，例如：

- 调试
- 代码审查
- 方案规划
- 结果总结
- 根因分析

这样你最有效的 Prompt 模板就不会停留在一次性文本，而会变成长期可复用的模块。

### Prompt 历史与每日回看

`History` 页面可以把 Prompt 变成真正可回看的资产。

你可以：

- 按日期浏览 Prompt
- 用热力图查看每日活跃情况
- 查看不同状态下的 Prompt 数量
- 重新复制旧 Prompt
- 按来源和分组回溯上下文

### 内置快捷键管理

Prompter 提供专门的 `Shortcuts` 页面，不需要你自己去编辑 `keybindings.json`。

你可以：

- 查看当前快捷键
- 直接录制新的快捷键
- 恢复默认值
- 让不同导入动作在不同上下文中保持一致体验

### 左侧 Activity Bar 入口

Prompter 会在 VS Code 左侧 Activity Bar 增加一个独立图标。

它为用户提供了一个稳定入口，方便快速打开主工作区。

## 命令与快捷键

| 命令 | 作用 | 默认快捷键 |
| --- | --- | --- |
| `Prompter: Open` | 打开 Prompter 工作区 | `Ctrl+E` |
| `Prompter: Open Shortcuts` | 打开内置快捷键页面 | 无 |
| `Prompter: Import Selection to Prompt` | 导入当前编辑器选区 | `Ctrl+Shift+F` |
| `Prompter: Add Resource to Prompt` | 导入资源管理器中选中的资源 | `Ctrl+Shift+F` |
| `Prompter: Import Terminal Selection` | 导入当前终端选中内容 | `Ctrl+Shift+F` |

说明：

- 三个导入命令默认共用同一快捷键，因为它们运行在不同上下文中。
- 所有快捷键都可以在内置 `Shortcuts` 页面中调整。

## 一个典型工作流

一个很实用的日常使用流程通常是：

1. 打开 `Prompter: Open`。
2. 导入当前要讨论的代码选区。
3. 需要时补充文件路径和终端输出。
4. 插入常用 Prompt 片段，例如 review、debug、plan、summary。
5. 确认 Prompt，并直接复制出去。
6. 粘贴到 Codex、Claude Code、Cursor、Roo Code 或其它 AI 工具中。

Prompter 的价值不只是“多一个面板”。

它真正的价值，是让 Prompt 工作更快、更清晰、更可复用。

## 会话同步

Prompter 可以从支持的外部日志来源同步 Prompt 活动：

- Claude Code
- Codex
- Roo Code

这意味着工作区和历史页不只反映手动草稿，也能反映外部 agent 会话中的 Prompt 轨迹。

它可以帮助你追踪：

- 按 session 导入的 Prompt
- Prompt 状态变化
- 已完成 Prompt
- session 分组
- 按日期沉淀的 Prompt 历史

如果你的部分工作流发生在外部 agent 环境里，但你仍希望在 VS Code 中统一回看 Prompt 轨迹，这会非常有价值。

## 设置与存储

`Settings` 页面可以配置：

- 语言
- 主题模式
- 默认导入路径格式
- 完成通知
- 完成提示音
- 数据目录
- 日志来源路径和开关
- 切换目录时是否迁移已有数据

Prompter 默认将数据存储在 `~/prompter`。

主要文件包括：

- `cards.json`
- `modular-prompts.json`
- `daily-stats.json`
- `settings.json`
- `session-groups.json`

## 适合哪些用户

Prompter 适合这类用户：

- 经常给编码 Agent 写 Prompt
- 经常复用相似 Prompt 结构
- 需要从代码、文件和终端快速搬运上下文
- 希望更清楚地看到 Prompt 当前状态
- 不希望 Prompt 在会话结束后就完全丢失

## 相关链接

- GitHub：<https://github.com/hzxwonder/Prompter>
- English README：[README.md](./README.md)

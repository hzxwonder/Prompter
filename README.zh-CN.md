# Prompter

<p align="center">
  <a href="./README.md">English</a> | <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img src="icon.png" width="160" alt="Prompter 图标" />
</p>

<p align="center">
  在 VS Code 里，更快地整理上下文、拼装 Prompt、复用高价值提示词。
</p>

Prompter 把 Prompt 工作变成一个真正可管理的编辑器流程。你不需要再频繁手动复制代码、文件路径、终端输出，也不需要一遍遍重写已经验证过的提示词结构。它提供一个独立工作区，用来集中收集上下文、组合 Prompt、复用模块片段，并持续回看你已经使用过的 Prompt。

它尤其适合经常配合 Codex、Claude Code、Roo Code、Cursor 等 AI 编码工具工作的用户。

## 目录

- [为什么需要 Prompter](#为什么需要-prompter)
- [你可以用它做什么](#你可以用它做什么)
- [命令与快捷键](#命令与快捷键)
- [典型工作流](#典型工作流)
- [会话同步与历史回看](#会话同步与历史回看)
- [可配置项](#可配置项)
- [数据存储](#数据存储)

## 为什么需要 Prompter

Prompter 解决的是一个很具体的问题：Prompt 工作频率高、重复多、上下文分散。

在没有专门工作流时，你经常需要手动做这些事：

- 复制一段代码到 AI 对话中
- 再去找对应文件路径贴进去
- 手动搬运终端输出
- 反复重写相似的 Prompt 结构
- 今天写过的好 Prompt 明天就找不到
- 不清楚哪些 Prompt 还在使用中，哪些已经结束

Prompter 的目标就是把这些重复劳动压缩到一个工作区里。

## 你可以用它做什么

### 1. 在独立 Prompt 工作区里组织你的任务

执行 `Prompter: Open` 后，可以进入主工作区。

在这里你可以：

- 先整理 Prompt，再发送到外部 AI 工具
- 按 `Unused`、`Active`、`Completed` 管理卡片
- 重新打开和修改已有 Prompt
- 把 Prompt 从一次性输入变成可追踪、可回看的工作流

### 2. 直接从编辑器导入上下文

Prompter 最实用的地方之一，是让上下文收集变得足够快。

你可以直接导入：

- 编辑器当前选区
- 资源管理器中的文件或文件夹路径
- 当前终端选中内容
- 拖放进编辑区的文件路径

这样做的好处很直接：少复制、少补格式、少漏上下文。

### 3. 复用模块化 Prompt 片段

如果你有一批高频使用的 Prompt 结构，比如代码审查、问题定位、方案规划、结果总结，就可以把它们保存成模块片段，后续直接插入，而不是每次从头写。

例如：

- `#root-cause`
- `#review`
- `#plan`
- `#summary`

### 4. 手动确认后即可直接复制使用

当你在工作区里手动确认一个 Prompt 时：

- 它会被保存成卡片
- 内容会自动复制到剪贴板
- 界面会明确提示复制成功

这很适合“本地整理，外部发送”的工作方式。

### 5. 追踪不同 session 中的 Prompt 状态

Prompter 可以同步外部 agent 日志中的 Prompt 活动，目前支持：

- Claude Code
- Codex
- Roo Code

这意味着它不只记录你手动输入的 Prompt，也可以帮你跟踪会话中的 Prompt 使用状态、完成状态和分组历史。

### 6. 保留历史，而不是让 Prompt 一次性消失

`History` 页面用来把 Prompt 变成可回看的资产。

你可以：

- 按日期查看 Prompt
- 用热力图快速定位高频使用日
- 查看不同状态的 Prompt 数量
- 把历史 Prompt 再次复制出来继续使用
- 按来源和 session 分组回溯上下文

### 7. 在插件内部直接管理快捷键

Prompter 内置 `Shortcuts` 页面，不需要你手动翻 `keybindings.json`。

你可以：

- 查看当前快捷键
- 直接录制新的快捷键
- 一键恢复默认值
- 让导入类命令在不同上下文中保持一致的操作习惯

## 命令与快捷键

| 命令 | 作用 | 默认快捷键 |
| --- | --- | --- |
| `Prompter: Open` | 打开 Prompter 主工作区 | `Ctrl+E` |
| `Prompter: Open Shortcuts` | 打开快捷键页面 | 无 |
| `Prompter: Import Selection to Prompt` | 导入当前编辑器选区 | `Ctrl+Shift+F` |
| `Prompter: Add Resource to Prompt` | 导入资源管理器中选中的资源 | `Ctrl+Shift+F` |
| `Prompter: Import Terminal Selection` | 导入当前终端选中内容 | `Ctrl+Shift+F` |

说明：

- 三个导入命令默认共用同一快捷键，因为它们分别运行在不同上下文中。
- 这些快捷键都可以在内置 `Shortcuts` 页面中调整。

## 典型工作流

一个很实用的日常流程通常是：

1. 打开 `Prompter: Open`。
2. 从编辑器导入要讨论的代码。
3. 需要时补充文件路径和终端输出。
4. 插入常用模块片段，例如 review、plan、summary。
5. 确认 Prompt，并直接复制出来。
6. 粘贴到 Codex、Claude Code、Cursor、Roo Code 或其它 AI 工具中使用。

Prompter 的价值不在于“多一个面板”，而在于减少上下文切换、减少重复劳动、提升 Prompt 的复用率。

## 会话同步与历史回看

Prompter 可以监听支持的日志来源，并把这些 Prompt 活动同步回工作区。

它支持的能力包括：

- imported prompt 的 session 分组
- Prompt 状态自动流转
- Prompt 完成状态追踪
- 按日期和来源进行历史回看

如果你的部分工作流发生在外部 agent 环境中，但你仍希望在 VS Code 里统一回看和管理 Prompt，这一点会非常实用。

## 可配置项

`Settings` 页面里可以配置：

- 语言
- 主题模式
- 默认导入路径格式
- 完成通知
- 完成提示音
- 数据目录
- 切换目录时是否迁移已有数据
- Claude Code、Codex、Roo Code 的日志开关与路径

## 数据存储

Prompter 默认将数据存储在 `~/prompter`。

主要文件包括：

- `cards.json`
- `modular-prompts.json`
- `daily-stats.json`
- `settings.json`
- `session-groups.json`

## 相关链接

- GitHub：<https://github.com/hzxwonder/Prompter>
- English README：[README.md](./README.md)

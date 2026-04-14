# Prompter

<p align="center">
  <a href="./README.md"><strong>English</strong></a> | <a href="./README.zh-CN.md"><strong>简体中文</strong></a>
</p>

<p align="center">
  <img src="icon.png" width="160" alt="Prompter 图标" />
</p>

<p align="center">
  一个面向 VS Code 的高质量 Prompt 工作台，把日常 Prompt 编写、投递、追踪与回看整合成一个完整工作流。
</p>

<p align="center">
  更快地整理上下文，一键复制可用 Prompt，实时追踪 Claude Code / Codex / Roo Code 的执行状态，并把 Prompt 历史沉淀下来。
</p>

Prompter 是为每天都在 VS Code 里和 AI 协作的用户设计的。

它不只是一个输入框，而是一个真正产品化的 Prompt 工作区：你可以在这里编写 Prompt、收集上下文、管理 Prompt 卡片、监控外部会话、回看历史记录，并通过快捷键把这些动作融入日常开发流。

它尤其适合搭配 Claude Code、Codex、Roo Code、Cursor 等 AI 编码工具一起使用。

## 目录

- [为什么需要 Prompter](#为什么需要-prompter)
- [功能亮点](#功能亮点)
- [产品页面导览](#产品页面导览)
  - [工作台 Workspace](#工作台-workspace)
  - [Prompt 状态区 Prompt Status](#prompt-状态区-prompt-status)
  - [历史页 History](#历史页-history)
  - [快捷键页 Shortcuts](#快捷键页-shortcuts)
  - [设置页 Settings](#设置页-settings)
- [外部会话同步](#外部会话同步)
- [命令与默认快捷键](#命令与默认快捷键)
- [数据存储](#数据存储)
- [本地开发](#本地开发)
- [相关链接](#相关链接)

## 为什么需要 Prompter

Prompt 工作天然是高频、重复、分散的。

在没有专门工作流时，你往往需要反复做这些事：

- 把代码片段复制进 AI 对话
- 手动补文件路径
- 从终端复制报错和输出
- 一遍遍重写相似的 Prompt 结构
- 分不清哪些 Prompt 仍在执行，哪些已经结束
- 一个好 Prompt 用完就丢，后面很难回看

Prompter 的目标，就是把这些零散操作收敛成一个清晰、稳定、可复用的 VS Code 内部工作流。

## 功能亮点

- **先整理，再发送。** 在独立工作台中完成 Prompt 编写，而不是边想边往外部 AI 聊天框里贴。
- **确认即保存，确认即复制。** 点击确认后，Prompt 会进入 `Unused` 分区，同时自动复制到剪贴板。
- **灵感不中断。** 随时新建空白草稿，当前内容会先落到 `Unused`，便于后续继续编辑。
- **Prompt 生命周期一目了然。** 通过 `Unused`、`In Progress`、`Completed` 三个分区组织当前工作。
- **外部会话状态可追踪。** 自动识别 Claude Code、Codex、Roo Code 中正在运行的 Prompt，并在完成时给出提醒。
- **历史记录真正可回看。** 用类似 GitHub 的热力图视图沉淀每天的 Prompt 活动。

## 产品页面导览

### 工作台 Workspace

`Workspace` 是你开始编写 Prompt 的主入口。

<p align="center">
  <img src="./assets/workspace.png" alt="Prompter 工作台编辑区" />
</p>

这个页面主要负责 Prompt 编写与草稿管理，你可以在这里：

- 使用 Markdown 编写 Prompt
- 点击 **Confirm / 确认**，将当前 Prompt 保存到 `Unused` 分区，并自动复制到剪贴板
- 点击垃圾桶按钮，直接清空当前编辑区内容
- 点击空白页按钮，快速开始一个新草稿，并把当前内容先保存到 `Unused`
- 通过编辑器选区、资源管理器文件/文件夹、终端选区，把上下文快速导入到编辑区
- 把 Prompt 准备工作留在 VS Code 内完成，减少在多个聊天窗口之间来回切换

这个页面解决的是“发出去之前”的所有准备动作。

### Prompt 状态区 Prompt Status

在编辑区下方，Prompter 提供了专门的 `Prompt Status` 区域，用来管理 Prompt 卡片。

<p align="center">
  <img src="./assets/prompt-status.png" alt="Prompter Prompt 状态区" />
</p>

这个区域主要负责 Prompt 卡片管理与执行追踪，你可以在这里：

- 使用 **Board** 或 **List** 两种视图查看 Prompt
- 单击 Prompt 卡片，快速再次复制内容
- 双击 Prompt 卡片，把内容重新放回编辑区继续编辑
- 拖拽 Prompt 卡片，在 `Unused`、`In Progress`、`Completed` 之间切换分区
- 将 Prompt 卡片拖拽到删除区域，快速删除
- 修改卡片上的分组名称；对于导入型 Prompt，分组默认是当前 session 的标识，修改后同一 session 的分组名会同步更新
- 当 Prompt 过长时，点击展开按钮查看完整内容
- 从 Prompt 卡片直接跳转回对应的 Claude Code、Codex 或 Roo Code 会话

此外，当你把 Prompt 粘贴到 Claude Code 或 Codex 中执行后，Prompter 可以自动识别正在运行的 Prompt，并在执行完成后：

- 弹出提示通知
- 根据设置播放提示音
- 高亮对应卡片，直到你主动点击确认

这个区域解决的是“发出去之后”的状态管理问题。

### 历史页 History

`History` 页面负责沉淀和回看历史 Prompt。

<p align="center">
  <img src="./assets/history.png" alt="Prompter 历史页" />
</p>

这个页面主要负责 Prompt 历史检索与回看，你可以在这里：

- 用类似 GitHub Contribution Graph 的热力图查看每日 Prompt 活跃情况
- 点击具体日期，查看当天的 Prompt 明细
- 按 session 分组查看历史 Prompt，让同一轮对话更清晰
- 按 `Unused`、`In Progress`、`Completed` 过滤当天记录
- 展开较长的 Prompt 内容进行阅读
- 一键复制历史 Prompt，重新投入使用
- 查看关联的文件路径和行号范围，方便回溯上下文来源

这个页面解决的是“事后回看”和“经验复用”的问题。

### 快捷键页 Shortcuts

`Shortcuts` 页面提供了内置的快捷键管理能力，不需要手动编辑 `keybindings.json`。

这个页面主要负责快捷键配置，你可以在这里：

- 查看当前 Prompter 命令的快捷键配置
- 直接录制新的快捷键
- 将任意命令恢复为默认快捷键
- 让打开工作台、导入选区、导入文件/文件夹、导入终端选区这些高频动作更顺手

当前快捷键页主要覆盖四类核心操作：

- 一键打开 Prompter
- 将当前编辑器选区导入 Prompt 编辑区
- 将资源管理器中的文件或文件夹导入 Prompt 编辑区
- 将当前终端选区导入 Prompt 编辑区

### 设置页 Settings

`Settings` 页面用于配置 Prompter 的行为与运行环境。

这个页面主要负责产品配置，你可以在这里设置：

- 界面语言
- 主题模式
- 默认导入路径格式
- Prompt 完成通知
- 完成提示音，以及自定义音频文件路径
- 数据存储目录
- Claude Code、Codex、Roo Code 的日志路径与开关
- 切换数据目录时是否迁移已有数据
- 清理本地缓存数据

这个页面让 Prompter 可以适配不同机器、不同日志布局和不同提醒偏好。

## 外部会话同步

Prompter 支持从外部编码 Agent 日志中导入 Prompt 活动。

当前支持的来源包括：

- Claude Code
- Codex
- Roo Code

当你在 `Settings` 中启用对应日志源并配置路径后，Prompter 可以：

- 自动识别这些会话中的 Prompt
- 按 session 对导入 Prompt 进行分组
- 在工作台中展示正在运行的 Prompt
- 在源会话执行结束后自动将 Prompt 标记为完成
- 对刚完成的 Prompt 进行高亮，等待用户确认
- 从卡片直接跳回对应的外部会话

这也是 Prompter 与普通草稿工具最大的区别：它不仅帮助你“写 Prompt”，还帮助你“跟踪 Prompt 的后续执行结果”。

## 命令与默认快捷键

| 命令 | 作用 | 默认快捷键 |
| --- | --- | --- |
| `Prompter: Open` | 打开 Prompter 工作区 | `Ctrl+E` |
| `Prompter: Open Shortcuts` | 打开内置快捷键页面 | 无 |
| `Prompter: Import Selection to Prompt` | 导入当前编辑器选区 | `Ctrl+Shift+F` |
| `Prompter: Add Resource to Prompt` | 导入资源管理器中选中的文件或文件夹 | `Ctrl+Shift+F` |
| `Prompter: Import Terminal Selection` | 导入当前终端选中内容 | `Ctrl+Shift+F` |

说明：

- 三个导入命令默认共用同一快捷键，因为它们运行在不同上下文中。
- Prompter 也会在 VS Code Activity Bar 提供独立入口，方便随时打开。

## 数据存储

Prompter 默认将数据存储在 `~/prompter`。

主要文件包括：

- `cards.json`
- `modular-prompts.json`
- `daily-stats.json`
- `settings.json`
- `session-groups.json`
- `modular-prompts.json`


## 相关链接

- GitHub：<https://github.com/hzxwonder/Prompter>
- English README：[README.md](./README.md)
- License：[LICENSE.md](./LICENSE.md)

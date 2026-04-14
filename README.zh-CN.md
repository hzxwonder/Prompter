# Prompter

<p align="center">
  <img src="https://via.placeholder.com/500" width="300" alt="示例图"/>
</p>

Prompter 是一个面向日常 AI 协作工作流的 VS Code 插件。它的核心目标很直接：把“找上下文、拼 Prompt、保存草稿、回看历史、重复利用高频片段”这些本来零散又高频的动作，收进同一个工作面板里。

它不是一个“再来一个输入框”的插件，而是一个更适合长期使用的 Prompt 工作区。

## 这个插件解决什么问题

如果你平时会在 VS Code 里反复做这些事：

- 选代码片段复制到 AI 对话
- 在资源管理器里找文件路径再贴进去
- 从终端里复制报错或输出
- 把常用指令模板一遍遍重写
- 写过的 Prompt 第二天就找不到
- 想统一快捷键，但每个入口都分散在不同地方

Prompter 的作用就是把这些步骤压缩掉。

## 主要功能

### 1. 统一的 Prompt 工作区

执行 `Prompter: Open` 后，会打开 Prompter 面板。这里是插件的主工作台：

- 在一个地方整理今天正在使用的 Prompt
- 把草稿卡片分为 `Unused`、`Active`、`Completed`
- 双击已有卡片继续编辑
- 通过拖拽或操作按钮切换状态
- 手动确认后将 Prompt 保存到工作区

### 2. 从编辑器、文件树、终端快速导入上下文

Prompter 最实用的能力之一，是把“上下文搬运”做成了几个很顺手的入口：

- 编辑器选区：把当前选中的代码直接导入 Prompt
- 资源管理器：把文件或资源路径加入 Prompt
- 终端：把当前终端选中的输出导入 Prompt
- 文本框拖放：可把文件路径拖进编辑区，快速生成引用

这样你不需要来回复制、整理格式、再手工补路径。

### 3. 手动提交后自动复制

当你在 Workspace 里点击确认，手动保存当前 Prompt 时：

- 内容会被保存为卡片
- Prompt 会自动复制到剪贴板
- 界面会明确反馈复制成功

这一步非常适合“在本地整理，在外部 AI 工具里立刻粘贴发送”的工作流。

### 4. 模块化 Prompt 片段复用

你可以把高频使用的提示词片段保存成可复用模块，例如：

- `#root-cause`
- `#plan`
- `#review`
- `#summary`

这些模块适合沉淀你的固定思路，而不是每次从头写。

### 5. History 页面回看 Prompt 使用记录

Prompter 不只是保存当前草稿，也会保留历史：

- 按日期查看 Prompt 活动
- 用热力图快速看每天使用情况
- 查看当天不同状态下的 Prompt 数量
- 复制历史 Prompt 内容
- 结合来源和分组快速回溯上下文

### 6. Shortcuts 页面直接管理快捷键

Prompter 内置了专门的 `Shortcuts` 页面，不需要你自己去翻 `keybindings.json`。

你可以：

- 查看核心命令的当前快捷键
- 直接录制新的快捷键
- 重置为默认值
- 把导入类命令统一成同一套快捷键

插件会把这些设置写入 VS Code / Cursor 的用户快捷键配置中。

### 7. 左侧 Activity Bar 入口

Prompter 会在 VS Code 左侧工具栏中增加专属入口图标。

你可以从这里快速：

- 打开主工作区
- 导入当前选区
- 直接进入快捷键管理

### 8. 设置页管理数据目录、通知和日志来源

在 `Settings` 页面里可以直接调整：

- 界面语言
- 主题模式
- 默认导入路径格式（相对路径 / 绝对路径）
- 完成通知
- 完成提示音
- 数据目录位置
- 切换数据目录时是否迁移已有数据
- Claude Code / Codex / Roo Code 的日志来源开关与路径

Prompter 会根据这些日志来源持续同步外部会话里的 Prompt 变化，把它们纳入你的工作区和历史记录中。

## 命令与默认快捷键

| 命令 | 说明 | 默认快捷键 |
| --- | --- | --- |
| `Prompter: Open` | 打开 Prompter 面板 | `Ctrl+E` |
| `Prompter: Open Shortcuts` | 打开 Prompter 内的快捷键页面 | 无 |
| `Prompter: Import Selection to Prompt` | 导入当前编辑器选区 | `Ctrl+Shift+F` |
| `Prompter: Add Resource to Prompt` | 导入资源管理器中的文件/资源 | `Ctrl+Shift+F` |
| `Prompter: Import Terminal Selection` | 导入终端当前选中内容 | `Ctrl+Shift+F` |

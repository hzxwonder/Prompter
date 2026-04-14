# Prompter

<p align="center">
  <img src="icon.png" width="300" alt="示例图"/>
</p>

Prompter is a VS Code extension for one practical job: collecting context, shaping prompts, and keeping prompt work reusable instead of disposable.

Instead of constantly copying code, file paths, and terminal output into AI tools by hand, you get one workspace to prepare better prompts, reuse prompt snippets, manage shortcuts, and review history.

## Why Prompter is useful

Prompter is built for people who regularly do all of these inside VS Code:

- copy code selections into AI chats
- add file paths as context
- paste terminal output into prompts
- rewrite the same prompt structures again and again
- lose good prompts after one use
- want a faster prompt workflow without leaving the editor

The extension reduces that overhead by making prompt preparation a first-class workflow.

## Key features

### 1. A dedicated prompt workspace

Run `Prompter: Open` to open the main Prompter panel.

Inside the workspace you can:

- draft and refine prompts in one place
- organize prompt cards into `Unused`, `Active`, and `Completed`
- reopen existing cards for editing
- move cards through your workflow
- keep today's prompt work visible instead of scattered across tools

### 2. Fast context import from the editor, Explorer, and terminal

This is one of the extension's most practical features.

Prompter lets you import context directly from:

- the current editor selection
- a file or resource in Explorer
- the current terminal selection
- dropped file paths inside the composer

That means less manual copying, less formatting work, and fewer missing references in the final prompt.

### 3. Copy-ready prompts after manual submit

When you manually confirm a prompt from the workspace:

- the prompt is saved as a card
- the prompt content is copied to your clipboard
- the UI gives you explicit copy-success feedback

This is especially useful if your workflow is "prepare locally, send in another AI tool immediately."

### 4. Reusable modular prompt snippets

Prompter supports modular prompt building, so you can save reusable pieces such as:

- `#root-cause`
- `#review`
- `#plan`
- `#summary`

This is ideal for people who already have stable prompt patterns and want to stop rewriting them.

### 5. Prompt history with daily activity review

The `History` page helps you look back instead of losing prior work.

You can:

- browse prompt activity by day
- use a heatmap to spot active days quickly
- inspect prompt counts by status
- copy historical prompt content
- review prompts by source and grouping

### 6. Built-in shortcut management

Prompter includes a dedicated `Shortcuts` page, so shortcut management is part of the product instead of a hidden config chore.

You can:

- see the current bindings for the core commands
- record a new shortcut directly in the UI
- reset any command to its default binding
- let the import commands share one shortcut across different contexts

Prompter writes those bindings to the user keybindings used by VS Code or Cursor.

### 7. Activity Bar entry on the left

Prompter adds a dedicated icon to the VS Code Activity Bar.

From there you can quickly:

- open the main Prompter workspace
- import the current selection
- jump straight to shortcut management

### 8. Settings for storage, notifications, and log sources

The `Settings` page lets you control:

- language
- theme mode
- default import path style
- completion notifications
- completion sound
- data directory
- whether to migrate existing data when switching directories
- log source paths and toggles for Claude Code, Codex, and Roo Code

Prompter uses those log sources to sync prompt activity from external coding-agent workflows back into your workspace and history view.

## Commands and default shortcuts

| Command | What it does | Default shortcut |
| --- | --- | --- |
| `Prompter: Open` | Open the Prompter panel | `Ctrl+E` |
| `Prompter: Open Shortcuts` | Open the shortcuts page inside Prompter | None |
| `Prompter: Import Selection to Prompt` | Import the current editor selection | `Ctrl+Shift+F` |
| `Prompter: Add Resource to Prompt` | Import the selected file or resource from Explorer | `Ctrl+Shift+F` |
| `Prompter: Import Terminal Selection` | Import the current terminal selection | `Ctrl+Shift+F` |

Notes:

- The import commands intentionally share the same default shortcut because they run in different contexts.
- If the defaults do not fit your workflow, you can change them from the built-in `Shortcuts` page.

## A practical daily workflow

One effective way to use Prompter is:

1. Open `Prompter: Open`
2. import a code selection from the editor
3. add a file path or terminal output if you need more context
4. combine reusable prompt snippets
5. confirm and save the prompt
6. paste it directly into the AI tool you are using

The real value is not "another panel." The value is reducing context switching, repetitive prompt prep, and lost prompt history.

## Data storage

By default, Prompter stores data in `~/prompter` and maintains these files:

- `cards.json`
- `modular-prompts.json`
- `daily-stats.json`
- `settings.json`

You can switch the data directory from the settings page and choose whether to:

- start with an empty directory
- migrate existing data

## Chinese README

Chinese documentation: [README.zh-CN.md](https://github.com/hzxwonder/Prompter/blob/main/README.zh-CN.md)

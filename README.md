# Prompter

<p align="center">
  <a href="./README.md">English</a> | <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img src="icon.png" width="160" alt="Prompter icon" />
</p>

<p align="center">
  Build better prompts faster, without leaving VS Code.
</p>

Prompter turns prompt work into a real editor workflow. Instead of repeatedly copying code, file paths, terminal output, and old prompt templates by hand, you get one dedicated workspace to collect context, assemble prompts, reuse proven prompt blocks, and review what you already used.

It is designed for people who actively work with Codex, Claude Code, Roo Code, Cursor, and similar AI-assisted coding tools.

## Contents

- [Why Prompter](#why-prompter)
- [What You Can Do](#what-you-can-do)
- [Commands and Shortcuts](#commands-and-shortcuts)
- [Typical Workflow](#typical-workflow)
- [Session Sync and History](#session-sync-and-history)
- [Settings You Control](#settings-you-control)
- [Data Storage](#data-storage)

## Why Prompter

Prompter solves a very specific problem: prompt work is usually high-frequency, repetitive, and fragmented.

Without a dedicated workflow, you often end up doing all of this manually:

- copy a code selection into an AI chat
- find a file path and paste it again
- move terminal output by hand
- rewrite the same prompt structure from scratch
- lose good prompts after one session
- forget which prompt was used, still active, or already finished

Prompter compresses that overhead into a single workspace inside VS Code.

## What You Can Do

### 1. Work from a dedicated prompt workspace

Use `Prompter: Open` to open the main workspace.

Inside it, you can:

- draft prompts before sending them
- keep cards organized as `Unused`, `Active`, and `Completed`
- reopen and revise existing cards
- move prompts through a clear workflow instead of losing track of them

### 2. Import context directly from the editor

Prompter is most useful when context collection is fast.

You can import:

- the current editor selection
- a file or folder path from Explorer
- the current terminal selection
- dropped file paths inside the composer

This makes prompt preparation much faster and reduces missing references in the final prompt.

### 3. Reuse modular prompt blocks

If you have recurring structures such as review prompts, planning prompts, summary prompts, or debugging prompts, you can save them as reusable modular snippets and compose them quickly instead of rewriting them every time.

Examples:

- `#root-cause`
- `#review`
- `#plan`
- `#summary`

### 4. Copy-ready output for immediate use

When you manually confirm a prompt in the workspace:

- the prompt is saved as a card
- the content is copied to your clipboard
- the UI shows explicit copy feedback

This is ideal when your workflow is “prepare in Prompter, then paste into another AI tool immediately.”

### 5. Track active and completed prompts across sessions

Prompter can sync prompt activity from external agent logs, including:

- Claude Code
- Codex
- Roo Code

That means your workspace and history are not limited to manual input. Prompter can also help you track session-based prompt activity and review what was used, what is still in progress, and what has already finished.

### 6. Review history instead of losing it

The `History` view helps turn prompt work into reusable knowledge.

You can:

- browse prompts by day
- review activity in a heatmap
- inspect prompt counts by status
- copy previous prompts back into use
- trace prompts by source and session grouping

### 7. Manage shortcuts from inside the product

Prompter includes a built-in `Shortcuts` page so shortcut management is part of the workflow, not a hidden configuration task.

You can:

- inspect current bindings
- record new shortcuts directly in the UI
- reset commands to defaults
- keep import commands aligned across editor, Explorer, and terminal contexts

## Commands and Shortcuts

| Command | Purpose | Default Shortcut |
| --- | --- | --- |
| `Prompter: Open` | Open the Prompter workspace | `Ctrl+E` |
| `Prompter: Open Shortcuts` | Open the shortcuts page | None |
| `Prompter: Import Selection to Prompt` | Import the current editor selection | `Ctrl+Shift+F` |
| `Prompter: Add Resource to Prompt` | Import the selected resource from Explorer | `Ctrl+Shift+F` |
| `Prompter: Import Terminal Selection` | Import the current terminal selection | `Ctrl+Shift+F` |

Notes:

- The three import commands intentionally share the same default shortcut because they run in different UI contexts.
- You can change all of them from the built-in `Shortcuts` page.

## Typical Workflow

One practical daily flow looks like this:

1. Open `Prompter: Open`.
2. Import the code you want to discuss from the editor.
3. Add file paths or terminal output when extra context is needed.
4. Insert reusable prompt snippets for planning, review, debugging, or summary.
5. Confirm the prompt and copy it out.
6. Send it to Codex, Claude Code, Cursor, Roo Code, or any other AI tool.

The value is not “one more panel.” The value is less context switching, less repetition, and better prompt reuse.

## Session Sync and History

Prompter can monitor supported log sources and reflect them back into your workspace.

That includes:

- session grouping for imported prompts
- automatic prompt state transitions
- prompt completion tracking
- historical review by date and source

This is especially useful if part of your workflow happens outside the main Prompter composer but you still want one place to review and manage prompt activity.

## Settings You Control

The `Settings` page lets you control:

- language
- theme mode
- default import path format
- completion notifications
- completion sound
- data directory
- whether existing data should be migrated when switching directories
- log source enablement and paths for Claude Code, Codex, and Roo Code

## Data Storage

By default, Prompter stores data in `~/prompter`.

Key files include:

- `cards.json`
- `modular-prompts.json`
- `daily-stats.json`
- `settings.json`
- `session-groups.json`

## Links

- GitHub: <https://github.com/hzxwonder/Prompter>
- Chinese README: [README.zh-CN.md](./README.zh-CN.md)

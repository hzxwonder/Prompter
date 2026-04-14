# Prompter

<p align="center">
  <a href="./README.md"><strong>English</strong></a> | <a href="./README.zh-CN.md"><strong>简体中文</strong></a>
</p>

<p align="center">
  <img src="icon.png" width="160" alt="Prompter icon" />
</p>

<p align="center">
  A practical prompt workspace for VS Code.
</p>

<p align="center">
  Collect context faster, build better prompts, reuse proven prompt blocks, and keep prompt history organized in one place.
</p>

Prompter is built for people who work with AI inside VS Code every day.

Instead of repeatedly copying code selections, file paths, terminal output, and old prompt templates by hand, Prompter gives you one dedicated workspace to prepare prompts, track prompt status, reuse modular snippets, and review prompt history across sessions.

It is especially useful for workflows involving Codex, Claude Code, Roo Code, Cursor, and similar AI coding tools.

## Table of Contents

- [Why Prompter](#why-prompter)
- [Core Features](#core-features)
- [Commands and Shortcuts](#commands-and-shortcuts)
- [A Typical Workflow](#a-typical-workflow)
- [Session Sync](#session-sync)
- [Settings and Storage](#settings-and-storage)
- [Who It Is For](#who-it-is-for)

## Why Prompter

Prompt work is usually repetitive, fragmented, and easy to lose.

In a normal editor workflow, you often need to:

- copy code into an AI chat
- paste file paths manually
- move terminal output by hand
- rebuild the same prompt structure from scratch
- lose a good prompt after one use
- forget which prompt is still active and which one already finished

Prompter turns that scattered work into a structured workflow inside VS Code.

The goal is simple:

- reduce context switching
- reduce repetitive prompt preparation
- make useful prompts reusable
- keep prompt activity visible instead of disposable

## Core Features

### Dedicated Prompt Workspace

Run `Prompter: Open` to open the main workspace.

Inside the workspace, you can:

- draft prompts before sending them
- manage cards in `Unused`, `Active`, and `Completed`
- reopen and edit previous prompts
- keep today's prompt work organized instead of scattered across tabs and chats

### Fast Context Import

Prompter makes context collection fast enough to use every day.

You can import:

- the current editor selection
- a file or folder path from Explorer
- the current terminal selection
- dropped file paths inside the composer

This is one of the most practical parts of the extension because it removes a large amount of manual copy-and-format work.

### Copy-Ready Prompt Output

When you manually confirm a prompt in the workspace:

- the prompt is saved as a card
- the content is copied to the clipboard
- the UI gives explicit copy feedback

This works well when your flow is: prepare locally, then paste into another AI tool immediately.

### Reusable Modular Prompt Blocks

Prompter supports reusable prompt snippets for recurring work.

You can store prompt blocks for things like:

- debugging
- code review
- planning
- summaries
- root-cause analysis

That means your best prompt patterns stop being one-off text and become reusable building blocks.

### Prompt History and Daily Review

The `History` page helps turn prompt work into something reviewable.

You can:

- browse prompts by date
- review daily activity with a heatmap
- inspect prompt counts by status
- copy previous prompts back into use
- trace prompts by source and grouping

### Built-in Shortcut Management

Prompter includes a dedicated `Shortcuts` page, so shortcut editing is part of the product instead of hidden inside `keybindings.json`.

You can:

- inspect current bindings
- record new shortcuts
- reset shortcuts to defaults
- keep import actions aligned across editor, Explorer, and terminal contexts

### Activity Bar Entry

Prompter adds its own icon to the VS Code Activity Bar.

That gives users a persistent entry point to the extension and a fast way to open the main workspace.

## Commands and Shortcuts

| Command | Purpose | Default Shortcut |
| --- | --- | --- |
| `Prompter: Open` | Open the Prompter workspace | `Ctrl+E` |
| `Prompter: Open Shortcuts` | Open the built-in shortcuts page | None |
| `Prompter: Import Selection to Prompt` | Import the current editor selection | `Ctrl+Shift+F` |
| `Prompter: Add Resource to Prompt` | Import the selected Explorer resource | `Ctrl+Shift+F` |
| `Prompter: Import Terminal Selection` | Import the current terminal selection | `Ctrl+Shift+F` |

Notes:

- The three import commands share the same default shortcut because they run in different contexts.
- Shortcuts can be changed from the built-in `Shortcuts` page.

## A Typical Workflow

One practical flow looks like this:

1. Open `Prompter: Open`.
2. Import the code selection you want to discuss.
3. Add file paths or terminal output if more context is needed.
4. Insert reusable prompt blocks for review, debugging, planning, or summary.
5. Confirm the prompt and copy it out.
6. Send it to Codex, Claude Code, Cursor, Roo Code, or any other AI tool.

The value is not just having another panel.

The value is making prompt work faster, cleaner, and repeatable.

## Session Sync

Prompter can sync imported prompt activity from supported external log sources:

- Claude Code
- Codex
- Roo Code

That allows the workspace and history views to reflect more than manual drafts.

Prompter can track:

- session-based imported prompts
- prompt lifecycle changes
- completed prompts
- grouping by session
- daily prompt history

This is useful when part of your workflow happens in external agent sessions but you still want one place to review the prompt trail.

## Settings and Storage

The `Settings` page lets users control:

- language
- theme mode
- default import path format
- completion notifications
- completion sound
- data directory
- log source paths and toggles
- whether existing data should be migrated when switching directories

By default, Prompter stores data in `~/prompter`.

Main files include:

- `cards.json`
- `modular-prompts.json`
- `daily-stats.json`
- `settings.json`
- `session-groups.json`

## Who It Is For

Prompter is useful if you regularly:

- write prompts for coding agents
- reuse the same prompt patterns
- gather context from code, files, and terminal output
- want better visibility into prompt status
- want prompt history to stay useful after the session ends

## Links

- GitHub: <https://github.com/hzxwonder/Prompter>
- Chinese README: [README.zh-CN.md](./README.zh-CN.md)

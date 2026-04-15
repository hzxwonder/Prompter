# Initial History Import Design

## Summary

This design changes Prompter's first-run import behavior into a two-stage flow:

1. On extension activation, Prompter automatically discovers and parses today's Claude Code and Codex prompt logs, then hydrates the workspace status area with those results.
2. Historical backfill is not started automatically. Instead, the History page exposes a `Start / Pause` control that lets the user explicitly run, pause, and resume the remaining non-today history import.

The goal is to keep first use responsive enough for the workspace view while still supporting a one-time, resumable, higher-throughput historical import for older logs.

## Problem

The current implementation tries to stage today's logs first and then continue into historical logs automatically during initial import. That creates two user experience problems:

- First activation can still consume substantial memory and CPU because history processing begins without explicit user consent.
- Users do not have direct control over when heavy history processing runs, pauses, or resumes.

The desired behavior is:

- today's prompt data should be available automatically as soon as the extension activates;
- historical processing should require an explicit user action;
- historical processing should be pausable and resumable from a persisted checkpoint;
- once history has been fully processed, the control should be disabled with localized completion messaging.

## Goals

- Automatically parse today's Claude Code and Codex logs on activation.
- Populate today's imported prompt cards into the workspace status area without requiring user action.
- Expose a History-page control for starting and pausing historical backfill.
- Persist backfill progress so it resumes from remaining files instead of restarting from scratch.
- Show localized warnings before the first heavy history run starts.
- Disable the control once all historical data has been fully processed.

## Non-Goals

- Line-level or byte-offset resume within a single log file.
- Adding new log sources beyond the existing Claude Code and Codex support.
- Changing normal post-initial-import sync behavior for ongoing prompt updates.
- Solving all memory/performance issues for arbitrary future log volume; this design scopes control and resumability, not a full importer rewrite.

## User Experience

### Activation

On activation, Prompter should:

1. discover available log entries for supported sources;
2. separate them into today's entries and non-today entries;
3. automatically import only today's entries;
4. write the resulting cards into the workspace status area;
5. prepare, but not execute, a persisted history backfill queue for non-today entries.

If there are no historical entries, the history backfill state should immediately be marked complete.

### History Page Control

The History page should show a dedicated import control card whenever historical processing is not yet complete.

States:

- `Not started` or `Paused`: primary button shows `Start` / `开始`
- `Running`: primary button shows `Pause` / `暂停`
- `Complete`: button is disabled

The control card also shows:

- processed source count vs total source count;
- processed prompt count;
- a progress bar;
- a short status message indicating whether today's data is already available in the workspace.

### Warning Prompt

The first time the user clicks `Start`, show a confirmation warning.

Chinese:
`历史日志处理可能会占用一定内存和时间。处理期间，VS Code / Cursor 可能出现短暂卡顿，这是正常现象。建议尽量在暂时不需要使用编辑器时进行处理。是否开始？`

English:
`Processing historical logs may take noticeable memory and time. During processing, VS Code / Cursor may become temporarily sluggish. This is expected. We recommend running this when you do not need to actively use the editor. Start now?`

If the user cancels, the task remains idle or paused.
If the user confirms, history backfill starts.

### Pause Behavior

Pause is cooperative, not destructive:

- already-running file tasks are allowed to finish;
- no new history file tasks are claimed after pause is requested;
- completed work is persisted immediately;
- remaining files stay in the pending queue.

When the user clicks `Start` again later, processing resumes from the remaining pending files.

### Completion State

When all historical entries are processed:

- the button becomes disabled;
- hover tooltip is localized;
- no additional first-run historical import messaging is shown.

Tooltip copy:

- Chinese: `历史数据已经完全处理完毕`
- English: `Historical data has already been fully processed`

## Data Model

Extend `PrompterState.historyImport` from a simple progress snapshot into a persisted task state.

Recommended fields:

- `scope`: `'idle' | 'today-bootstrap' | 'history-backfill'`
- `status`: `'idle' | 'running' | 'paused' | 'complete'`
- `processedPrompts: number`
- `totalPrompts?: number`
- `processedSources: number`
- `totalSources: number`
- `foregroundReady: boolean`
- `warningAcknowledged: boolean`
- `pendingEntries: HistoryImportEntry[]`
- `completedEntries: string[]`
- `lastError?: string`

`HistoryImportEntry` should identify a resumable file-level work item, not a prompt-level item. It should contain only the minimum data needed to rediscover and process the file, for example:

- source type;
- canonical file path;
- date bucket;
- stable entry id.

The persisted checkpoint unit is the entry/file, not an in-file offset.

## Service Design

`LogSyncService` remains the central orchestrator, but initial import behavior is split into distinct flows.

### 1. Today Bootstrap

New responsibility:

- `bootstrapTodayImport()`

Behavior:

- discover entries;
- filter to today only;
- import them automatically on activation;
- refresh workspace-facing state;
- set `foregroundReady = true`.

This replaces the current behavior where initial import continues directly into historical entries.

### 2. History Backfill Preparation

New responsibility:

- `prepareHistoryBackfill()`

Behavior:

- discover non-today entries;
- normalize them into persistent `HistoryImportEntry` records;
- remove entries already listed in `completedEntries`;
- persist the remaining queue into `pendingEntries`;
- compute `totalSources`;
- mark state as `complete` if nothing remains.

This is executed on activation, but does not begin processing.

### 3. History Backfill Execution

New responsibilities:

- `runHistoryBackfill()`
- `pauseHistoryBackfill()`

`runHistoryBackfill()`:

- sets status to `running`;
- consumes `pendingEntries` with a fixed worker count;
- imports one entry per worker step;
- after each finished entry:
  - saves imported cards;
  - appends its stable id to `completedEntries`;
  - removes it from `pendingEntries`;
  - increments counters;
  - persists state immediately;
  - refreshes the panel.

`pauseHistoryBackfill()`:

- flips a pause flag;
- prevents workers from claiming new entries;
- persists final paused state after in-flight entries finish.

When `pendingEntries` becomes empty:

- mark `status = complete`;
- mark `scope = history-backfill`;
- keep `foregroundReady = true`;
- refresh the panel.

## Concurrency

Historical import should use bounded concurrency, not unbounded fan-out.

Recommended initial worker count: `3`.

Rationale:

- noticeably faster than serial processing;
- still controlled enough to avoid runaway memory amplification;
- simpler to reason about than dynamic worker sizing.

This worker count should live in the service as an internal constant for now, not a user setting.

## Repository and Persistence

`PromptRepository` already persists state updates and batch-imported cards. It should be extended only as needed to support the richer `historyImport` state transitions.

Persistence requirements:

- every queue transition is durable;
- processed entries survive reloads;
- paused state survives reloads;
- complete state survives reloads.

The importer must never rely on in-memory queue state alone.

## UI Messaging

History page localized messaging should distinguish these concepts clearly:

- today's data has already been loaded automatically into the workspace;
- historical data is optional to start now and can be resumed later;
- heavy processing may temporarily slow the editor;
- history is fully processed once complete.

This avoids the prior ambiguity where progress existed but was tied to an importer the user did not explicitly control.

## Error Handling

- If a single history entry fails, record a concise localized error message into `lastError`, pause the job, and preserve the remaining queue.
- Do not clear successful progress.
- The user can press `Start` again after the error condition is resolved.
- Today bootstrap failures should not prevent normal extension activation; they should log the error and leave workspace import partially unavailable rather than crashing activation.

## Testing

### Unit Tests

- activation imports today's entries only;
- activation prepares historical pending queue without running it;
- start begins historical processing only after confirmation;
- pause prevents new tasks from being claimed and preserves pending entries;
- resume continues from remaining pending entries;
- complete disables further processing;
- localized completion tooltip strings render correctly.

### Webview Tests

- history page shows `Start` when pending history exists;
- history page shows `Pause` while running;
- history page shows disabled completed control with localized tooltip when complete;
- warning confirmation appears before first start;
- progress summary updates as counters change.

## Implementation Order

1. Revert the temporary sidebar-only workaround so current open behavior is restored.
2. Extend the history import state model and repository persistence.
3. Split `LogSyncService` into activation-time today bootstrap plus prepared manual history backfill.
4. Add commands/messages for starting and pausing history backfill.
5. Update History page UI and localized copy.
6. Add tests for service state transitions and webview behavior.

## Risks

- File-level checkpoints mean an interrupted large single file may need to be reprocessed from file start on resume.
- Fixed concurrency may still be too aggressive for very large installations, but is safer than unbounded parallelism.
- Existing initial-import assumptions in tests may need careful migration to avoid accidental regressions in normal sync behavior.

## Open Decisions Resolved

- Today's logs are imported automatically on activation.
- Historical logs are processed manually from the History page.
- The control remains visible while unprocessed history exists.
- Completion disables the control with localized tooltip text.
- Resume granularity is file-level.

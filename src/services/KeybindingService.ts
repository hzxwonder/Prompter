import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { PrompterCommandId, ShortcutConfig } from '../shared/models';

const PROMPTER_COMMANDS: PrompterCommandId[] = [
  'prompter.open',
  'prompter.importSelection',
  'prompter.importResource',
  'prompter.importTerminalSelection'
];

const PROMPTER_WHEN_CLAUSES: Partial<Record<PrompterCommandId, string>> = {
  'prompter.importSelection': 'editorTextFocus && editorHasSelection',
  'prompter.importResource': 'filesExplorerFocus && !inputFocus',
  'prompter.importTerminalSelection': 'terminalFocus'
};

type KeybindingEntry = {
  command?: string;
  key?: string;
  mac?: string;
  when?: string;
  [key: string]: unknown;
};

type ArrayBounds = {
  openIndex: number;
  closeIndex: number;
};

type ArrayItem = {
  start: number;
  end: number;
  raw: string;
  command?: string;
};

export class KeybindingService {
  constructor(private readonly keybindingsPath: string) {}

  async applyShortcuts(shortcuts: Record<PrompterCommandId, ShortcutConfig>): Promise<void> {
    const source = await this.readSource();
    const nextSource = rewriteKeybindingsJsonc(source, shortcuts);

    await mkdir(dirname(this.keybindingsPath), { recursive: true });
    await writeFile(this.keybindingsPath, nextSource, 'utf8');
  }

  private async readSource(): Promise<string> {
    try {
      return await readFile(this.keybindingsPath, 'utf8');
    } catch (error: unknown) {
      if (isMissingFileError(error)) {
        return '';
      }

      throw error;
    }
  }
}

function rewriteKeybindingsJsonc(
  source: string,
  shortcuts: Record<PrompterCommandId, ShortcutConfig>
): string {
  if (!source.trim()) {
    return renderNewKeybindings(shortcuts);
  }

  const bounds = findRootArrayBounds(source);
  if (!bounds) {
    throw new Error('Keybindings file must contain a JSONC array');
  }

  const items = scanArrayItems(source, bounds);
  const seenCommands = new Set<PrompterCommandId>();
  let result = source.slice(0, bounds.openIndex + 1);
  let cursor = bounds.openIndex + 1;

  for (const item of items) {
    result += source.slice(cursor, item.start);
    const parsed = parseJsoncObject(item.raw);
    const command = typeof parsed?.command === 'string' ? (parsed.command as PrompterCommandId) : undefined;

    if (command && PROMPTER_COMMANDS.includes(command)) {
      seenCommands.add(command);
      result += renderShortcutEntry(command, shortcuts[command], getEntryIndent(source, item.start));
    } else {
      result += item.raw;
    }

    cursor = item.end;
  }

  const arrayTail = source.slice(cursor, bounds.closeIndex);
  const missingCommands = PROMPTER_COMMANDS.filter((command) => !seenCommands.has(command));

  if (missingCommands.length > 0) {
    if (hasExistingArrayEntries(source, bounds) && !endsWithCommaIgnoringComments(arrayTail)) {
      result += ',';
    }
    result += arrayTail;

    const closingIndent = getClosingBracketIndent(source, bounds.closeIndex);
    const entryIndent = `${closingIndent}  `;
    const renderedMissing = missingCommands
      .map((command) => renderShortcutEntry(command, shortcuts[command], entryIndent))
      .join(',\n');

    result += renderedMissing ? `\n${renderedMissing}\n` : '';
    result += source.slice(bounds.closeIndex);
    return result;
  }

  result += source.slice(cursor);
  return result;
}

function renderNewKeybindings(shortcuts: Record<PrompterCommandId, ShortcutConfig>): string {
  const entries = PROMPTER_COMMANDS.map((command) => renderShortcutEntry(command, shortcuts[command], '  ')).join(',\n');
  return `[\n${entries}\n]\n`;
}

function renderShortcutEntry(command: PrompterCommandId, shortcut: ShortcutConfig, indent: string): string {
  const innerIndent = `${indent}  `;
  const when = PROMPTER_WHEN_CLAUSES[command];
  const lines = [
    '{',
    `${innerIndent}"command": ${JSON.stringify(command)},`,
    `${innerIndent}"key": ${JSON.stringify(shortcut.keybinding)},`,
    `${innerIndent}"mac": ${JSON.stringify(shortcut.keybinding)}${when ? ',' : ''}`
  ];

  if (when) {
    lines.push(`${innerIndent}"when": ${JSON.stringify(when)}`);
  }

  lines.push(`${indent}}`);
  return lines.join('\n');
}

function findRootArrayBounds(source: string): ArrayBounds | undefined {
  let inString = false;
  let quote: '"' | "'" = '"';
  let inLineComment = false;
  let inBlockComment = false;
  let depth = 0;

  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        index++;
      }
      continue;
    }

    if (inString) {
      if (char === '\\') {
        index++;
        continue;
      }

      if (char === quote) {
        inString = false;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      continue;
    }

    if (char === '/' && next === '/') {
      inLineComment = true;
      index++;
      continue;
    }

    if (char === '/' && next === '*') {
      inBlockComment = true;
      index++;
      continue;
    }

    if (char === '[') {
      if (depth === 0) {
        const closeIndex = findMatchingArrayClose(source, index);
        if (closeIndex >= 0) {
          return { openIndex: index, closeIndex };
        }
      }
      depth++;
      continue;
    }

    if (char === ']') {
      depth = Math.max(0, depth - 1);
    }
  }

  return undefined;
}

function findMatchingArrayClose(source: string, openIndex: number): number {
  let inString = false;
  let quote: '"' | "'" = '"';
  let inLineComment = false;
  let inBlockComment = false;
  let depth = 0;

  for (let index = openIndex; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        index++;
      }
      continue;
    }

    if (inString) {
      if (char === '\\') {
        index++;
        continue;
      }

      if (char === quote) {
        inString = false;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      continue;
    }

    if (char === '/' && next === '/') {
      inLineComment = true;
      index++;
      continue;
    }

    if (char === '/' && next === '*') {
      inBlockComment = true;
      index++;
      continue;
    }

    if (char === '[') {
      depth++;
      continue;
    }

    if (char === ']') {
      depth--;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function scanArrayItems(source: string, bounds: ArrayBounds): ArrayItem[] {
  const items: ArrayItem[] = [];
  let inString = false;
  let quote: '"' | "'" = '"';
  let inLineComment = false;
  let inBlockComment = false;
  let depth = 1;
  let itemStart = -1;

  for (let index = bounds.openIndex + 1; index < bounds.closeIndex; index++) {
    const char = source[index];
    const next = source[index + 1];

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        index++;
      }
      continue;
    }

    if (inString) {
      if (char === '\\') {
        index++;
        continue;
      }

      if (char === quote) {
        inString = false;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      continue;
    }

    if (char === '/' && next === '/') {
      inLineComment = true;
      index++;
      continue;
    }

    if (char === '/' && next === '*') {
      inBlockComment = true;
      index++;
      continue;
    }

    if (depth === 1 && itemStart === -1) {
      if (isWhitespace(char) || char === ',') {
        continue;
      }

      if (char === '/' && (next === '/' || next === '*')) {
        continue;
      }

      itemStart = index;
    }

    if (char === '[' || char === '{') {
      depth++;
      continue;
    }

    if (char === ']' || char === '}') {
      depth--;
      if (depth === 1 && itemStart >= 0) {
        const end = index + 1;
        items.push({
          start: itemStart,
          end,
          raw: source.slice(itemStart, end)
        });
        itemStart = -1;
      }
    }
  }

  for (const item of items) {
    const parsed = parseJsoncObject(item.raw);
    if (typeof parsed?.command === 'string') {
      item.command = parsed.command;
    }
  }

  return items;
}

function parseJsoncObject(raw: string): KeybindingEntry | undefined {
  try {
    const parsed = JSON.parse(removeTrailingCommas(stripJsoncComments(raw))) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as KeybindingEntry) : undefined;
  } catch {
    return undefined;
  }
}

function stripJsoncComments(source: string): string {
  let output = '';
  let inString = false;
  let quote: '"' | "'" = '"';
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
        output += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        index++;
      }
      continue;
    }

    if (inString) {
      output += char;
      if (char === '\\') {
        const escaped = source[index + 1];
        if (escaped) {
          output += escaped;
          index++;
        }
        continue;
      }

      if (char === quote) {
        inString = false;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      output += char;
      continue;
    }

    if (char === '/' && next === '/') {
      inLineComment = true;
      index++;
      continue;
    }

    if (char === '/' && next === '*') {
      inBlockComment = true;
      index++;
      continue;
    }

    output += char;
  }

  return output;
}

function removeTrailingCommas(source: string): string {
  let output = '';
  let inString = false;
  let quote: '"' | "'" = '"';

  for (let index = 0; index < source.length; index++) {
    const char = source[index];

    if (inString) {
      output += char;
      if (char === '\\') {
        const escaped = source[index + 1];
        if (escaped) {
          output += escaped;
          index++;
        }
        continue;
      }

      if (char === quote) {
        inString = false;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      output += char;
      continue;
    }

    if (char === ',') {
      let lookahead = index + 1;
      while (lookahead < source.length && isWhitespace(source[lookahead])) {
        lookahead++;
      }

      if (lookahead < source.length && (source[lookahead] === '}' || source[lookahead] === ']')) {
        continue;
      }
    }

    output += char;
  }

  return output;
}

function getEntryIndent(source: string, itemStart: number): string {
  const lineStart = source.lastIndexOf('\n', itemStart - 1) + 1;
  return source.slice(lineStart, itemStart);
}

function getClosingBracketIndent(source: string, closeIndex: number): string {
  const lineStart = source.lastIndexOf('\n', closeIndex - 1) + 1;
  return source.slice(lineStart, closeIndex);
}

function hasExistingArrayEntries(source: string, bounds: ArrayBounds): boolean {
  return scanArrayItems(source, bounds).length > 0;
}

function endsWithCommaIgnoringComments(source: string): boolean {
  let lastSignificant: string | undefined;
  let inString = false;
  let quote: '"' | "'" = '"';
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        index++;
      }
      continue;
    }

    if (inString) {
      if (char === '\\') {
        index++;
        continue;
      }

      if (char === quote) {
        inString = false;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      continue;
    }

    if (char === '/' && next === '/') {
      inLineComment = true;
      index++;
      continue;
    }

    if (char === '/' && next === '*') {
      inBlockComment = true;
      index++;
      continue;
    }

    if (!isWhitespace(char)) {
      lastSignificant = char;
    }
  }

  return lastSignificant === ',';
}

function isWhitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

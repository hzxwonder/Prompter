import { relative } from 'node:path';
import type { ImportPathMode } from '../shared/models';

export function resolveImportedPath(filePath: string, workspaceRoot: string | undefined, pathMode: ImportPathMode): string {
  if (pathMode === 'absolute' || !workspaceRoot) {
    return filePath;
  }

  const relativePath = relative(workspaceRoot, filePath);
  return relativePath && !relativePath.startsWith('..') ? relativePath : filePath;
}

export function formatFilePathImport(
  filePath: string,
  workspaceRoot: string | undefined,
  pathMode: ImportPathMode
): string {
  return `File: ${resolveImportedPath(filePath, workspaceRoot, pathMode)}`;
}

export function formatSelectionImport(input: {
  filePath: string;
  workspaceRoot?: string;
  pathMode: ImportPathMode;
  startLine: number;
  endLine: number;
  selection: string;
}): string {
  const displayPath = resolveImportedPath(input.filePath, input.workspaceRoot, input.pathMode);
  return [`File: ${displayPath}:${input.startLine}-${input.endLine}`, '```ts', input.selection.trimEnd(), '```'].join('\n');
}

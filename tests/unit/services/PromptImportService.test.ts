import { describe, expect, it } from 'vitest';
import { formatFilePathImport, formatSelectionImport, resolveImportedPath } from '../../../src/services/PromptImportService';

describe('PromptImportService', () => {
  it('formats selections with a relative path and line range', () => {
    const text = formatSelectionImport({
      filePath: '/workspace/src/api.ts',
      workspaceRoot: '/workspace',
      pathMode: 'relative',
      startLine: 4,
      endLine: 8,
      selection: 'export function load() {}'
    });

    expect(text).toContain('File: src/api.ts:4-8');
    expect(text).toContain('```');
  });

  it('formats dropped file paths with the default path mode', () => {
    expect(formatFilePathImport('/workspace/src/feature/auth.ts', '/workspace', 'relative')).toBe('File: src/feature/auth.ts');
  });

  it('keeps absolute paths when requested', () => {
    expect(resolveImportedPath('/workspace/src/api.ts', '/workspace', 'absolute')).toBe('/workspace/src/api.ts');
  });
});

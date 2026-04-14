import { describe, expect, it } from 'vitest';
import { expandModularPromptReferences } from '../../../src/services/ModularPromptService';

describe('expandModularPromptReferences', () => {
  it('replaces #name tokens with the saved modular prompt content', () => {
    const result = expandModularPromptReferences('Start with #root-cause', [
      {
        id: '1',
        name: 'root-cause',
        content: 'List the symptoms, identify the trigger, then propose the fix.',
        category: 'analysis',
        updatedAt: '2026-04-08T10:00:00.000Z'
      }
    ]);

    expect(result).toBe('Start with List the symptoms, identify the trigger, then propose the fix.');
  });

  it('keeps unknown #tokens unchanged', () => {
    const result = expandModularPromptReferences('Start with #unknown', []);

    expect(result).toBe('Start with #unknown');
  });
});

import type { ModularPrompt } from '../shared/models';

const TOKEN_PATTERN = /(^|\s)#([a-z0-9-_]+)/gi;

export function expandModularPromptReferences(content: string, prompts: ModularPrompt[]): string {
  const byName = new Map(prompts.map((prompt) => [prompt.name.toLowerCase(), prompt.content]));

  return content.replace(TOKEN_PATTERN, (fullMatch, leadingWhitespace, tokenName) => {
    const replacement = byName.get(String(tokenName).toLowerCase());
    return replacement ? `${leadingWhitespace}${replacement}` : fullMatch;
  });
}

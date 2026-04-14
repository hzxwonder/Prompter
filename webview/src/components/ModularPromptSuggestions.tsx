import type { ModularPrompt } from '../../../src/shared/models';

export function ModularPromptSuggestions({
  prompts,
  activeToken
}: {
  prompts: ModularPrompt[];
  activeToken?: string;
}) {
  const visiblePrompts = activeToken
    ? prompts.filter((prompt) => prompt.name.toLowerCase().startsWith(activeToken.toLowerCase()))
    : [];

  if (!visiblePrompts.length) {
    return null;
  }

  return (
    <aside className="modular-suggestions" aria-label="Modular prompt suggestions">
      <div className="modular-suggestions-header">Matching modular prompts</div>
      <ul>
        {visiblePrompts.map((prompt) => (
          <li key={prompt.id}>
            <strong>#{prompt.name}</strong>
            <span>{prompt.category}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

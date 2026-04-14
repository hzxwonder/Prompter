import { useEffect, useState } from 'react';
import type { ModularPrompt } from '../../../src/shared/models';

export function ModularPromptManager({
  prompts,
  editingPrompt,
  onSave,
  onClose
}: {
  prompts: ModularPrompt[];
  editingPrompt?: ModularPrompt;
  onSave: (prompt: { id?: string; name: string; content: string; category: string }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(editingPrompt?.name ?? '');
  const [content, setContent] = useState(editingPrompt?.content ?? '');
  const [category, setCategory] = useState(editingPrompt?.category ?? 'general');

  useEffect(() => {
    setName(editingPrompt?.name ?? '');
    setContent(editingPrompt?.content ?? '');
    setCategory(editingPrompt?.category ?? 'general');
  }, [editingPrompt]);

  return (
    <section className="modular-manager" aria-label="Modular prompt manager">
      <div className="modular-manager-header">
        <div>
          <h3>{editingPrompt ? 'Edit modular prompt' : 'Create modular prompt'}</h3>
          <p>Define reusable prompt snippets that can be inserted with #name inside the composer.</p>
        </div>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>

      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="root-cause" />
      </label>

      <label className="field">
        <span>Category</span>
        <input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="analysis" />
      </label>

      <label className="field field-grow">
        <span>Content</span>
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="List the symptoms, identify the trigger, then propose the fix."
        />
      </label>

      <div className="modular-manager-actions">
        <button
          type="button"
          onClick={() => {
            onSave({ id: editingPrompt?.id, name, content, category });
            if (!editingPrompt) {
              setName('');
              setContent('');
              setCategory('general');
            }
          }}
        >
          Save modular prompt
        </button>
      </div>

      <ul className="modular-manager-list">
        {prompts.map((prompt) => (
          <li key={prompt.id}>
            <strong>#{prompt.name}</strong>
            <span>{prompt.category}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

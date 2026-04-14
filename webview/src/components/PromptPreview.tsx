import Markdown from 'react-markdown';

export function PromptPreview({ content }: { content: string }) {
  return (
    <section className="preview-panel" aria-label="Markdown preview">
      <div className="panel-header">
        <h2>Preview</h2>
      </div>
      <div className="preview-body">
        {content.trim() ? <Markdown>{content}</Markdown> : <p className="empty-state">Markdown preview appears here.</p>}
      </div>
    </section>
  );
}

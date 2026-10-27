import { snippetsStore, useList } from '../../stores/index.js';
import { SnippetEditor } from './SnippetEditor.js';
import { useSnippetEditor } from './useSnippetEditor.js';
import './snippets.css';

/** The snippet editor view, shown in L in place of the snippets list. */
export function Snippets() {
  const editor = useSnippetEditor();
  const snippets = useList(snippetsStore);
  if (!editor.draft)
    return (
      <div className="empty-state">
        <h1>Snippets</h1>
        <p>Select a snippet, or create one.</p>
      </div>
    );
  return (
    <SnippetEditor
      draft={editor.draft}
      dirty={editor.dirty}
      errors={editor.errors}
      snippetNames={snippets.map((snippet) => snippet.name)}
      onChange={editor.change}
      onSave={() => void editor.save()}
      onRevert={editor.revert}
      onDelete={() => void editor.remove()}
      onBack={editor.back}
    />
  );
}

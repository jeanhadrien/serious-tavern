import { ProviderEditor } from './ProviderEditor.js';
import { useProviderEditor } from './useProviderEditor.js';
import './providers.css';

/** The provider editor view, shown in L in place of the providers list. */
export function Providers() {
  const editor = useProviderEditor();
  if (!editor.draft)
    return (
      <div className="empty-state">
        <h1>Providers</h1>
        <p>Select a provider, or create one.</p>
      </div>
    );
  return (
    <ProviderEditor
      draft={editor.draft}
      dirty={editor.dirty}
      readOnly={editor.readOnly}
      errors={editor.errors}
      secretNames={editor.secretNames}
      onChange={editor.change}
      onSave={() => void editor.save()}
      onRevert={editor.revert}
      onDelete={() => void editor.remove()}
      onDuplicate={() => void editor.duplicate()}
      onBack={editor.back}
    />
  );
}

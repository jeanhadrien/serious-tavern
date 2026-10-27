import { templateWarnings } from '@st/shared';
import { EditorHeader } from '../../components/EditorHeader.js';
import type { SnippetDraft } from './snippetDraft.js';

interface SnippetEditorProps {
  draft: SnippetDraft;
  dirty: boolean;
  /** Problems found when saving, shown above the form. */
  errors: readonly string[];
  /** The names of every stored snippet, to warn about unknown ones inside the text. */
  snippetNames: readonly string[];
  onChange(draft: SnippetDraft): void;
  onSave(): void;
  onRevert(): void;
  onDelete(): void;
  onBack(): void;
}

/** The snippet form shown in L in place of the snippets list. */
export function SnippetEditor(props: SnippetEditorProps) {
  const { draft, dirty, errors, onChange } = props;
  const warnings = templateWarnings(draft.text, { snippetNames: props.snippetNames });
  const usage = `{{snippets.${draft.name.trim() || '<name>'}}}`;
  return (
    <section className="snippet-editor">
      <EditorHeader
        title={draft.name || 'Snippet'}
        back={{ label: 'Back to snippets', onClick: props.onBack }}
        dirty={dirty}
        actions={{
          save: { onClick: props.onSave, disabled: !dirty },
          revert: { onClick: props.onRevert },
          remove: { onClick: props.onDelete },
        }}
      />
      {errors.length > 0 && (
        <ul className="snippet-errors error" role="alert">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
      <div className="snippet-form">
        <label>
          Name
          <input
            value={draft.name}
            spellCheck={false}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
          />
          <small>
            Templates use it as <code>{usage}</code>. Renaming does not update them.
          </small>
        </label>
        <label>
          Description
          <input
            value={draft.description}
            onChange={(event) => onChange({ ...draft, description: event.target.value })}
          />
        </label>
        <label>
          Text
          <textarea
            className="snippet-text"
            rows={14}
            value={draft.text}
            onChange={(event) => onChange({ ...draft, text: event.target.value })}
          />
          <small>
            A template, filled in where the snippet is used: it can read state, settings, the character, inputs and
            other snippets.
          </small>
        </label>
        {warnings.length > 0 && (
          <div className="template-warnings">
            {warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

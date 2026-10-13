import { ArrowLeft } from 'lucide-react';
import { IconButton } from '../../components/IconButton.js';
import { ProviderFields } from './ProviderFields.js';
import type { ProviderDraft } from './providerDraft.js';

interface ProviderEditorProps {
  draft: ProviderDraft;
  dirty: boolean;
  /** Built-in providers: every field is disabled, and only Duplicate is offered. */
  readOnly: boolean;
  /** Problems found when saving, shown above the form. */
  errors: readonly string[];
  secretNames: readonly string[];
  onChange(draft: ProviderDraft): void;
  onSave(): void;
  onDelete(): void;
  onDuplicate(): void;
  onBack(): void;
}

/** The provider form shown in L in place of the providers list. */
export function ProviderEditor(props: ProviderEditorProps) {
  const { draft, dirty, readOnly, errors, onChange } = props;
  return (
    <section className="provider-editor">
      <div className="provider-toolbar">
        <div className="provider-title">
          <IconButton icon={ArrowLeft} label="Back to providers" onClick={props.onBack} />
          <h1>{draft.name || 'Provider'}</h1>
          {dirty && <span className="dirty-dot">Unsaved</span>}
        </div>
        <div className="toolbar">
          <button
            type="button"
            disabled={dirty}
            title={dirty ? 'Duplicate copies the saved provider: save or undo your changes first' : undefined}
            onClick={props.onDuplicate}
          >
            Duplicate
          </button>
          {!readOnly && (
            <>
              <button type="button" onClick={props.onDelete}>
                Delete
              </button>
              <button type="button" className="primary" disabled={!dirty} onClick={props.onSave}>
                Save
              </button>
            </>
          )}
        </div>
      </div>
      {readOnly && (
        <p className="provider-banner">Built-in provider, read-only. Duplicate it to get an editable copy.</p>
      )}
      {errors.length > 0 && (
        <ul className="provider-errors error" role="alert">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
      <fieldset className="provider-form" disabled={readOnly}>
        <ProviderFields draft={draft} secretNames={props.secretNames} onChange={onChange} />
        <label>
          Headers, extra body and overrides (YAML)
          <textarea
            className="provider-yaml"
            rows={12}
            spellCheck={false}
            value={draft.advanced}
            onChange={(event) => onChange({ ...draft, advanced: event.target.value })}
          />
          <small>
            <code>headers</code>: extra request headers. <code>extraBody</code>: merged into the request body last.{' '}
            <code>overrides</code>: per-model changes, e.g. <code>- match: "deepseek/*"</code> with{' '}
            <code>messageName</code>, <code>reasoningFields</code>, <code>headers</code> or <code>extraBody</code>; the
            first matching glob wins.
          </small>
        </label>
      </fieldset>
    </section>
  );
}

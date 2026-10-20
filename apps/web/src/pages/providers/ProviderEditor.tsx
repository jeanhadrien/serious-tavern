import { EditorHeader } from '../../components/EditorHeader.js';
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
  onRevert(): void;
  onDelete(): void;
  onDuplicate(): void;
  onBack(): void;
}

/** The provider form shown in L in place of the providers list. */
export function ProviderEditor(props: ProviderEditorProps) {
  const { draft, dirty, readOnly, errors, onChange } = props;
  return (
    <section className="provider-editor">
      <EditorHeader
        title={draft.name || 'Provider'}
        back={{ label: 'Back to providers', onClick: props.onBack }}
        dirty={dirty}
        note={
          readOnly && (
            <p className="provider-banner">Built-in provider, read-only. Duplicate it to get an editable copy.</p>
          )
        }
        actions={{
          save: readOnly ? undefined : { onClick: props.onSave, disabled: !dirty },
          revert: readOnly ? undefined : { onClick: props.onRevert },
          duplicate: {
            onClick: props.onDuplicate,
            disabled: dirty,
            title: dirty ? 'Duplicate copies the saved provider: save or undo your changes first' : undefined,
          },
          remove: readOnly ? undefined : { onClick: props.onDelete },
        }}
      />
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
          Replay, headers, extra body and overrides (YAML)
          <textarea
            className="provider-yaml"
            rows={12}
            spellCheck={false}
            value={draft.advanced}
            onChange={(event) => onChange({ ...draft, advanced: event.target.value })}
          />
          <small>
            <code>headers</code>: extra request headers. <code>extraBody</code>: merged into the request body last.{' '}
            <code>replayFields</code>: response message fields sent back with that message later (e.g.{' '}
            <code>reasoning_details</code>). <code>reasoningReplayField</code>: the field a replayed reasoning is sent
            under, or null for never. <code>overrides</code>: per-model changes, e.g. <code>- match: "deepseek/*"</code>{' '}
            with <code>messageName</code>, <code>reasoningFields</code>, <code>replayFields</code>,{' '}
            <code>reasoningReplayField</code>, <code>headers</code> or <code>extraBody</code>; the first matching glob
            wins.
          </small>
        </label>
      </fieldset>
    </section>
  );
}

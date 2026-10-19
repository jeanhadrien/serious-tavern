import { useRef } from 'react';
import { entryUsesInput, presetSchema, presetWarnings, type Preset, type PresetInput } from '@st/shared';
import { EntryList, newId } from './PresetEntryList.js';
import { EditorHeader } from '../../components/EditorHeader.js';
import { ImportedBanner } from './ImportedBanner.js';

const newInput = (inputs: PresetInput[]): PresetInput => {
  let key = 'context';
  let suffix = 2;
  while (inputs.some((input) => input.key.toLowerCase() === key.toLowerCase())) key = `context${suffix++}`;
  return { id: newId(), key, dataType: 'text' };
};

function PresetInputs(props: { preset: Preset; readOnly: boolean; onChange(preset: Preset): void }) {
  const lastValidKeys = useRef(new Map(props.preset.inputs.map((input) => [input.id, input.key])));
  const parsed = presetSchema.safeParse(props.preset);
  const issues = parsed.success ? [] : parsed.error.issues;
  const updateKey = (index: number, key: string) => {
    const input = props.preset.inputs[index];
    if (!input) return;
    const oldKey = lastValidKeys.current.get(input.id) ?? input.key;
    const isValidKey = /^[a-z][a-zA-Z0-9_]*$/.test(key);
    const escapedKey = oldKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const reference = new RegExp(`(\\{\\{\\s*inputs?\\.)${escapedKey}(?=[.\\s}]|$)`, 'g');
    const rename = (template: string) => template.replace(reference, (_match, prefix: string) => `${prefix}${key}`);
    const entries =
      isValidKey && oldKey !== key
        ? props.preset.entries.map((entry) => {
            if (entry.kind === 'slot' && entry.inputKey === oldKey) return { ...entry, inputKey: key };
            if (entry.kind === 'message')
              return {
                ...entry,
                content: rename(entry.content),
                ...(entry.name === undefined ? {} : { name: rename(entry.name) }),
              };
            return entry;
          })
        : props.preset.entries;
    if (isValidKey) lastValidKeys.current.set(input.id, key);
    props.onChange({
      ...props.preset,
      inputs: props.preset.inputs.map((item, itemIndex) => (itemIndex === index ? { ...item, key } : item)),
      entries,
    });
  };
  const isUsed = (input: PresetInput) =>
    props.preset.entries.some(
      (entry) =>
        (entry.kind === 'slot' && entry.inputKey === input.key) ||
        (entry.kind === 'message' && entryUsesInput(entry, input.key)),
    );
  const warnings = parsed.success ? presetWarnings(parsed.data) : [];
  return (
    <section className="preset-inputs">
      <div className="toolbar">
        <h3>Inputs</h3>
        <button
          disabled={props.readOnly}
          onClick={() =>
            props.onChange({
              ...props.preset,
              inputs: [...props.preset.inputs, newInput(props.preset.inputs)],
            })
          }
        >
          + Input
        </button>
      </div>
      <p className="hint">Inputs are values supplied by the workflow and become ports on the LLM node.</p>
      {props.preset.inputs.map((input, index) => {
        const inputIssues = issues.filter((issue) => issue.path[0] === 'inputs' && issue.path[1] === index);
        return (
          <div className="preset-input-row" key={input.id}>
            <input
              aria-label={`Input key ${index + 1}`}
              disabled={props.readOnly}
              value={input.key}
              onChange={(event) => {
                updateKey(index, event.target.value);
              }}
            />
            <select
              aria-label={`Input type ${index + 1}`}
              disabled={props.readOnly}
              value={input.dataType}
              onChange={(event) =>
                props.onChange({
                  ...props.preset,
                  inputs: props.preset.inputs.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, dataType: event.target.value as 'messages' | 'text' } : item,
                  ),
                })
              }
            >
              <option value="messages">messages</option>
              <option value="text">text</option>
            </select>
            <button
              title={isUsed(input) ? 'Remove entries using this input first' : 'Remove input'}
              disabled={props.readOnly || isUsed(input)}
              onClick={() =>
                props.onChange({ ...props.preset, inputs: props.preset.inputs.filter((item) => item.id !== input.id) })
              }
            >
              ×
            </button>
            {inputIssues.map((issue, issueIndex) => (
              <small className="error input-issue" key={issueIndex}>
                {issue.message}
              </small>
            ))}
          </div>
        );
      })}
      {warnings.length > 0 && (
        <div className="preset-warnings">
          {warnings.map((warning, index) => (
            <p key={`${warning.path.join('.')}-${index}`}>{warning.message}</p>
          ))}
        </div>
      )}
      {props.preset.inputs.some(isUsed) && (
        <small className="hint">To remove an input, first remove its slots and template references.</small>
      )}
    </section>
  );
}

export function PresetEditor(props: {
  preset: Preset;
  dirty: boolean;
  readOnly: boolean;
  onChange(preset: Preset): void;
  onSave(): void;
  onRevert(): void;
  onDuplicate(): void;
  selectedEntryId: string;
  onSelectEntry(id: string): void;
}) {
  return (
    <section className="preset-editor-column">
      {props.preset.source && <ImportedBanner source={props.preset.source} onDuplicate={props.onDuplicate} />}
      <EditorHeader
        className="preset-toolbar"
        title={
          <input
            aria-label="Preset name"
            disabled={props.readOnly}
            value={props.preset.name}
            onChange={(event) => props.onChange({ ...props.preset, name: event.target.value })}
          />
        }
        dirty={props.dirty}
        actions={{ save: { onClick: props.onSave, disabled: props.readOnly }, revert: { onClick: props.onRevert } }}
      />
      <label>
        Description{' '}
        <input
          disabled={props.readOnly}
          value={props.preset.description ?? ''}
          onChange={(event) => props.onChange({ ...props.preset, description: event.target.value || undefined })}
        />
      </label>
      <PresetInputs preset={props.preset} readOnly={props.readOnly} onChange={props.onChange} />
      <EntryList
        preset={props.preset}
        readOnly={props.readOnly}
        selectedId={props.selectedEntryId}
        onChange={props.onChange}
        onSelect={props.onSelectEntry}
      />
    </section>
  );
}

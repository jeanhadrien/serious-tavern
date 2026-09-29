import { useRef } from 'react';
import {
  macroInputKey,
  templateMacros,
  presetSchema,
  presetWarnings,
  type Preset,
  type PresetEntry,
  type PresetInput,
} from '@st/shared';

const newId = () => crypto.randomUUID();
const newInput = (inputs: PresetInput[]): PresetInput => {
  let key = 'context';
  let suffix = 2;
  while (inputs.some((input) => input.key.toLowerCase() === key.toLowerCase())) key = `context${suffix++}`;
  return { id: newId(), key, label: 'Context', dataType: 'text' };
};
const newMessage = (): PresetEntry => ({
  id: newId(),
  name: 'New message',
  kind: 'message',
  enabled: true,
  role: 'system',
  content: '',
  placement: { mode: 'ordered' },
});

export function entryPreview(entry: PresetEntry): string {
  return entry.kind === 'slot' ? `→ {{input.${entry.inputKey}}}` : entry.content.replace(/\s+/g, ' ').slice(0, 70);
}

export function entryIcon(entry: PresetEntry, preset: Preset): string {
  if (entry.kind === 'message') return { system: '⚙️', user: '👤', assistant: '🤖' }[entry.role];
  return preset.inputs.find((input) => input.key === entry.inputKey)?.dataType === 'messages' ? '📜' : '🔤';
}

function PresetInputs(props: { preset: Preset; onChange(preset: Preset): void }) {
  const lastValidKeys = useRef(new Map(props.preset.inputs.map((input) => [input.id, input.key])));
  const parsed = presetSchema.safeParse(props.preset);
  const issues = parsed.success ? [] : parsed.error.issues;
  const updateKey = (index: number, key: string) => {
    const input = props.preset.inputs[index];
    if (!input) return;
    const oldKey = lastValidKeys.current.get(input.id) ?? input.key;
    const isValidKey = /^[a-z][a-zA-Z0-9_]*$/.test(key);
    const escapedKey = oldKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const reference = new RegExp(`(\\{\\{\\s*inputs?\\.)${escapedKey}(?=[.\\s}]|$)`, 'gi');
    const entries =
      isValidKey && oldKey !== key
        ? props.preset.entries.map((entry) => {
            if (entry.kind === 'slot' && entry.inputKey === oldKey) return { ...entry, inputKey: key };
            if (entry.kind === 'message')
              return {
                ...entry,
                content: entry.content.replace(reference, (_match, prefix: string) => `${prefix}${key}`),
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
        (entry.kind === 'message' &&
          templateMacros(entry.content).some((macro) => macroInputKey(macro.name) === input.key.toLowerCase())),
    );
  const warnings = parsed.success ? presetWarnings(parsed.data) : [];
  return (
    <section className="preset-inputs">
      <div className="toolbar">
        <h3>Inputs</h3>
        <button
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
              value={input.key}
              onChange={(event) => {
                updateKey(index, event.target.value);
              }}
            />
            <select
              aria-label={`Input type ${index + 1}`}
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
            <input
              aria-label={`Input label ${index + 1}`}
              placeholder={input.key}
              value={input.label ?? ''}
              onChange={(event) =>
                props.onChange({
                  ...props.preset,
                  inputs: props.preset.inputs.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, label: event.target.value || undefined } : item,
                  ),
                })
              }
            />
            <input
              aria-label={`Input description ${index + 1}`}
              placeholder="Description"
              value={input.description ?? ''}
              onChange={(event) =>
                props.onChange({
                  ...props.preset,
                  inputs: props.preset.inputs.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, description: event.target.value || undefined } : item,
                  ),
                })
              }
            />
            <button
              title={isUsed(input) ? 'Remove entries using this input first' : 'Remove input'}
              disabled={isUsed(input)}
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

function EntryList(props: {
  preset: Preset;
  selectedId: string;
  onChange(preset: Preset): void;
  onSelect(id: string): void;
}) {
  const updateEntries = (entries: PresetEntry[]) => props.onChange({ ...props.preset, entries });
  const addMessage = () => {
    const entry = newMessage();
    updateEntries([...props.preset.entries, entry]);
    props.onSelect(entry.id);
  };
  const addSlot = () => {
    const input = props.preset.inputs[0];
    if (!input) return;
    const entry: PresetEntry = {
      id: newId(),
      name: input.label ?? input.key,
      kind: 'slot',
      enabled: true,
      inputKey: input.key,
      role: 'user',
    };
    updateEntries([...props.preset.entries, entry]);
    props.onSelect(entry.id);
  };
  const duplicate = (entry: PresetEntry) => {
    const copy = { ...entry, id: newId(), name: `${entry.name} copy` } as PresetEntry;
    updateEntries([...props.preset.entries, copy]);
    props.onSelect(copy.id);
  };
  const getDepthLabel = (entry: PresetEntry) => {
    if (entry.kind !== 'message' || entry.placement.mode !== 'depth') return undefined;
    const entryId = entry.placement.entryId;
    const target = props.preset.entries.find(
      (item): item is Extract<PresetEntry, { kind: 'slot' }> => item.id === entryId && item.kind === 'slot',
    );
    return target?.inputKey ?? 'slot';
  };
  const move = (index: number, delta: number) => {
    const next = index + delta;
    if (next < 0 || next >= props.preset.entries.length) return;
    const entries = [...props.preset.entries];
    [entries[index], entries[next]] = [entries[next]!, entries[index]!];
    updateEntries(entries);
  };
  return (
    <section className="preset-entry-list">
      <div className="toolbar">
        <h3>Entries</h3>
        <div>
          <button onClick={addMessage}>+ Message</button>
          <button onClick={addSlot} disabled={!props.preset.inputs.length}>
            + Slot
          </button>
        </div>
      </div>
      <div className="entry-list-scroll">
        {props.preset.entries.map((entry, index) => (
          <div
            className={`preset-entry-row ${props.selectedId === entry.id ? 'selected' : ''} ${entry.enabled ? '' : 'disabled'}`}
            key={entry.id}
          >
            <button className="preset-entry-select" onClick={() => props.onSelect(entry.id)}>
              <span>
                {entryIcon(entry, props.preset)} {entry.name}
              </span>
              <small>{entryPreview(entry) || 'Empty message'}</small>
            </button>
            {entry.kind === 'message' && entry.placement.mode === 'depth' && (
              <small className="depth-badge">
                @{entry.placement.depth} in {getDepthLabel(entry)}
              </small>
            )}
            <label className="check" title="Enabled">
              <input
                type="checkbox"
                checked={entry.enabled}
                onChange={(event) =>
                  updateEntries(
                    props.preset.entries.map((item) =>
                      item.id === entry.id ? { ...item, enabled: event.target.checked } : item,
                    ),
                  )
                }
              />
            </label>
            <button title="Move up" disabled={index === 0} onClick={() => move(index, -1)}>
              ↑
            </button>
            <button
              title="Move down"
              disabled={index === props.preset.entries.length - 1}
              onClick={() => move(index, 1)}
            >
              ↓
            </button>
            <button title="Duplicate entry" onClick={() => duplicate(entry)}>
              ⧉
            </button>
            <button
              title="Delete entry"
              onClick={() => {
                updateEntries(props.preset.entries.filter((item) => item.id !== entry.id));
                if (props.selectedId === entry.id) props.onSelect('');
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

export function PresetEditor(props: {
  preset: Preset;
  dirty: boolean;
  onChange(preset: Preset): void;
  onSave(): void;
  selectedEntryId: string;
  onSelectEntry(id: string): void;
}) {
  return (
    <section className="preset-editor-column">
      <div className="editor-toolbar preset-toolbar">
        <input
          aria-label="Preset name"
          value={props.preset.name}
          onChange={(event) => props.onChange({ ...props.preset, name: event.target.value })}
        />
        {props.dirty && <small>Unsaved changes</small>}
        <button className="primary" onClick={props.onSave}>
          Save
        </button>
      </div>
      <label>
        Description{' '}
        <input
          value={props.preset.description ?? ''}
          onChange={(event) => props.onChange({ ...props.preset, description: event.target.value || undefined })}
        />
      </label>
      <PresetInputs preset={props.preset} onChange={props.onChange} />
      <EntryList
        preset={props.preset}
        selectedId={props.selectedEntryId}
        onChange={props.onChange}
        onSelect={props.onSelectEntry}
      />
    </section>
  );
}

import { useRef } from 'react';
import {
  macroHints,
  presetInputLabel,
  presetSchema,
  type Preset,
  type PresetEntry,
  type StateHint,
  type WorkflowSetting,
} from '@st/shared';

type TemplateField = 'content' | 'name' | 'reasoning';

// A read-only editor disables its whole field block through one disabled fieldset.
export function PresetEntryEditor(props: {
  preset: Preset;
  entry?: PresetEntry;
  readOnly: boolean;
  /** Chat settings declared by any workflow, hinted as `{{settings.<key>}}`. */
  settings?: readonly WorkflowSetting[];
  /** Keys of the state definitions, hinted as `{{state.<definition>.<key>}}` (`stateHints`). */
  state?: readonly StateHint[];
  onChange(entry: PresetEntry): void;
}) {
  const contentRef = useRef<HTMLTextAreaElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const reasoningRef = useRef<HTMLTextAreaElement | null>(null);
  // Variable hints insert into whichever template field of this entry was focused last (content by default).
  const hintTarget = useRef<{ entryId: string; field: TemplateField } | undefined>(undefined);
  const { entry, preset } = props;
  if (!entry)
    return (
      <section className="preset-entry-detail empty-entry">
        <h3>Entry editor</h3>
        <p>Select an entry from the list, or add a new one.</p>
      </section>
    );

  const index = preset.entries.findIndex((item) => item.id === entry.id);
  const parsed = presetSchema.safeParse(preset);
  const issues = parsed.success
    ? []
    : parsed.error.issues.filter((issue) => issue.path[0] === 'entries' && issue.path[1] === index);
  const slots = preset.entries.filter(
    (item): item is Extract<PresetEntry, { kind: 'slot' }> =>
      item.kind === 'slot' &&
      item.enabled &&
      preset.inputs.find((input) => input.key === item.inputKey)?.dataType === 'messages',
  );
  const placement = entry.kind === 'message' ? entry.placement : undefined;
  const update = (partial: Partial<PresetEntry>) => props.onChange({ ...entry, ...partial } as PresetEntry);
  const insert = (token: string) => {
    if (entry.kind !== 'message') return;
    const field = hintTarget.current?.entryId === entry.id ? hintTarget.current.field : 'content';
    const element = { content: contentRef, name: nameRef, reasoning: reasoningRef }[field].current;
    const value = entry[field] ?? '';
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? start;
    update({ [field]: value.slice(0, start) + token + value.slice(end) });
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <section className="preset-entry-detail">
      <h3>Edit entry</h3>
      <fieldset disabled={props.readOnly} className="preset-entry-fields">
        <label>
          Display name{' '}
          <input value={entry.displayName} onChange={(event) => update({ displayName: event.target.value })} />
        </label>
        {entry.kind === 'slot' ? (
          <>
            <label>
              Input{' '}
              <select
                value={entry.inputKey}
                onChange={(event) => update({ inputKey: event.target.value } as Partial<PresetEntry>)}
              >
                {preset.inputs.map((input) => (
                  <option value={input.key} key={input.id}>
                    {presetInputLabel(input.key)} ({input.key}) · {input.dataType}
                  </option>
                ))}
                {!preset.inputs.some((input) => input.key === entry.inputKey) && (
                  <option value={entry.inputKey}>{entry.inputKey} · missing</option>
                )}
              </select>
            </label>
            <p className="hint">This slot places the selected input at this position in the final message list.</p>
            {preset.inputs.find((input) => input.key === entry.inputKey)?.dataType === 'text' && (
              <label>
                Role{' '}
                <select
                  value={entry.role}
                  onChange={(event) => update({ role: event.target.value as 'system' | 'user' | 'assistant' })}
                >
                  {['system', 'user', 'assistant'].map((role) => (
                    <option key={role}>{role}</option>
                  ))}
                </select>
              </label>
            )}
          </>
        ) : (
          <>
            <label>
              Role{' '}
              <select
                value={entry.role}
                onChange={(event) => update({ role: event.target.value as 'system' | 'user' | 'assistant' })}
              >
                {['system', 'user', 'assistant'].map((role) => (
                  <option key={role}>{role}</option>
                ))}
              </select>
            </label>
            <label>
              Name{' '}
              <input
                ref={nameRef}
                value={entry.name ?? ''}
                placeholder="Optional"
                onFocus={() => {
                  hintTarget.current = { entryId: entry.id, field: 'name' };
                }}
                onChange={(event) => update({ name: event.target.value || undefined })}
              />
            </label>
            <p className="hint">
              Message name sent to the model (a template, like the content). Left out when it renders empty.
            </p>
            <label>
              Content{' '}
              <textarea
                ref={contentRef}
                rows={12}
                value={entry.content}
                onFocus={() => {
                  hintTarget.current = { entryId: entry.id, field: 'content' };
                }}
                onChange={(event) => update({ content: event.target.value })}
              />
            </label>
            {entry.role === 'assistant' && (
              <>
                <label>
                  Reasoning{' '}
                  <textarea
                    ref={reasoningRef}
                    rows={5}
                    value={entry.reasoning ?? ''}
                    placeholder="Optional"
                    onFocus={() => {
                      hintTarget.current = { entryId: entry.id, field: 'reasoning' };
                    }}
                    onChange={(event) => update({ reasoning: event.target.value || undefined })}
                  />
                </label>
                <p className="hint">
                  Sent as this message's reasoning (a template, like the content), when the LLM node's reasoning setting
                  keeps it and the provider has a field for it. The entry is sent even with empty content.
                </p>
              </>
            )}
            <div className="template-hints">
              <small>Insert variable at cursor</small>
              {macroHints(preset.inputs, props.settings, props.state).map((variable) => (
                <button
                  type="button"
                  key={variable.expression}
                  title={variable.description}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => insert(variable.expression)}
                >
                  {variable.expression}
                </button>
              ))}
            </div>
            <label>
              Placement{' '}
              <select
                value={placement?.mode ?? 'ordered'}
                onChange={(event) => {
                  update({
                    placement:
                      event.target.value === 'ordered'
                        ? { mode: 'ordered' }
                        : { mode: 'depth', entryId: slots[0]?.id ?? '', depth: 0 },
                  });
                }}
              >
                <option value="ordered">Ordered</option>
                <option value="depth">Inside a messages slot</option>
              </select>
            </label>
            {placement?.mode === 'depth' && (
              <>
                <label>
                  Messages slot{' '}
                  <select
                    value={placement.entryId}
                    onChange={(event) => update({ placement: { ...placement, entryId: event.target.value } })}
                  >
                    {slots.map((slot) => (
                      <option value={slot.id} key={slot.id}>
                        {slot.displayName} · {slot.inputKey}
                      </option>
                    ))}
                    {!slots.some((slot) => slot.id === placement.entryId) && (
                      <option value={placement.entryId}>{placement.entryId || 'Choose a slot'}</option>
                    )}
                  </select>
                </label>
                <label>
                  Depth from end{' '}
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={placement.depth}
                    onChange={(event) => update({ placement: { ...placement, depth: Number(event.target.value) } })}
                  />
                </label>
                {slots.length === 0 && (
                  <p className="preset-warning">Add an enabled slot for a messages input to use depth placement.</p>
                )}
              </>
            )}
          </>
        )}
      </fieldset>
      {issues.length > 0 && (
        <div className="preset-warnings" role="alert">
          {issues.map((issue, issueIndex) => (
            <p key={issueIndex}>{issue.message}</p>
          ))}
        </div>
      )}
    </section>
  );
}

import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { IconButton } from '../../components/IconButton.js';
import { moveItem } from '../../components/sortable/moveItem.js';
import { SortableList } from '../../components/sortable/SortableList.js';
import { useRowIds } from '../../components/sortable/useRowIds.js';
import type { ProviderDraft } from './providerDraft.js';

interface ProviderFieldsProps {
  draft: ProviderDraft;
  /** Secret names saved in Settings, offered for the secret field (any name can still be typed). */
  secretNames: readonly string[];
  onChange(draft: ProviderDraft): void;
}

const SECRET_LIST_ID = 'provider-secret-names';

/** The form part of the provider editor: name, URL, secret, message names and reasoning fields. */
export function ProviderFields({ draft, secretNames, onChange }: ProviderFieldsProps) {
  const set = <K extends keyof ProviderDraft>(key: K, value: ProviderDraft[K]) => onChange({ ...draft, [key]: value });
  const secret = draft.secret.trim();
  return (
    <>
      <label>
        Name
        <input value={draft.name} onChange={(event) => set('name', event.target.value)} />
      </label>
      <label>
        Base URL
        <input
          value={draft.baseUrl}
          placeholder="https://api.example.com/v1"
          onChange={(event) => set('baseUrl', event.target.value)}
        />
        <small>Requests go to {(draft.baseUrl || '<base URL>').replace(/\/+$/, '')}/chat/completions.</small>
      </label>
      <label>
        Secret
        <input
          value={draft.secret}
          list={SECRET_LIST_ID}
          placeholder="None"
          onChange={(event) => set('secret', event.target.value)}
        />
        <datalist id={SECRET_LIST_ID}>
          {secretNames.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <small>
          {secret && !secretNames.includes(secret)
            ? `No secret named "${secret}" in Settings yet. Add it there before running.`
            : 'Name of an API key saved in Settings. Leave empty for local servers that need no key.'}
        </small>
      </label>
      <MessageNameField value={draft.messageName} onChange={(value) => set('messageName', value)} />
      <ReasoningFields fields={draft.reasoningFields} onChange={(fields) => set('reasoningFields', fields)} />
    </>
  );
}

/** Where a message's `name` goes on the wire, or that it is never sent. */
function MessageNameField({ value, onChange }: { value: string | null; onChange(value: string | null): void }) {
  const sending = value !== null;
  return (
    <div className="provider-field">
      <label>
        Message names
        <select
          value={sending ? 'send' : 'omit'}
          onChange={(event) => onChange(event.target.value === 'send' ? 'name' : null)}
        >
          <option value="send">Send as a message field</option>
          <option value="omit">Don't send names</option>
        </select>
      </label>
      {sending && (
        <label>
          Field name
          <input value={value} onChange={(event) => onChange(event.target.value)} />
        </label>
      )}
      <small>
        {sending
          ? 'Each message with a name carries it in this field (OpenAI uses "name").'
          : 'Message names are dropped. Use this for backends that reject the field.'}
      </small>
    </div>
  );
}

/** An ordered list of response fields read for the reasoning trace; the first non-empty one wins. */
function ReasoningFields({ fields, onChange }: { fields: readonly string[]; onChange(fields: string[]): void }) {
  // The fields are plain strings: the ids that drag needs live beside the list, not in the draft.
  const rows = useRowIds(fields.length);
  const replace = (index: number, value: string) => onChange(fields.map((field, i) => (i === index ? value : field)));
  const remove = (index: number) => {
    rows.remove(index);
    onChange(fields.filter((_, i) => i !== index));
  };
  const move = (from: number, to: number) => {
    rows.move(from, to);
    onChange(moveItem(fields, from, to));
  };
  return (
    <fieldset className="provider-field provider-reasoning">
      <legend>Reasoning fields</legend>
      <SortableList
        className="sortable-contents"
        rowClassName={() => 'provider-reasoning-row'}
        items={fields}
        getId={(_, index) => rows.ids[index] as string}
        label={(field) => field.trim() || 'empty field'}
        onMove={move}
        renderItem={(field, row) => (
          <>
            {row.handle}
            <input
              aria-label={`Reasoning field ${row.index + 1}`}
              value={field}
              onChange={(event) => replace(row.index, event.target.value)}
            />
            <IconButton icon={ArrowUp} label="Move up" disabled={!row.moveUp} onClick={row.moveUp} />
            <IconButton icon={ArrowDown} label="Move down" disabled={!row.moveDown} onClick={row.moveDown} />
            <IconButton icon={X} label="Remove field" onClick={() => remove(row.index)} />
          </>
        )}
      />
      <button type="button" onClick={() => onChange([...fields, ''])}>
        + Field
      </button>
      <small>Read from each streamed delta or response message, in this order; the first non-empty one wins.</small>
    </fieldset>
  );
}

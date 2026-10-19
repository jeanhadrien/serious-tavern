import { ArrowDown, ArrowUp } from 'lucide-react';
import { presetInputLabel, type Preset, type PresetEntry } from '@st/shared';
import { IconButton } from '../../components/IconButton.js';
import { moveItem } from '../../components/sortable/moveItem.js';
import { SortableList } from '../../components/sortable/SortableList.js';

export const newId = () => crypto.randomUUID();

const newMessage = (): PresetEntry => ({
  id: newId(),
  displayName: 'New message',
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

// Read-only lists still allow selecting entries, so they can be browsed; every change control is disabled.
export function EntryList(props: {
  preset: Preset;
  readOnly: boolean;
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
      displayName: presetInputLabel(input.key),
      kind: 'slot',
      enabled: true,
      inputKey: input.key,
      role: 'user',
    };
    updateEntries([...props.preset.entries, entry]);
    props.onSelect(entry.id);
  };
  const duplicate = (entry: PresetEntry) => {
    const copy = { ...entry, id: newId(), displayName: `${entry.displayName} copy` } as PresetEntry;
    updateEntries([...props.preset.entries, copy]);
    props.onSelect(copy.id);
  };
  const selectedIndex = props.preset.entries.findIndex((entry) => entry.id === props.selectedId);
  const reorder = (from: number, to: number) => updateEntries(moveItem(props.preset.entries, from, to));
  const move = (offset: -1 | 1) => reorder(selectedIndex, selectedIndex + offset);
  const getDepthLabel = (entry: PresetEntry) => {
    if (entry.kind !== 'message' || entry.placement.mode !== 'depth') return undefined;
    const entryId = entry.placement.entryId;
    const target = props.preset.entries.find(
      (item): item is Extract<PresetEntry, { kind: 'slot' }> => item.id === entryId && item.kind === 'slot',
    );
    return target?.inputKey ?? 'slot';
  };
  return (
    <section className="preset-entry-list">
      <div className="toolbar">
        <h3>Entries</h3>
        <div>
          <IconButton
            icon={ArrowUp}
            label="Move selected entry up"
            disabled={props.readOnly || selectedIndex <= 0}
            onClick={() => move(-1)}
          />
          <IconButton
            icon={ArrowDown}
            label="Move selected entry down"
            disabled={props.readOnly || selectedIndex === -1 || selectedIndex === props.preset.entries.length - 1}
            onClick={() => move(1)}
          />
          <button onClick={addMessage} disabled={props.readOnly}>
            + Message
          </button>
          <button onClick={addSlot} disabled={props.readOnly || !props.preset.inputs.length}>
            + Slot
          </button>
        </div>
      </div>
      <SortableList
        className="entry-list-scroll"
        items={props.preset.entries}
        getId={(entry) => entry.id}
        label={(entry) => entry.displayName}
        disabled={props.readOnly}
        onMove={reorder}
        rowClassName={(entry) =>
          ['preset-entry-row', entry.id === props.selectedId && 'selected', !entry.enabled && 'disabled']
            .filter(Boolean)
            .join(' ')
        }
        renderItem={(entry, row) => (
          <>
            {row.handle}
            <button className="preset-entry-select" onClick={() => props.onSelect(entry.id)}>
              <span>
                {entryIcon(entry, props.preset)} {entry.displayName}
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
                disabled={props.readOnly}
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
            <button
              title="Duplicate entry"
              aria-label="Duplicate entry"
              disabled={props.readOnly}
              onClick={() => duplicate(entry)}
            >
              ⧉
            </button>
            <button
              title="Delete entry"
              aria-label="Delete entry"
              disabled={props.readOnly}
              onClick={() => {
                updateEntries(props.preset.entries.filter((item) => item.id !== entry.id));
                if (props.selectedId === entry.id) props.onSelect('');
              }}
            >
              ×
            </button>
          </>
        )}
      />
    </section>
  );
}

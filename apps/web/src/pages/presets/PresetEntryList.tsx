import { useState, type DragEvent } from 'react';
import { GripVertical } from 'lucide-react';
import { presetInputLabel, type Preset, type PresetEntry } from '@st/shared';

export const newId = () => crypto.randomUUID();

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

// Moves the entry with fromId to the entry with toId (before it, or after
// it when dropping below its midpoint); a null toId appends to the end.
// Returns the original array when nothing would change.
export function reorderEntries(
  entries: PresetEntry[],
  fromId: string,
  toId: string | null,
  after: boolean,
): PresetEntry[] {
  const moving = entries.find((entry) => entry.id === fromId);
  if (!moving) return entries;
  const rest = entries.filter((entry) => entry.id !== fromId);
  if (toId === null) return [...rest, moving];
  const to = rest.findIndex((entry) => entry.id === toId);
  if (to === -1) return entries;
  const at = after ? to + 1 : to;
  return [...rest.slice(0, at), moving, ...rest.slice(at)];
}

export function EntryList(props: {
  preset: Preset;
  selectedId: string;
  onChange(preset: Preset): void;
  onSelect(id: string): void;
}) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null);
  const updateEntries = (entries: PresetEntry[]) => props.onChange({ ...props.preset, entries });
  const clearDrag = () => {
    setDraggedId(null);
    setDropTarget(null);
  };
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
      name: presetInputLabel(input.key),
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
  const startDrag = (event: DragEvent<HTMLSpanElement>, id: string) => {
    event.dataTransfer.setData('text/plain', id);
    event.dataTransfer.effectAllowed = 'move';
    setDraggedId(id);
  };
  const belowMidpoint = (event: DragEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY > rect.top + rect.height / 2;
  };
  const hoverRow = (event: DragEvent<HTMLDivElement>, entry: PresetEntry) => {
    if (!draggedId || draggedId === entry.id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const after = belowMidpoint(event);
    setDropTarget((prev) => (prev && prev.id === entry.id && prev.after === after ? prev : { id: entry.id, after }));
  };
  const dropOnRow = (event: DragEvent<HTMLDivElement>, entry: PresetEntry) => {
    event.preventDefault();
    event.stopPropagation();
    const id = draggedId;
    clearDrag();
    if (!id || id === entry.id) return;
    updateEntries(reorderEntries(props.preset.entries, id, entry.id, belowMidpoint(event)));
  };
  const dropAtEnd = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const id = draggedId;
    clearDrag();
    const entries = props.preset.entries;
    if (!id || (entries.length > 0 && entries[entries.length - 1]!.id === id)) return;
    updateEntries(reorderEntries(entries, id, null, false));
  };
  const rowClass = (entry: PresetEntry) => {
    const classes = ['preset-entry-row'];
    if (entry.id === props.selectedId) classes.push('selected');
    if (!entry.enabled) classes.push('disabled');
    if (entry.id === draggedId) classes.push('dragging');
    if (dropTarget && dropTarget.id === entry.id && entry.id !== draggedId)
      classes.push(dropTarget.after ? 'drop-below' : 'drop-above');
    return classes.join(' ');
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
      <div className="entry-list-scroll" onDragOver={(event) => event.preventDefault()} onDrop={dropAtEnd}>
        {props.preset.entries.map((entry, index) => (
          <div
            className={rowClass(entry)}
            key={entry.id}
            onDragOver={(event) => hoverRow(event, entry)}
            onDragLeave={() => setDropTarget((prev) => (prev && prev.id === entry.id ? null : prev))}
            onDrop={(event) => dropOnRow(event, entry)}
          >
            <span
              className="drag-handle"
              title="Drag to reorder"
              aria-hidden={true}
              draggable
              onDragStart={(event) => startDrag(event, entry.id)}
              onDragEnd={clearDrag}
            >
              <GripVertical size={14} />
            </span>
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
            <button title="Move up" aria-label="Move up" disabled={index === 0} onClick={() => move(index, -1)}>
              ↑
            </button>
            <button
              title="Move down"
              aria-label="Move down"
              disabled={index === props.preset.entries.length - 1}
              onClick={() => move(index, 1)}
            >
              ↓
            </button>
            <button title="Duplicate entry" aria-label="Duplicate entry" onClick={() => duplicate(entry)}>
              ⧉
            </button>
            <button
              title="Delete entry"
              aria-label="Delete entry"
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

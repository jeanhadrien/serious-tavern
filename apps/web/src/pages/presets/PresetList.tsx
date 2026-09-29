import type { Preset } from '@st/shared';

export function PresetList(props: {
  presets: Preset[];
  selectedId?: string;
  dirtyId?: string;
  onSelect(preset: Preset): void;
  onCreate(): void;
  onDuplicate(preset: Preset): void;
  onDelete(preset: Preset): void;
}) {
  return <aside className="preset-list">
    <div className="toolbar"><h2>Presets</h2><button className="primary" onClick={props.onCreate}>+ New</button></div>
    {props.presets.map(preset => <div className={`session-row ${props.selectedId === preset.id ? 'selected' : ''}`} key={preset.id}>
      <button className="session-link" onClick={() => props.onSelect(preset)}>
        {preset.name}{props.dirtyId === preset.id && <span className="dirty-dot" title="Unsaved changes"> •</span>}
      </button>
      <button title="Duplicate preset" aria-label={`Duplicate ${preset.name}`} onClick={() => props.onDuplicate(preset)}>⧉</button>
      <button title="Delete preset" aria-label={`Delete ${preset.name}`} onClick={() => props.onDelete(preset)}>×</button>
    </div>)}
  </aside>;
}

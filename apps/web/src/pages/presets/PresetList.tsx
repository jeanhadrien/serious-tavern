import { Copy, Plus, Trash2 } from 'lucide-react';
import type { Preset } from '@st/shared';
import { IconButton } from '../../components/IconButton.js';

export function PresetList(props: {
  presets: Preset[];
  selectedId?: string;
  dirtyId?: string;
  onSelect(preset: Preset): void;
  onCreate(): void;
  onDuplicate(preset: Preset): void;
  onDelete(preset: Preset): void;
}) {
  return (
    <aside className="sidebar resource-list" aria-label="Presets">
      <div className="toolbar">
        <h2>Presets</h2>
        <button type="button" className="primary" onClick={props.onCreate}>
          <Plus size={18} aria-hidden="true" /> New
        </button>
      </div>
      {props.presets.map((preset) => (
        <div className={`session-row ${props.selectedId === preset.id ? 'selected' : ''}`} key={preset.id}>
          <button className="session-link" onClick={() => props.onSelect(preset)}>
            {preset.name}
            {preset.source && (
              <span
                className={`source-badge${preset.source.missing ? ' missing' : ''}`}
                title={preset.source.missing ? 'The source file is gone from the install' : 'Read-only imported preset'}
              >
                {preset.source.missing ? 'source missing' : 'imported'}
              </span>
            )}
            {props.dirtyId === preset.id && (
              <span className="dirty-dot" title="Unsaved changes">
                {' '}
                •
              </span>
            )}
          </button>
          <IconButton icon={Copy} label={`Duplicate ${preset.name}`} onClick={() => props.onDuplicate(preset)} />
          <IconButton icon={Trash2} label={`Delete ${preset.name}`} onClick={() => props.onDelete(preset)} />
        </div>
      ))}
    </aside>
  );
}

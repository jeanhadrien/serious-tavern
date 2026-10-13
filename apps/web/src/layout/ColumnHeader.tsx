import { IconButton } from '../components/IconButton.js';
import { VIEW_INFO } from './views.js';
import type { IconId, ResourceId } from './state.js';

interface ColumnHeaderProps {
  area: string;
  label: string;
  icons: readonly IconId[];
  active: IconId;
  /** Resources whose editor has unsaved changes. */
  dirty: Record<ResourceId, boolean>;
  onSelect: (id: IconId) => void;
}

/** The icon row of a side column; each icon switches what the column shows. */
export function ColumnHeader({ area, label, icons, active, dirty, onSelect }: ColumnHeaderProps) {
  return (
    <nav className="column-header" style={{ gridArea: area }} aria-label={label}>
      {icons.map((id) => (
        <IconButton
          key={id}
          icon={VIEW_INFO[id].icon}
          label={VIEW_INFO[id].label}
          className={id === active ? 'active' : ''}
          aria-pressed={id === active}
          dot={id !== 'chat' && id !== 'chats' && dirty[id]}
          onClick={() => onSelect(id)}
        />
      ))}
    </nav>
  );
}

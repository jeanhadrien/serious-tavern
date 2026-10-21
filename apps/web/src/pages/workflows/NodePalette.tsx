import { useState } from 'react';
import { portDataTypes } from '@st/shared/ports';
import type { NodeTypeDescriptor } from '@st/shared';
import { groupByCategory } from './nodeTypeOrder.js';
import { isCategoryOpen, loadPaletteOpen, savePaletteOpen, type PaletteOpen } from './paletteOpen.js';
import { portColors } from './port-colors.js';

function TypeButton({
  type,
  showCategory,
  onAdd,
}: {
  type: NodeTypeDescriptor;
  showCategory: boolean;
  onAdd: (descriptor: NodeTypeDescriptor) => void;
}) {
  return (
    <button
      title={type.description}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('application/st-node-type', type.type);
        event.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => onAdd(type)}
    >
      {showCategory && <small>{type.category}</small>}
      {type.label} +
    </button>
  );
}

export function NodePalette({
  types,
  onAdd,
}: {
  types: NodeTypeDescriptor[];
  onAdd: (descriptor: NodeTypeDescriptor) => void;
}) {
  const [open, setOpen] = useState<PaletteOpen>(loadPaletteOpen);
  const toggle = (category: string, value: boolean) => {
    if (isCategoryOpen(open, category) === value) return; // `toggle` also fires when the page first draws a group.
    const next = { ...open, [category]: value };
    setOpen(next);
    savePaletteOpen(next);
  };
  return (
    <aside className="palette">
      <h3>Nodes</h3>
      {groupByCategory(types).map(({ category, types: group }) =>
        // A category with one type is a plain button: a disclosure would cost a click and save nothing.
        group.length === 1 ? (
          <TypeButton key={category} type={group[0]!} showCategory onAdd={onAdd} />
        ) : (
          <details
            key={category}
            className="palette-group"
            open={isCategoryOpen(open, category)}
            onToggle={(event) => toggle(category, event.currentTarget.open)}
          >
            <summary>{category}</summary>
            <div className="palette-group-types">
              {group.map((type) => (
                <TypeButton key={type.type} type={type} showCategory={false} onAdd={onAdd} />
              ))}
            </div>
          </details>
        ),
      )}
      <p className="hint">
        Click to add at center or drag onto the canvas. Drag nodes to move; connect handles; press Delete or the bin
        button to remove the selection.
      </p>
      <div className="port-legend">
        <h3>Port types</h3>
        {portDataTypes.map((type) => (
          <span key={type}>
            <i style={{ background: portColors[type] }} />
            {type}
          </span>
        ))}
      </div>
    </aside>
  );
}

import { portDataTypes } from '@st/shared/ports';
import type { NodeTypeDescriptor } from '@st/shared';
import { portColors } from './port-colors.js';

export function NodePalette({
  types,
  onAdd,
}: {
  types: NodeTypeDescriptor[];
  onAdd: (descriptor: NodeTypeDescriptor) => void;
}) {
  return (
    <aside className="palette">
      <h3>Nodes</h3>
      {types.map((t) => (
        <button
          title={t.description}
          key={t.type}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData('application/st-node-type', t.type);
            event.dataTransfer.effectAllowed = 'copy';
          }}
          onClick={() => onAdd(t)}
        >
          <small>{t.category}</small>
          {t.label} +
        </button>
      ))}
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

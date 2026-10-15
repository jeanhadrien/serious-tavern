import { ArrowDown, ArrowUp, X } from 'lucide-react';
import type { NodePanelContext } from './types.js';
import { addId, moveId, pickerRows, removeId } from './collectionConfig.js';

interface CollectionPickerProps {
  ids: unknown;
  onChange(ids: string[]): void;
  context?: NodePanelContext;
  /** Recall reads collections in this order, so it can be changed. */
  ordered?: boolean;
}

/** The collections a Recall or Draw node reads: picked from the catalog, in config order. */
export function CollectionPicker({ ids, onChange, context, ordered = false }: CollectionPickerProps) {
  const catalog = context?.collections ?? [];
  const rows = pickerRows(ids, catalog);
  const picked = rows.map((row) => row.id);
  const available = catalog.filter((item) => !picked.includes(item.id));
  const link = (id: string) => {
    const to = `/collections?id=${encodeURIComponent(id)}`;
    return context?.renderLink ? context.renderLink(to, 'Edit ↗') : <a href={to}>Edit ↗</a>;
  };
  return (
    <div className="config-field collection-picker">
      <span>Collections</span>
      {rows.length > 0 && (
        <ul className="collection-picker-rows">
          {rows.map((row, index) => (
            <li key={row.id} className={row.known ? undefined : 'unknown'}>
              <span className="collection-picker-name">{row.name}</span>
              {row.known && link(row.id)}
              {ordered && rows.length > 1 && (
                <>
                  <button
                    type="button"
                    aria-label={`Move ${row.name} up`}
                    title="Move up"
                    disabled={index === 0}
                    onClick={() => onChange(moveId(picked, index, -1))}
                  >
                    <ArrowUp size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${row.name} down`}
                    title="Move down"
                    disabled={index === rows.length - 1}
                    onClick={() => onChange(moveId(picked, index, 1))}
                  >
                    <ArrowDown size={14} aria-hidden="true" />
                  </button>
                </>
              )}
              <button
                type="button"
                aria-label={`Remove ${row.name}`}
                title="Remove"
                onClick={() => onChange(removeId(picked, row.id))}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {catalog.length ? (
        available.length > 0 && (
          <select
            aria-label="Add a collection"
            value=""
            onChange={(event) => event.target.value && onChange(addId(picked, event.target.value))}
          >
            <option value="">Add a collection…</option>
            {available.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        )
      ) : (
        <small className="hint">Create a collection in the Collections list (right column) first.</small>
      )}
    </div>
  );
}

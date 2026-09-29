import { useRef, useState } from 'react';
import type { Character, Persona } from '@st/shared';
import { EntityPortrait } from './EntityAvatar.js';

export function EntityList<T extends Character | Persona>({
  type,
  title,
  importLabel,
  accept,
  list,
  selectedId,
  dirty,
  onSelect,
  onCreate,
  onImport,
}: {
  type: 'characters' | 'personas';
  title: string;
  importLabel: string;
  accept: string;
  list: T[];
  selectedId?: string;
  dirty: boolean;
  onSelect: (item: T) => void;
  onCreate: () => Promise<void>;
  onImport: (files: File[]) => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const importInput = useRef<HTMLInputElement>(null);
  const filtered = list.filter((item) => item.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <aside className="entity-list">
      <div className="toolbar">
        <h2>{title}</h2>
        <button className="primary" onClick={() => void onCreate()}>
          + New
        </button>
      </div>
      <input
        aria-label={`Search ${type}`}
        placeholder={`Search ${type}…`}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <button className="entity-import" onClick={() => importInput.current?.click()}>
        {importLabel}
      </button>
      <input
        ref={importInput}
        hidden
        type="file"
        multiple
        accept={accept}
        onChange={(event) => {
          void onImport(Array.from(event.target.files ?? []));
          event.target.value = '';
        }}
      />
      {filtered.map((item) => (
        <button
          className={`entity-row ${selectedId === item.id ? 'selected' : ''}`}
          key={item.id}
          onClick={() => onSelect(item)}
        >
          <EntityPortrait type={type} item={item} />
          <span>
            {item.name}
            {dirty && selectedId === item.id && <i className="dirty-dot"> •</i>}
          </span>
        </button>
      ))}
    </aside>
  );
}

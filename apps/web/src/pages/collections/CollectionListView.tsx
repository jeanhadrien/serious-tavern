import { useState } from 'react';
import type { Collection, CollectionSummary } from '@st/shared';
import { useLayoutActions } from '../../layout/LayoutActions.js';
import { collectionEditorStore, collectionsStore, useEditorState, useList } from '../../stores/index.js';
import { createCollection } from './collectionActions.js';
import './collections.css';

const entryCount = (count: number) => `${count} ${count === 1 ? 'entry' : 'entries'}`;

/** The collections list shown in R: picking one opens it in the editor that replaces the list. */
export function CollectionListView() {
  const collections = useList(collectionsStore);
  const { currentId, dirty } = useEditorState(collectionEditorStore);
  const { openEditor } = useLayoutActions();
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const filtered = collections.filter((item) => item.name.toLowerCase().includes(query));

  const open = (item: CollectionSummary | Collection) => {
    collectionEditorStore.open(structuredClone(item));
    openEditor('collections');
  };
  const create = async () => {
    const created = await createCollection();
    if (created) open(created);
  };

  return (
    <aside className="collection-list" aria-label="Collections">
      <div className="toolbar">
        <h2>Collections</h2>
        <button type="button" className="primary" onClick={() => void create()}>
          + New
        </button>
      </div>
      <p className="hint">Lorebooks and decks: entries that Recall and Draw nodes read.</p>
      <input
        aria-label="Search collections"
        placeholder="Search collections…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      {filtered.map((item) => (
        <button
          type="button"
          key={item.id}
          className={`collection-row ${currentId === item.id ? 'selected' : ''}`}
          onClick={() => open(item)}
        >
          <span className="collection-row-name">
            {item.name}
            {dirty && currentId === item.id && <i className="dirty-dot"> •</i>}
          </span>
          <small>{entryCount(item.entryCount)}</small>
          {item.description && <small className="collection-row-description">{item.description}</small>}
        </button>
      ))}
      {!collections.length && <p className="hint">No collections yet.</p>}
    </aside>
  );
}

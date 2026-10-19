import { useRef, useState } from 'react';
import type { Character, Persona } from '@st/shared';
import { useLayoutActions } from '../../layout/LayoutActions.js';
import { useEditorState, useList } from '../../stores/index.js';
import { createEntity, importEntityFiles } from './entityActions.js';
import { EntityDropZone } from './EntityDropZone.js';
import { EntityPortrait } from './EntityAvatar.js';
import type { EntityKind } from './entityKinds.js';

/** The character or persona list shown in R: picking an item opens it in the editor that replaces the list. */
export function EntityListView<T extends Character | Persona>({ kind }: { kind: EntityKind<T> }) {
  const list = useList(kind.listStore);
  const { currentId, dirty } = useEditorState(kind.editorStore);
  const { openEditor } = useLayoutActions();
  const [search, setSearch] = useState('');
  const importInput = useRef<HTMLInputElement>(null);
  const filtered = list.filter((item) => item.name.toLowerCase().includes(search.toLowerCase()));

  const show = (item: T) => {
    kind.editorStore.open(structuredClone(item));
    openEditor(kind.type);
  };
  const open = async (item: T) => {
    if (await kind.editorStore.confirmSwitch(item.id)) show(item);
  };
  // Create and import write on the server, so the question comes first.
  const create = async () => {
    if (!(await kind.editorStore.confirmSwitch())) return;
    const item = await createEntity(kind);
    if (item) show(item);
  };
  const importFiles = async (files: File[]) => {
    if (!kind.prepareFiles(files).length || !(await kind.editorStore.confirmSwitch())) return;
    const item = await importEntityFiles(kind, files);
    if (item) show(item);
  };

  return (
    <EntityDropZone dropLabel={kind.dropLabel} importFiles={importFiles}>
      <aside className="entity-list" aria-label={kind.title}>
        <div className="toolbar">
          <h2>{kind.title}</h2>
          <button type="button" className="primary" onClick={() => void create()}>
            + New
          </button>
        </div>
        <input
          aria-label={`Search ${kind.type}`}
          placeholder={`Search ${kind.type}…`}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <button type="button" className="entity-import" onClick={() => importInput.current?.click()}>
          {kind.importLabel}
        </button>
        <input
          ref={importInput}
          hidden
          type="file"
          multiple
          accept={kind.accept}
          onChange={(event) => {
            void importFiles(Array.from(event.target.files ?? []));
            event.target.value = '';
          }}
        />
        {filtered.map((item) => (
          <button
            type="button"
            className={`entity-row ${currentId === item.id ? 'selected' : ''}`}
            key={item.id}
            onClick={() => void open(item)}
          >
            <EntityPortrait type={kind.type} item={item} />
            <span>
              {item.name}
              {dirty && currentId === item.id && <i className="dirty-dot"> •</i>}
            </span>
          </button>
        ))}
      </aside>
    </EntityDropZone>
  );
}

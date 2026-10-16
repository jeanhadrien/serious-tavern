import type { StateDefinition } from '@st/shared';
import { useLayoutActions } from '../../layout/LayoutActions.js';
import { stateDefinitionEditorStore, stateDefinitionsStore, useEditorState, useList } from '../../stores/index.js';
import { createStateDefinition, showStateDefinition } from './stateDefinitionActions.js';
import './stateDefinitions.css';

const keyCount = (count: number) => `${count} ${count === 1 ? 'key' : 'keys'}`;

/** The state definitions list shown in L: picking one opens it in the editor that replaces the list. */
export function StateDefinitionListView() {
  const definitions = useList(stateDefinitionsStore);
  const { currentId, dirty } = useEditorState(stateDefinitionEditorStore);
  const { openEditor } = useLayoutActions();

  const open = (definition: StateDefinition) => showStateDefinition(definition, () => openEditor('stateDefinitions'));
  const create = async () => {
    const created = await createStateDefinition();
    if (created) open(created);
  };

  return (
    <aside className="state-list" aria-label="State definitions">
      <div className="toolbar">
        <h2>State definitions</h2>
        <button type="button" className="primary" onClick={() => void create()}>
          + New
        </button>
      </div>
      <p className="hint">
        The keys a chat remembers between turns. Workflow nodes and templates use them: {'{{state.<name>.<key>}}'}.
      </p>
      {definitions.map((definition) => (
        <button
          type="button"
          key={definition.id}
          className={`state-row ${currentId === definition.id ? 'selected' : ''}`}
          onClick={() => open(definition)}
        >
          <span className="state-row-name">
            {definition.name}
            {dirty && currentId === definition.id && <i className="dirty-dot"> •</i>}
          </span>
          <small>{keyCount(Object.keys(definition.keys).length)}</small>
          {definition.description && <small className="state-row-description">{definition.description}</small>}
        </button>
      ))}
      {!definitions.length && <p className="hint">No state definitions yet.</p>}
    </aside>
  );
}

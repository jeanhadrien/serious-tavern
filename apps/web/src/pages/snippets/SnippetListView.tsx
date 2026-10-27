import type { Snippet } from '@st/shared';
import { useLayoutActions } from '../../layout/LayoutActions.js';
import { snippetEditorStore, snippetsStore, useEditorState, useList } from '../../stores/index.js';
import { createSnippet } from './snippetActions.js';
import './snippets.css';

const USAGE = '{{snippets.<name>}}';

/** The snippets list shown in L: picking one opens it in the editor that replaces the list. */
export function SnippetListView() {
  const snippets = useList(snippetsStore);
  const { currentId, dirty } = useEditorState(snippetEditorStore);
  const { openEditor } = useLayoutActions();

  const show = (snippet: Snippet) => {
    snippetEditorStore.open(structuredClone(snippet));
    openEditor('snippets');
  };
  const open = async (snippet: Snippet) => {
    if (await snippetEditorStore.confirmSwitch(snippet.id)) show(snippet);
  };
  const create = async () => {
    if (!(await snippetEditorStore.confirmSwitch())) return;
    const created = await createSnippet();
    if (created) show(created);
  };

  return (
    <aside className="snippet-list" aria-label="Snippets">
      <div className="toolbar">
        <h2>Snippets</h2>
        <button type="button" className="primary" onClick={() => void create()}>
          + New
        </button>
      </div>
      <p className="hint">
        Text you write once and reuse in any template as <code>{USAGE}</code>.
      </p>
      {snippets.map((snippet) => (
        <button
          type="button"
          key={snippet.id}
          className={`snippet-row ${currentId === snippet.id ? 'selected' : ''}`}
          onClick={() => void open(snippet)}
        >
          <span className="snippet-row-name">
            {snippet.name}
            {dirty && currentId === snippet.id && <i className="dirty-dot"> •</i>}
          </span>
          {snippet.description && <small>{snippet.description}</small>}
        </button>
      ))}
    </aside>
  );
}

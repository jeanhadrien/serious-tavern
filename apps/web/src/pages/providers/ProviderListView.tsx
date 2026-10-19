import type { ProviderView } from '@st/shared';
import { useLayoutActions } from '../../layout/LayoutActions.js';
import { providerEditorStore, providersStore, useEditorState, useList } from '../../stores/index.js';
import { createProvider } from './providerActions.js';
import './providers.css';

/** The providers list shown in L: picking one opens it in the editor that replaces the list. */
export function ProviderListView() {
  const providers = useList(providersStore);
  const { currentId, dirty } = useEditorState(providerEditorStore);
  const { openEditor } = useLayoutActions();

  const show = (provider: ProviderView) => {
    providerEditorStore.open(structuredClone(provider));
    openEditor('providers');
  };
  const open = async (provider: ProviderView) => {
    if (await providerEditorStore.confirmSwitch(provider.id)) show(provider);
  };
  const create = async () => {
    if (!(await providerEditorStore.confirmSwitch())) return;
    const created = await createProvider();
    if (created) show(created);
  };

  return (
    <aside className="provider-list" aria-label="Providers">
      <div className="toolbar">
        <h2>Providers</h2>
        <button type="button" className="primary" onClick={() => void create()}>
          + New
        </button>
      </div>
      <p className="hint">OpenAI-compatible backends that LLM nodes send requests to.</p>
      {providers.map((provider) => (
        <button
          type="button"
          key={provider.id}
          className={`provider-row ${currentId === provider.id ? 'selected' : ''}`}
          onClick={() => void open(provider)}
        >
          <span className="provider-row-name">
            {provider.name}
            {provider.builtIn && <small className="provider-badge">built-in</small>}
            {dirty && currentId === provider.id && <i className="dirty-dot"> •</i>}
          </span>
          <small>{provider.baseUrl}</small>
        </button>
      ))}
    </aside>
  );
}

import { useEffect, useState } from 'react';
import type { ProviderView } from '@st/shared';
import { secretsApi } from '../../api.js';
import { useLayoutActions } from '../../layout/LayoutActions.js';
import { providerEditorStore, providersStore, useEditorCommands, useEditorSaver } from '../../stores/index.js';
import { useFileSync } from '../useFileSync.js';
import { deleteProvider, duplicateProvider, saveProvider } from './providerActions.js';
import { classifyProviderChange, draftChanged, draftToBody, toDraft, type ProviderDraft } from './providerDraft.js';
import { confirmDelete } from '../../components/dialog/dialogStore.js';

const PROVIDERS = {
  event: 'providers.changed',
  noun: 'provider',
  removedHint: 'Saving will fail; create a new provider and copy your changes into it.',
} as const;

/**
 * The open provider and its draft. The editor stays mounted while hidden, so the draft survives the back arrow.
 * The list opens providers through `providerEditorStore`; edits made on disk reload a clean draft and never
 * replace a dirty one.
 */
export function useProviderEditor() {
  const { closeEditor } = useLayoutActions();
  const [provider, setProvider] = useState<ProviderView>();
  const [draft, setDraft] = useState<ProviderDraft>();
  const [errors, setErrors] = useState<string[]>([]);
  const [secretNames, setSecretNames] = useState<string[]>([]);
  const readOnly = !!provider?.builtIn;
  const dirty = !!provider && !!draft && draftChanged(draft, provider);

  const open = (item: ProviderView) => {
    setProvider(item);
    setDraft(toDraft(item));
    setErrors([]);
    // Secrets have no change events: re-read their names whenever a provider opens.
    void secretsApi
      .list({ silent: true })
      .then((secrets) => setSecretNames(secrets.map((secret) => secret.name)))
      .catch(() => {});
  };
  const clear = () => {
    setProvider(undefined);
    setDraft(undefined);
    setErrors([]);
  };

  const openId = provider?.id;
  useEffect(() => providerEditorStore.report(openId, dirty), [openId, dirty]);
  useEditorCommands(providerEditorStore, {
    open,
    close: (id) => {
      if (provider?.id === id) clear();
    },
  });

  const deleting = useFileSync<ProviderView, ProviderDraft>({
    resource: PROVIDERS,
    item: provider,
    draft,
    baseline: (item) => JSON.stringify(toDraft(item)),
    refresh: () => providersStore.refresh(),
    classify: ({ item, draft: current, deleting: own }, fresh) =>
      classifyProviderChange({ provider: item, draft: current, deleting: own }, fresh),
    onReload: open,
    onClose: () => {
      clear();
      closeEditor('providers');
    },
  });

  const change = (next: ProviderDraft) => {
    if (readOnly) return;
    setDraft(next);
    setErrors([]);
  };
  /** Resolves true when saved; false on validation errors, an API error (toasted) or a read-only provider. */
  const save = async (): Promise<boolean> => {
    if (!provider || !draft || readOnly) return false;
    const result = draftToBody(draft, provider.kind);
    if (!result.ok) {
      setErrors(result.errors);
      return false;
    }
    const saved = await saveProvider(provider.id, result.body);
    if (saved) open(saved);
    return !!saved;
  };
  useEditorSaver(providerEditorStore, { label: () => draft?.name ?? provider?.name ?? '', save });
  const duplicate = async () => {
    if (!provider || !(await providerEditorStore.confirmSwitch())) return;
    const copy = await duplicateProvider(provider);
    if (copy) open(copy);
  };
  const remove = async () => {
    if (!provider || readOnly || !(await confirmDelete(`Delete provider "${provider.name}"?`))) return;
    deleting.current = provider.id;
    if (!(await deleteProvider(provider))) {
      deleting.current = undefined;
      return;
    }
    clear();
    closeEditor('providers');
  };
  return {
    provider,
    draft,
    dirty,
    readOnly,
    errors,
    secretNames,
    change,
    save,
    duplicate,
    remove,
    back: () => closeEditor('providers'),
  };
}

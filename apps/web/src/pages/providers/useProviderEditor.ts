import { useEffect, useRef, useState } from 'react';
import type { ProviderView } from '@st/shared';
import { secretsApi } from '../../api.js';
import { useLayoutActions } from '../../layout/LayoutActions.js';
import { providerEditorStore, providersStore, useEditorCommands } from '../../stores/index.js';
import { startFileLiveSync } from '../fileLiveSync.js';
import { deleteProvider, duplicateProvider, saveProvider } from './providerActions.js';
import { classifyProviderChange, draftChanged, draftToBody, toDraft, type ProviderDraft } from './providerDraft.js';

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

  const latest = useRef({ provider, draft });
  latest.current = { provider, draft };
  // The provider this editor deleted (or is deleting). Provider writes are announced before their response
  // arrives, so the sync must not report the editor's own delete as "removed from disk". Ids are never reused,
  // so it is not reset after a successful delete.
  const deleting = useRef<string>(undefined);
  useEffect(
    () =>
      startFileLiveSync<ProviderView>(PROVIDERS, () => {
        const editor = latest.current;
        const baseline = editor.provider ? JSON.stringify(toDraft(editor.provider)) : '';
        return {
          signature: () => [editor.provider?.id ?? '', deleting.current ?? '', baseline].join('\n'),
          refresh: () => providersStore.refresh(),
          classify: (fresh) =>
            classifyProviderChange({ ...editor, deleting: deleting.current === editor.provider?.id }, fresh),
          openName: () => editor.provider?.name ?? '',
          onReload: open,
          onClose: () => {
            clear();
            closeEditor('providers');
          },
        };
      }),
    [],
  );

  const change = (next: ProviderDraft) => {
    if (readOnly) return;
    setDraft(next);
    setErrors([]);
  };
  const save = async () => {
    if (!provider || !draft || readOnly) return;
    const result = draftToBody(draft, provider.kind);
    if (!result.ok) return setErrors(result.errors);
    const saved = await saveProvider(provider.id, result.body);
    if (saved) open(saved);
  };
  const duplicate = async () => {
    if (!provider) return;
    const copy = await duplicateProvider(provider);
    if (copy) open(copy);
  };
  const remove = async () => {
    if (!provider || readOnly || !window.confirm(`Delete provider "${provider.name}"?`)) return;
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

import { useEffect, useState } from 'react';
import type { Snippet } from '@st/shared';
import { confirmDelete } from '../../components/dialog/dialogStore.js';
import { useLayoutActions } from '../../layout/LayoutActions.js';
import { snippetEditorStore, snippetsStore, useEditorCommands, useEditorSaver } from '../../stores/index.js';
import { useFileSync } from '../useFileSync.js';
import { deleteSnippet, saveSnippet } from './snippetActions.js';
import { classifySnippetChange, draftChanged, draftToBody, toDraft, type SnippetDraft } from './snippetDraft.js';

const SNIPPETS = {
  event: 'snippets.changed',
  noun: 'snippet',
  removedHint: 'Saving will fail; create a new snippet and copy your text into it.',
} as const;

/**
 * The open snippet and its draft. The editor stays mounted while hidden, so the draft survives the back arrow.
 * The list opens snippets through `snippetEditorStore`; edits made on disk reload a clean draft and never replace a
 * dirty one.
 */
export function useSnippetEditor() {
  const { closeEditor } = useLayoutActions();
  const [snippet, setSnippet] = useState<Snippet>();
  const [draft, setDraft] = useState<SnippetDraft>();
  const [errors, setErrors] = useState<string[]>([]);
  const dirty = !!snippet && !!draft && draftChanged(draft, snippet);

  const open = (item: Snippet) => {
    setSnippet(item);
    setDraft(toDraft(item));
    setErrors([]);
  };
  const clear = () => {
    setSnippet(undefined);
    setDraft(undefined);
    setErrors([]);
  };

  const openId = snippet?.id;
  useEffect(() => snippetEditorStore.report(openId, dirty), [openId, dirty]);
  useEditorCommands(snippetEditorStore, {
    open,
    close: (id) => {
      if (snippet?.id === id) clear();
    },
  });

  const deleting = useFileSync<Snippet, SnippetDraft>({
    resource: SNIPPETS,
    item: snippet,
    draft,
    baseline: (item) => JSON.stringify(toDraft(item)),
    refresh: () => snippetsStore.refresh(),
    classify: ({ item, draft: current, deleting: own }, fresh) =>
      classifySnippetChange({ snippet: item, draft: current, deleting: own }, fresh),
    onReload: open,
    onClose: () => {
      clear();
      closeEditor('snippets');
    },
  });

  const change = (next: SnippetDraft) => {
    setDraft(next);
    setErrors([]);
  };
  /** Resolves true when saved; false on validation errors or an API error (toasted, e.g. a name already taken). */
  const save = async (): Promise<boolean> => {
    if (!snippet || !draft) return false;
    const result = draftToBody(draft);
    if (!result.ok) {
      setErrors(result.errors);
      return false;
    }
    const saved = await saveSnippet(snippet.id, result.body);
    if (saved) open(saved);
    return !!saved;
  };
  const revert = () => {
    if (snippet) open(snippet);
  };
  useEditorSaver(snippetEditorStore, { label: () => draft?.name ?? snippet?.name ?? '', save });
  const remove = async () => {
    if (!snippet || !(await confirmDelete(`Delete snippet "${snippet.name}"?`))) return;
    deleting.current = snippet.id;
    if (!(await deleteSnippet(snippet))) {
      deleting.current = undefined;
      return;
    }
    clear();
    closeEditor('snippets');
  };
  return { draft, dirty, errors, change, save, revert, remove, back: () => closeEditor('snippets') };
}

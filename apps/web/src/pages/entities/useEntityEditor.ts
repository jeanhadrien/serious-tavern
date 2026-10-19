import { useEffect, useState } from 'react';
import type { Character, Persona } from '@st/shared';
import { alerts } from '../../alerts/index.js';
import { useLayoutActions } from '../../layout/LayoutActions.js';
import { useEditorCommands, useEditorSaver } from '../../stores/index.js';
import { importEntityFiles } from './entityActions.js';
import type { EntityKind } from './entityKinds.js';
import { confirmDelete } from '../../components/dialog/dialogStore.js';

/**
 * The draft of the open character or persona. The editor stays mounted while hidden, so the draft survives the
 * back arrow and wide editors taking the column. The list opens items through the kind's editor store.
 */
export function useEntityEditor<T extends Character | Persona>(kind: EntityKind<T>) {
  const { closeEditor } = useLayoutActions();
  const [draft, setDraft] = useState<T>();
  const [saved, setSaved] = useState('');
  const dirty = !!draft && JSON.stringify(draft) !== saved;
  const choose = (item: T) => {
    setDraft(structuredClone(item));
    setSaved(JSON.stringify(item));
  };
  const clear = () => {
    setDraft(undefined);
    setSaved('');
  };

  const openId = draft?.id;
  useEffect(() => kind.editorStore.report(openId, dirty), [kind, openId, dirty]);
  useEditorCommands(kind.editorStore, {
    open: choose,
    close: (id) => {
      if (draft?.id === id) clear();
    },
  });

  /** Resolves true when saved; false on a validation failure or an API error (toasted). */
  const save = async (): Promise<boolean> => {
    if (!draft || !kind.validate(draft)) return false;
    try {
      choose(await kind.save(draft));
      await kind.listStore.refresh();
      alerts.success(`${kind.label} saved`);
      return true;
    } catch {
      /* API errors are toasted. */
      return false;
    }
  };
  useEditorSaver(kind.editorStore, { label: () => draft?.name ?? '', save });
  const remove = async () => {
    if (!draft || !(await confirmDelete(`Delete ${kind.label.toLowerCase()} "${draft.name}"?`))) return;
    try {
      await kind.delete(draft.id);
      clear();
      closeEditor(kind.type);
      await kind.listStore.refresh();
      alerts.info(`${kind.label} deleted`);
    } catch {
      /* API errors are toasted. */
    }
  };
  // Files dropped on the editor are imported; the imported item replaces the draft only when nothing would be lost.
  const importFiles = async (files: File[]) => {
    const item = await importEntityFiles(kind, files);
    if (item && !dirty) choose(item);
  };
  const uploadAvatar = async (file?: File) => {
    if (!draft || !file) return;
    const form = new FormData();
    form.append('file', file, file.name);
    try {
      choose(await kind.uploadAvatar(draft.id, form));
      await kind.listStore.refresh();
      alerts.success('Avatar updated');
    } catch {
      /* API errors are toasted. */
    }
  };
  const change = (field: keyof T, value: unknown) => draft && setDraft({ ...draft, [field]: value });
  return { draft, dirty, change, save, remove, importFiles, uploadAvatar, back: () => closeEditor(kind.type) };
}

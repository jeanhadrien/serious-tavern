import { useState } from 'react';
import type { Character, Persona, EntityImportResult } from '@st/shared';
import { alerts } from '../../alerts/index.js';
import { useList } from '../../stores/index.js';
import type { ListStore } from '../../stores/listStore.js';

interface EntityEditorOptions<T extends Character | Persona> {
  label: string;
  /** The shared list of this resource. */
  store: ListStore<T>;
  create: () => Promise<T>;
  save: (draft: T) => Promise<T>;
  delete: (id: string) => Promise<unknown>;
  import: (body: FormData) => Promise<EntityImportResult<T>>;
  uploadAvatar: (id: string, body: FormData) => Promise<T>;
  validate: (draft: T) => boolean;
  prepareFiles: (files: File[]) => File[];
  imported: (count: number) => void;
  failed: (failures: EntityImportResult<T>['failed']) => void;
}

export function useEntityEditor<T extends Character | Persona>(options: EntityEditorOptions<T>) {
  const list = useList(options.store);
  const [draft, setDraft] = useState<T>();
  const [saved, setSaved] = useState('');
  const refresh = () => options.store.refresh();
  const choose = (item: T) => {
    setDraft(structuredClone(item));
    setSaved(JSON.stringify(item));
  };
  const create = async () => {
    try {
      const item = await options.create();
      await refresh();
      choose(item);
      alerts.success(`${options.label} created`);
    } catch {
      /* API errors are toasted. */
    }
  };
  const save = async () => {
    if (!draft || !options.validate(draft)) return;
    try {
      const item = await options.save(draft);
      choose(item);
      await refresh();
      alerts.success(`${options.label} saved`);
    } catch {
      /* API errors are toasted. */
    }
  };
  const remove = async () => {
    if (!draft || !window.confirm(`Delete ${draft.name}?`)) return;
    try {
      await options.delete(draft.id);
      setDraft(undefined);
      setSaved('');
      await refresh();
      alerts.info(`${options.label} deleted`);
    } catch {
      /* API errors are toasted. */
    }
  };
  const importFiles = async (files: File[]) => {
    const prepared = options.prepareFiles(files);
    if (!prepared.length) return;
    const form = new FormData();
    prepared.forEach((file) => {
      form.append('files', file, file.name);
    });
    try {
      const result = await options.import(form);
      if (result.imported.length) {
        await refresh();
        choose(result.imported.at(-1)!);
        options.imported(result.imported.length);
      }
      if (result.failed.length) options.failed(result.failed);
    } catch {
      /* API errors are toasted. */
    }
  };
  const uploadAvatar = async (file?: File) => {
    if (!draft || !file) return;
    const form = new FormData();
    form.append('file', file, file.name);
    try {
      const item = await options.uploadAvatar(draft.id, form);
      choose(item);
      await refresh();
      alerts.success('Avatar updated');
    } catch {
      /* API errors are toasted. */
    }
  };
  const change = (field: keyof T, value: unknown) => draft && setDraft({ ...draft, [field]: value });
  const dirty = !!draft && JSON.stringify(draft) !== saved;
  return { list, draft, dirty, choose, change, create, save, remove, importFiles, uploadAvatar };
}

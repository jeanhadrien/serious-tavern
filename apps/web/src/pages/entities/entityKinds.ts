import { characterSchema, personaSchema, type Character, type EntityImportResult, type Persona } from '@st/shared';
import { charactersApi, personasApi } from '../../api.js';
import { alerts } from '../../alerts/index.js';
import { characterEditorStore, charactersStore, personaEditorStore, personasStore } from '../../stores/index.js';
import type { EditorStore } from '../../stores/editorStore.js';
import type { ListStore } from '../../stores/listStore.js';

/** Everything that differs between characters and personas; the list, editor shell and actions are shared. */
export interface EntityKind<T extends Character | Persona> {
  type: 'characters' | 'personas';
  /** Singular name, for messages. */
  label: string;
  title: string;
  importLabel: string;
  /** File types the import picker accepts. */
  accept: string;
  dropLabel: string;
  listStore: ListStore<T>;
  editorStore: EditorStore<T>;
  create: () => Promise<T>;
  save: (draft: T) => Promise<T>;
  delete: (id: string) => Promise<unknown>;
  import: (body: FormData) => Promise<EntityImportResult<T>>;
  uploadAvatar: (id: string, body: FormData) => Promise<T>;
  /** Alerts and returns false when the draft cannot be saved. */
  validate: (draft: T) => boolean;
  /** Keeps the files this kind can import; alerts when none qualify. */
  prepareFiles: (files: File[]) => File[];
  imported: (count: number) => void;
  failed: (failures: EntityImportResult<T>['failed']) => void;
}

export const characterKind: EntityKind<Character> = {
  type: 'characters',
  label: 'Character',
  title: 'Characters',
  importLabel: 'Import cards',
  accept: '.json,.png,application/json,image/png',
  dropLabel: 'Drop character card PNG or JSON files to import',
  listStore: charactersStore,
  editorStore: characterEditorStore,
  create: () => charactersApi.create({ name: 'New character' }),
  save: (draft) => charactersApi.update(draft.id, draft),
  delete: charactersApi.delete,
  import: charactersApi.import,
  uploadAvatar: charactersApi.uploadAvatar,
  validate: (draft) => {
    const parsed = characterSchema.safeParse(draft);
    if (!parsed.success)
      alerts.error('Fix the character validation errors before saving', {
        details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'),
      });
    return parsed.success;
  },
  prepareFiles: (files) => files,
  imported: (count) => alerts.success(`Imported ${count} character${count === 1 ? '' : 's'}`),
  failed: (failures) =>
    alerts.error(`${failures.length} character file${failures.length === 1 ? '' : 's'} could not be imported`, {
      details: failures.map((item) => `${item.filename}: ${item.error.message}`).join('\n'),
    }),
};

export const personaKind: EntityKind<Persona> = {
  type: 'personas',
  label: 'Persona',
  title: 'Personas',
  importLabel: 'Create from image',
  accept: 'image/png,image/jpeg,image/gif,image/webp',
  dropLabel: 'Drop an image to create a persona',
  listStore: personasStore,
  editorStore: personaEditorStore,
  create: () => personasApi.create({ name: 'New persona' }),
  save: (draft) => personasApi.update(draft.id, draft),
  delete: personasApi.delete,
  import: personasApi.import,
  uploadAvatar: personasApi.uploadAvatar,
  validate: (draft) => {
    const parsed = personaSchema.safeParse(draft);
    if (!parsed.success) alerts.error('Enter a valid persona name');
    return parsed.success;
  },
  prepareFiles: (files) => {
    const images = files.filter((file) => file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(file.name));
    if (!images.length) alerts.error('Choose image files to create personas');
    return images;
  },
  imported: (count) => alerts.success(`Created ${count} persona${count === 1 ? '' : 's'} from images`),
  failed: (failures) =>
    alerts.error('Some persona images could not be imported', {
      details: failures.map((item) => `${item.filename}: ${item.error.message}`).join('\n'),
    }),
};

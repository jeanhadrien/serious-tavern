import {
  charactersStore,
  characterEditorStore,
  collectionEditorStore,
  collectionsStore,
  personaEditorStore,
  personasStore,
  presetEditorStore,
  presetsStore,
  providerEditorStore,
  providersStore,
  stateDefinitionEditorStore,
  stateDefinitionsStore,
  workflowEditorStore,
  workflowsStore,
} from '../stores/index.js';
import type { EditorStore } from '../stores/editorStore.js';
import type { ListStore } from '../stores/listStore.js';
import type { ResourceId } from './state.js';

export interface Item {
  id: string;
}
/** A resource that opens items by id: its list, and the editor store that opens them. */
export const ITEM_SOURCES: Partial<Record<ResourceId, { list: ListStore<Item>; editor: EditorStore<Item, unknown> }>> =
  {
    workflows: { list: workflowsStore, editor: workflowEditorStore },
    presets: { list: presetsStore, editor: presetEditorStore },
    providers: { list: providersStore, editor: providerEditorStore },
    stateDefinitions: { list: stateDefinitionsStore, editor: stateDefinitionEditorStore },
    characters: { list: charactersStore, editor: characterEditorStore },
    personas: { list: personasStore, editor: personaEditorStore },
    collections: { list: collectionsStore, editor: collectionEditorStore },
  };

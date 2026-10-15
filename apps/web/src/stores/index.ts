import { useSyncExternalStore } from 'react';
import {
  charactersApi,
  collectionsApi,
  personasApi,
  presetsApi,
  providersApi,
  sessionsApi,
  workflowsApi,
} from '../api.js';
import { compareRecent } from '../pages/recentOrder.js';
import type { Character, Collection, CollectionSummary, Persona, Preset, ProviderView, Workflow } from '@st/shared';
import { createEditorStore } from './editorStore.js';
import { createListStore, type ListStore } from './listStore.js';

export { useEditorCommands, useEditorState } from './editorStore.js';

// Stores refresh in the background: a failed fetch must not toast on every event.
const silent = { silent: true };
const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

export const workflowsStore = createListStore({
  event: 'workflows.changed',
  load: () => workflowsApi.list(silent),
  compare: (a, b) => compareRecent(a, b, (item) => item.name),
});
export const presetsStore = createListStore({
  event: 'presets.changed',
  load: () => presetsApi.list(silent),
  compare: (a, b) => compareRecent(a, b, (item) => item.name),
});
export const sessionsStore = createListStore({
  event: 'sessions.changed',
  load: () => sessionsApi.list(silent),
  compare: (a, b) => compareRecent(a, b, (item) => item.title),
});
export const charactersStore = createListStore({
  event: 'characters.changed',
  load: () => charactersApi.list(silent),
  compare: byName,
});
export const personasStore = createListStore({
  event: 'personas.changed',
  load: () => personasApi.list(silent),
  compare: byName,
});

// Built-in providers first (as the server lists them), then the user's by name.
export const providersStore = createListStore({
  event: 'providers.changed',
  load: () => providersApi.list(silent),
  compare: (a, b) => Number(b.builtIn) - Number(a.builtIn) || byName(a, b),
});

// Collection summaries (entry counts, not entries); the editor reads the whole collection.
export const collectionsStore = createListStore({
  event: 'collections.changed',
  load: () => collectionsApi.list(silent),
  compare: byName,
});

/** Reads a shared list; the component re-renders when the list changes. */
export function useList<T>(store: ListStore<T>): T[] {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

// What each list shares with its editor: the open item, its dirty flag and the list's requests.
export const workflowEditorStore = createEditorStore<Workflow>();
export const presetEditorStore = createEditorStore<Preset>();
export const characterEditorStore = createEditorStore<Character>();
export const personaEditorStore = createEditorStore<Persona>();
export const providerEditorStore = createEditorStore<ProviderView>();
// The list opens summaries; the editor fetches the whole collection (a full one is used as is).
export const collectionEditorStore = createEditorStore<CollectionSummary | Collection>();

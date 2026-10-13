import { useSyncExternalStore } from 'react';
import { charactersApi, personasApi, presetsApi, sessionsApi, workflowsApi } from '../api.js';
import { compareRecent } from '../pages/recentOrder.js';
import { createListStore, type ListStore } from './listStore.js';

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

/** Reads a shared list; the component re-renders when the list changes. */
export function useList<T>(store: ListStore<T>): T[] {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

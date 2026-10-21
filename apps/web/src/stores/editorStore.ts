import { useEffect, useRef, useSyncExternalStore } from 'react';
import { dialogs } from '../components/dialog/dialogStore.js';

/** A request from a list to its editor. `seq` makes every request distinct so each is handled once. */
type EditorCommand<T, F> = { seq: number; open: T; focus?: F } | { seq: number; close: string };

export interface EditorState<T, F = string> {
  /** The item the editor has open. */
  currentId?: string;
  /** Whether the open draft has unsaved changes. */
  dirty: boolean;
  /** The latest request from the list; the editor applies it when it sees a new `seq`. */
  command?: EditorCommand<T, F>;
}

/** What the unsaved-work dialog offers. `label` names the open item; `save` resolves true once saved. */
export interface EditorSaver {
  label(): string;
  save(): Promise<boolean>;
}

type Ask = typeof dialogs.ask;

export interface EditorStore<T, F = string> {
  getSnapshot(): EditorState<T, F>;
  subscribe(listener: () => void): () => void;
  /**
   * List side: ask the editor to open an item. Does nothing when it is already the open one (keeps its draft),
   * unless a `focus` is given: a hint about where to look inside the item. Its type `F` is the editor's own (the
   * workflow editor takes the edge to highlight and the node to show); the others take no hint.
   * `currentId` names the requested item at once (clean), before the editor has applied the request.
   */
  open(item: T, focus?: F): void;
  /** List side: tell the editor an item was deleted, so it drops that draft. */
  discard(id: string): void;
  /** Editor side: publish which item is open and whether it is dirty. */
  report(currentId: string | undefined, dirty: boolean): void;
  /** Editor side: register what the unsaved-work dialog offers; `undefined` unregisters. */
  setSaver(saver: EditorSaver | undefined): void;
  /**
   * Saves the open item through the registered saver (the Ctrl/Cmd+S shortcut). Does nothing, and resolves false,
   * when no item is open, the draft is clean or no saver is registered.
   */
  save(): Promise<boolean>;
  /**
   * List side: resolves true when the editor may open `nextId` now. True at once when `nextId` is the open item or
   * the draft is clean; otherwise asks Save / Discard / Cancel. No argument means "something else replaces the open
   * item" (create, import). Callers ask before `open`, and before any server write or layout change.
   */
  confirmSwitch(nextId?: string): Promise<boolean>;
}

/**
 * The link between a resource's list (in L) and its editor (in M). The draft itself stays inside the editor
 * component, which is always mounted; the store only carries what the list needs to show (selection, dirty marker)
 * and the list's requests to the editor.
 */
export function createEditorStore<T extends { id: string }, F = string>(
  ask: Ask = dialogs.ask.bind(dialogs),
): EditorStore<T, F> {
  let state: EditorState<T, F> = { dirty: false };
  let saver: EditorSaver | undefined;
  const listeners = new Set<() => void>();
  const set = (next: EditorState<T, F>) => {
    state = next;
    for (const listener of [...listeners]) listener();
  };
  const send = (command: Omit<EditorCommand<T, F>, 'seq'>, next: Partial<EditorState<T, F>> = {}) =>
    set({ ...state, ...next, command: { ...command, seq: (state.command?.seq ?? 0) + 1 } as EditorCommand<T, F> });
  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    open: (item, focus) => {
      if (state.currentId === item.id) {
        if (focus !== undefined) send({ open: item, focus });
        return;
      }
      // The editor applies the request in an effect, after the render that shows it. Naming the new item now
      // keeps that render from writing the previous item into the layout URL (a stray history entry); the
      // editor's next report confirms it.
      send({ open: item, focus }, { currentId: item.id, dirty: false });
    },
    discard: (id) => send({ close: id }),
    report: (currentId, dirty) => {
      if (state.currentId !== currentId || state.dirty !== dirty) set({ ...state, currentId, dirty });
    },
    setSaver: (next) => {
      saver = next;
    },
    save: async () => (saver && state.currentId !== undefined && state.dirty ? saver.save() : false),
    confirmSwitch: async (nextId) => {
      if (!state.dirty || (nextId !== undefined && nextId === state.currentId)) return true;
      const current = saver;
      const answer = await ask({
        title: `Save changes to "${current?.label() ?? 'the open item'}"?`,
        body: 'You have unsaved changes. Opening something else replaces them.',
        actions: [
          ...(current ? [{ id: 'save', label: 'Save', kind: 'primary' as const }] : []),
          { id: 'discard', label: 'Discard changes', kind: 'danger' as const },
        ],
        // Cancel leaves everything as it is: where the list replaced the editor, the list stays on screen.
        cancelLabel: 'Cancel',
      });
      if (answer === 'save') return (await current?.save()) === true;
      return answer === 'discard';
    },
  };
}

/** Reads an editor store; the component re-renders when it changes. */
export function useEditorState<T, F = string>(store: EditorStore<T, F>): EditorState<T, F> {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/**
 * Editor side: applies each request from the list once. While `ready` is false an open request waits
 * (e.g. until the node types are loaded). Handlers may change every render.
 */
export function useEditorCommands<T, F = string>(
  store: EditorStore<T, F>,
  handlers: { open(item: T, focus?: F): void; close(id: string): void },
  ready = true,
) {
  const command = useSyncExternalStore(store.subscribe, () => store.getSnapshot().command);
  const latest = useRef(handlers);
  latest.current = handlers;
  const handled = useRef(0);
  useEffect(() => {
    if (!command || command.seq === handled.current) return;
    if ('open' in command) {
      if (!ready) return;
      handled.current = command.seq;
      latest.current.open(command.open, command.focus);
    } else {
      handled.current = command.seq;
      latest.current.close(command.close);
    }
  }, [command, ready]);
}

/** Editor side: registers the latest saver for the unsaved-work dialog; a new function each render doesn't re-register. */
export function useEditorSaver<T, F = string>(store: EditorStore<T, F>, saver: EditorSaver) {
  const latest = useRef(saver);
  latest.current = saver;
  useEffect(() => {
    store.setSaver({ label: () => latest.current.label(), save: () => latest.current.save() });
    return () => store.setSaver(undefined);
  }, [store]);
}

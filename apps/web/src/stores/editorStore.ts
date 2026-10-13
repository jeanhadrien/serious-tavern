import { useEffect, useRef, useSyncExternalStore } from 'react';

/** A request from a list to its editor. `seq` makes every request distinct so each is handled once. */
type EditorCommand<T> = { seq: number; open: T; focus?: string } | { seq: number; close: string };

export interface EditorState<T> {
  /** The item the editor has open. */
  currentId?: string;
  /** Whether the open draft has unsaved changes. */
  dirty: boolean;
  /** The latest request from the list; the editor applies it when it sees a new `seq`. */
  command?: EditorCommand<T>;
}

export interface EditorStore<T> {
  getSnapshot(): EditorState<T>;
  subscribe(listener: () => void): () => void;
  /**
   * List side: ask the editor to open an item. Does nothing when it is already the open one (keeps its draft),
   * unless a `focus` is given: a hint about where to look inside the item (e.g. an edge id to highlight).
   */
  open(item: T, focus?: string): void;
  /** List side: tell the editor an item was deleted, so it drops that draft. */
  discard(id: string): void;
  /** Editor side: publish which item is open and whether it is dirty. */
  report(currentId: string | undefined, dirty: boolean): void;
}

/**
 * The link between a resource's list (in L) and its editor (in M). The draft itself stays inside the editor
 * component, which is always mounted; the store only carries what the list needs to show (selection, dirty marker)
 * and the list's requests to the editor.
 */
export function createEditorStore<T extends { id: string }>(): EditorStore<T> {
  let state: EditorState<T> = { dirty: false };
  const listeners = new Set<() => void>();
  const set = (next: EditorState<T>) => {
    state = next;
    for (const listener of [...listeners]) listener();
  };
  const send = (command: Omit<EditorCommand<T>, 'seq'>) =>
    set({ ...state, command: { ...command, seq: (state.command?.seq ?? 0) + 1 } as EditorCommand<T> });
  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    open: (item, focus) => {
      if (state.currentId !== item.id || focus !== undefined) send({ open: item, focus });
    },
    discard: (id) => send({ close: id }),
    report: (currentId, dirty) => {
      if (state.currentId !== currentId || state.dirty !== dirty) set({ ...state, currentId, dirty });
    },
  };
}

/** Reads an editor store; the component re-renders when it changes. */
export function useEditorState<T>(store: EditorStore<T>): EditorState<T> {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/**
 * Editor side: applies each request from the list once. While `ready` is false an open request waits
 * (e.g. until the node types are loaded). Handlers may change every render.
 */
export function useEditorCommands<T>(
  store: EditorStore<T>,
  handlers: { open(item: T, focus?: string): void; close(id: string): void },
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

/** How a draft is compared with the saved item: a string per value, equal strings mean "no changes". */
export type DraftKey<T> = (item: T) => string;

export const jsonKey = <T>(item: T): string => JSON.stringify(item);

/** The draft and the saved snapshot it started from. */
export interface DraftState<T> {
  draft?: T;
  saved?: T;
}

export type DraftAction<T> =
  | { type: 'set'; draft: T }
  | { type: 'load'; item: T }
  | { type: 'revert' }
  | { type: 'clear' };

/** The draft is a copy, so editing it never touches the saved snapshot. */
export function draftReducer<T>(state: DraftState<T>, action: DraftAction<T>): DraftState<T> {
  switch (action.type) {
    case 'set':
      return state.saved === undefined ? state : { ...state, draft: action.draft };
    case 'load':
      return { draft: structuredClone(action.item), saved: action.item };
    case 'revert':
      return state.saved === undefined ? state : { ...state, draft: structuredClone(state.saved) };
    case 'clear':
      return {};
  }
}

/** Dirty means a draft is open and differs from the saved snapshot (`savedKey` is the snapshot's key). */
export function isDirty<T>(draft: T | undefined, savedKey: string | undefined, key: DraftKey<T>): boolean {
  return draft !== undefined && savedKey !== undefined && key(draft) !== savedKey;
}

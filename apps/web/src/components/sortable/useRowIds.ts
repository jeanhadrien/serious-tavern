import { useCallback, useRef } from 'react';
import { moveItem } from './moveItem.js';
import { fitIds } from './rowIds.js';

/**
 * Stable ids for the rows of a list that has none of its own, kept next to the list and never part of the
 * draft (so they are never sent and never count for dirty). They follow the rows through `move` and `remove`,
 * which the editor calls together with its own change; rows added at the end get a fresh id, and a list that
 * changes in any other way (a load, a revert) keeps the ids by position, which is harmless: an id only names a row.
 */
export function useRowIds(length: number) {
  const ids = useRef<string[]>([]);
  ids.current = fitIds(ids.current, length);
  const move = useCallback((from: number, to: number) => {
    ids.current = moveItem(ids.current, from, to);
  }, []);
  const remove = useCallback((index: number) => {
    ids.current = ids.current.filter((_, at) => at !== index);
  }, []);
  return { ids: ids.current as readonly string[], move, remove };
}

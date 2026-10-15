// Which entry stays expanded in the collection editor as entries change. Entries have no stable id, so the
// selection is a position and follows the entry it pointed at.

/** After deleting entry `removed`: the deleted entry closes, later ones shift up. */
export function selectionAfterRemove(selected: number | undefined, removed: number): number | undefined {
  if (selected === undefined || selected === removed) return undefined;
  return selected > removed ? selected - 1 : selected;
}

/** After swapping entries `from` and `to` (a move by one): the selection follows its entry. */
export function selectionAfterMove(selected: number | undefined, from: number, to: number): number | undefined {
  if (selected === from) return to;
  return selected === to ? from : selected;
}

/** After loading a collection of `length` entries: kept by position (clamped) when asked, else closed. */
export function selectionAfterLoad(selected: number | undefined, length: number, keep: boolean): number | undefined {
  return keep && selected !== undefined && length ? Math.min(selected, length - 1) : undefined;
}

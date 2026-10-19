/** A copy of the list with the item at `from` moved to index `to`; out-of-range or equal indexes change nothing. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const inRange = (index: number) => Number.isInteger(index) && index >= 0 && index < list.length;
  if (from === to || !inRange(from) || !inRange(to)) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
}

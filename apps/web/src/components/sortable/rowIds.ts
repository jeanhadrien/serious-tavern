let counter = 0;
/** A row id that is unique for the page's life. It is never stored or sent: it only names a row while it is edited. */
export const newRowId = () => `row-${++counter}`;

/** `ids` fitted to `length` rows: extra ids are dropped from the end, missing ones are made. */
export function fitIds(ids: readonly string[], length: number, make: () => string = newRowId): string[] {
  const fitted = ids.slice(0, length);
  while (fitted.length < length) fitted.push(make());
  return fitted;
}

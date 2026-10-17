/** Plain code-unit order, so a result never depends on the locale. */
export const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The implicit key Draw remembers its draws under (a node key: see "Implicit node state" in the README). */
export const DRAW_STATE_KEY = 'draws';

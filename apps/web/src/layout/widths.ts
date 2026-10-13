// Column width rules for the shell. Widths are pixels for the side columns; M takes the rest.

export interface ColumnWidths {
  left: number;
  right: number;
}

export type Side = keyof ColumnWidths;

export const DEFAULT_WIDTHS: ColumnWidths = { left: 260, right: 340 };
export const MIN_SIDE = 180;
export const MIN_MIDDLE = 360;
/** Width of one drag handle between columns. */
export const HANDLE_WIDTH = 6;
export const KEY_STEP = 16;

const STORAGE_KEY = 'st.layout.widths';

// Space the side columns may use together: everything except M's minimum and the handles.
function sideBudget(total: number, columns: 2 | 3): number {
  return total - MIN_MIDDLE - HANDLE_WIDTH * (columns - 1);
}

/** Shrinks stored widths so every column fits in `total` pixels (unknown while `total` is 0). */
export function fitWidths(widths: ColumnWidths, total: number, columns: 2 | 3): ColumnWidths {
  if (total <= 0) return widths;
  const budget = sideBudget(total, columns);
  const left = Math.max(MIN_SIDE, Math.min(widths.left, budget - (columns === 3 ? MIN_SIDE : 0)));
  const right = Math.max(MIN_SIDE, Math.min(widths.right, budget - left));
  return { left, right };
}

/** Sets one side column to `value`, clamped so it leaves the other side and M their minimums. */
export function resizeSide(
  widths: ColumnWidths,
  side: Side,
  value: number,
  total: number,
  columns: 2 | 3,
): ColumnWidths {
  const other = side === 'left' ? (columns === 3 ? widths.right : 0) : widths.left;
  const max = Math.max(MIN_SIDE, sideBudget(total, columns) - other);
  return { ...widths, [side]: Math.round(Math.min(Math.max(value, MIN_SIDE), max)) };
}

export function loadWidths(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): ColumnWidths {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null');
    if (parsed && typeof parsed === 'object') {
      const { left, right } = parsed as Partial<Record<Side, unknown>>;
      if (typeof left === 'number' && typeof right === 'number' && left > 0 && right > 0) return { left, right };
    }
  } catch {
    /* Unreadable storage or JSON: fall back to the defaults. */
  }
  return DEFAULT_WIDTHS;
}

export function saveWidths(widths: ColumnWidths, storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(widths));
  } catch {
    /* Storage can be full or blocked; the widths just aren't remembered. */
  }
}

// Reading `localStorage` itself can throw (blocked site data).
function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

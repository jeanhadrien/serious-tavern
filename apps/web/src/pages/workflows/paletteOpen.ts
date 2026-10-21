import { safeStorage } from '../../safeStorage.js';

// Which palette categories are folded, remembered per browser: one JSON map from category to open. A category that
// isn't in the map is open.

const STORAGE_KEY = 'st.palette.open';

export type PaletteOpen = Record<string, boolean>;

export const isCategoryOpen = (open: PaletteOpen, category: string): boolean => open[category] !== false;

export function loadPaletteOpen(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): PaletteOpen {
  const open: PaletteOpen = {};
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      for (const [category, value] of Object.entries(parsed)) if (typeof value === 'boolean') open[category] = value;
  } catch {
    /* Unreadable storage or JSON: every category opens. */
  }
  return open;
}

export function savePaletteOpen(
  open: PaletteOpen,
  storage: Pick<Storage, 'setItem'> | undefined = safeStorage(),
): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(open));
  } catch {
    /* Storage can be full or blocked; the state just isn't remembered. */
  }
}

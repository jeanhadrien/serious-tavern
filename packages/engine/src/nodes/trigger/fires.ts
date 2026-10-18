import type { StateKeyView } from '@st/shared';

/** The implicit key the Trigger remembers its firings under (a node key, like Draw's `draws`). */
export const TRIGGER_STATE_KEY = 'fires';

export type Firing = { turn: number; level: number };

/**
 * The firings recorded under the node's own key, newest first: the level each item holds and the turn that added
 * it (`itemTurns`). Items that lack either are ignored, so a hand-edited or older value never breaks a run.
 */
export function readFirings(view: StateKeyView | undefined): Firing[] {
  if (!view || !Array.isArray(view.value)) return [];
  const firings: Firing[] = [];
  view.value.forEach((item, index) => {
    const turn = view.itemTurns?.[index];
    const level = (item as { level?: unknown } | null)?.level;
    if (typeof turn === 'number' && typeof level === 'number') firings.push({ turn, level });
  });
  return firings;
}

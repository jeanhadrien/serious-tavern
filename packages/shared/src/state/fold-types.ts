import { z } from 'zod';
import type { TurnPresence } from './turns.js';

/** Facts about a key beyond its value: how long ago it was written and, for collections, how many items. */
export const keyMetaSchema = z.object({
  /** Whether any present turn wrote the key. */
  written: z.boolean(),
  /** Turns since the last present write. Never written counts as written before turn 1, so it equals `turn`. */
  turnsSinceWrite: z.number(),
  writtenAtTurn: z.number().nullable(),
  /** Collections only: items kept (after the cap). */
  count: z.number().optional(),
  /** Collections only: items the cap cut off. */
  droppedByCap: z.number().optional(),
});
export type KeyMeta = z.infer<typeof keyMetaSchema>;

/** The value of a key after one turn that wrote it; a collection's value is its kept item count. */
export const historyPointSchema = z.object({ turn: z.number(), value: z.unknown() });
export type HistoryPoint = z.infer<typeof historyPointSchema>;

/** A stored value that does not fit the current definition (the key reads as its default instead). */
export const stateWarningSchema = z.object({ definition: z.string(), key: z.string(), message: z.string() });
export type StateWarning = z.infer<typeof stateWarningSchema>;

export type FoldedKey = {
  value: unknown;
  meta: KeyMeta;
  /** The newest `HISTORY_LIMIT` points, oldest first. */
  history: HistoryPoint[];
  /** Collections: the turn number that added each kept item, in the same order as the items. */
  itemTurns?: number[];
};

export type FoldedDefinition = {
  definitionId: string;
  name: string;
  /** One entry per key of the CURRENT definition. */
  keys: Record<string, FoldedKey>;
  warnings: StateWarning[];
};

/** Everything one node wrote under its own implicit keys (Draw's `draws`); only keys that were written. */
export type FoldedNode = { nodeId: string; keys: Record<string, FoldedKey> };

export type StoryState = {
  /** The turn being run: present turns + 1. */
  turn: number;
  /** Every stored entry, present or not, in stored order. */
  turns: TurnPresence[];
  definitions: FoldedDefinition[];
  nodes: FoldedNode[];
};

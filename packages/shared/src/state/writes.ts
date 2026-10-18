import { z } from 'zod';

/**
 * What a settled turn stores in its session (`session.state.turns`). Stored records are not parsed on read,
 * so everything that reads `session.state` goes through `readTurnEntries`, never `state.turns` directly.
 * This file must not import `models.ts` (the session schema imports it).
 */

/** A collection item: an `id`, the `text`, and the key's declared fields as extra properties. */
export const collectionItemSchema = z.object({ id: z.string().min(1), text: z.string() }).passthrough();
export type CollectionItem = z.infer<typeof collectionItemSchema>;

/** A definition's key, or the writing node's own implicit key (Draw's `draws`): see the fold. */
export const stateTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('definition'), definitionId: z.string(), key: z.string() }).passthrough(),
  z.object({ kind: z.literal('node'), nodeId: z.string(), key: z.string() }).passthrough(),
]);
export type StateTarget = z.infer<typeof stateTargetSchema>;

// `nodeId` is the node that wrote it. Scalars always store the value AFTER the write (an increment is
// computed into a `set`); collections store item-level `add` and `remove`; `delete` resets a key.
const writer = { target: stateTargetSchema, nodeId: z.string() };
export const stateWriteSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set'), ...writer, value: z.unknown() }).passthrough(),
  z.object({ op: z.literal('add'), ...writer, item: collectionItemSchema }).passthrough(),
  z.object({ op: z.literal('remove'), ...writer, itemId: z.string() }).passthrough(),
  z.object({ op: z.literal('delete'), ...writer }).passthrough(),
]);
export type StateWrite = z.infer<typeof stateWriteSchema>;

/** How a turn's post-turn run (After Reply) stands. `running` is only believed while the server holds the run: see `effectivePostRun`. */
export const postStatusSchema = z.enum(['running', 'completed', 'error', 'stopped']);
export type PostStatus = z.infer<typeof postStatusSchema>;

/**
 * One settled turn. An entry exists for EVERY settled turn, with or without writes, so turn counting is
 * stable. Passthrough on purpose: later phases add fields.
 */
export const turnEntrySchema = z
  .object({
    executionId: z.string().min(1),
    at: z.string(),
    /** The run finished without an error or a stop. */
    completed: z.boolean(),
    /** Assistant messages saved for the turn when it settled (partial rows included). */
    replies: z.number().int().nonnegative(),
    writes: z.array(stateWriteSchema).default([]),
    // The post-turn run this turn left behind. Tolerant on purpose (`.catch`): a hand-edited bad value drops
    // the field, never the turn.
    /** Execution id of the post-turn run (After Reply); absent when the workflow has none. */
    postExecutionId: z.string().min(1).optional().catch(undefined),
    postStatus: postStatusSchema.optional().catch(undefined),
    postError: z.string().optional().catch(undefined),
    // Summaries this turn's runs asked to store but were dropped at commit time (see `commitSummaryWrites`), in plain
    // words and cut (`SUMMARY_WARNING_LIMITS`): the chat shows them on the turn's chip.
    summaryWarnings: z.array(z.string()).optional().catch(undefined),
  })
  .passthrough();
export type TurnEntry = z.infer<typeof turnEntrySchema>;

export const sessionStateSchema = z.object({ turns: z.array(turnEntrySchema) }).passthrough();
export type SessionState = z.infer<typeof sessionStateSchema>;

// The shell of an entry, without its writes: a write that cannot be read must not take its turn with it.
const turnShellSchema = turnEntrySchema.extend({ writes: z.array(z.unknown()).default([]) });

const rawTurns = (state: unknown): unknown[] =>
  typeof state === 'object' && state !== null && Array.isArray((state as { turns?: unknown }).turns)
    ? (state as { turns: unknown[] }).turns
    : [];

/**
 * The readable turn entries of a stored `session.state`, in stored order. Anything malformed is skipped
 * (a whole entry that is not an entry, or a single write that is not a write); nothing is repaired or rewritten.
 */
export function readTurnEntries(state: unknown): TurnEntry[] {
  return rawTurns(state).flatMap((raw) => {
    const shell = turnShellSchema.safeParse(raw);
    if (!shell.success) return [];
    const writes = shell.data.writes.flatMap((write) => {
      const parsed = stateWriteSchema.safeParse(write);
      return parsed.success ? [parsed.data] : [];
    });
    return [{ ...shell.data, writes }];
  });
}

/**
 * `state` with `entry` appended. Unknown keys of `state` and the raw items already stored are kept as
 * they are (a hand-edited entry this version cannot read is never dropped from the file); a missing or
 * malformed `state` starts a fresh list. The result is typed as a `SessionState`, which stored data may
 * not strictly be.
 */
export function withTurnEntry(state: unknown, entry: TurnEntry): SessionState {
  const rest = typeof state === 'object' && state !== null && !Array.isArray(state) ? state : {};
  return { ...rest, turns: [...rawTurns(state), entry] } as SessionState;
}

/**
 * `state` with the first stored item whose `executionId` is the given one replaced by `update(item)`. The rest is kept
 * as stored, like `withTurnEntry` (other items are the same objects, unknown keys of the state survive, and nothing
 * is repaired). No such item, or a state that is not a list of turns, gives the state back unchanged. `update` gets the
 * RAW item, which may hold things this version cannot read, and must keep what it does not change.
 */
export function withUpdatedTurnEntry(
  state: unknown,
  executionId: string,
  update: (raw: Record<string, unknown>) => Record<string, unknown>,
): SessionState {
  const turns = rawTurns(state);
  const index = turns.findIndex(
    (raw) =>
      typeof raw === 'object' &&
      raw !== null &&
      !Array.isArray(raw) &&
      (raw as { executionId?: unknown }).executionId === executionId,
  );
  if (index < 0) return state as SessionState;
  return {
    ...(state as object),
    turns: turns.map((raw, at) => (at === index ? update(raw as Record<string, unknown>) : raw)),
  } as SessionState;
}

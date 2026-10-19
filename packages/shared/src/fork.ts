import { activeMessages, type AlternativeMessage } from './alternatives.js';
import type { SessionState } from './state/writes.js';

/**
 * Forking a chat from a reply: the pure rules. A fork is a new chat holding the messages and story state of a chat up to
 * a chosen reply. Story state is per TURN (a turn is present while any of its replies is, and then all its writes
 * apply), so the cut always falls at the end of a turn, never between two replies of one, and the turn entries are cut
 * by the turns that are kept, not by position.
 *
 * Like alternatives.ts, these functions are pure, never throw and never change their input. Stored sessions are not
 * parsed on read, so the fields they need are read defensively.
 */

/** The part of a message the fork rules read. */
export type ForkMessage = AlternativeMessage;

/** What `forkCut` gives the new chat. */
export type ForkCut<M extends ForkMessage> = { messages: M[]; state: SessionState };

/**
 * The ids of the messages a fork may start from, in chat order: the last shown, settled reply of each turn. A turn is
 * an `executionId`, and a reply without one (older chats) is a turn of its own. A turn with several replies (several
 * workflows in the reply list, or several Chat Outputs) can only be cut after the last one, or the turn would stay
 * present with the writes of the runs behind the replies that were cut. User messages are never fork points.
 */
export function forkPoints(messages: readonly ForkMessage[]): string[] {
  const replies = activeMessages(messages).filter((m) => m.role === 'assistant' && m.status !== 'streaming');
  const lastOfTurn = new Map<string, string>();
  for (const reply of replies) if (reply.executionId) lastOfTurn.set(reply.executionId, reply.id);
  return replies.filter((m) => !m.executionId || lastOfTurn.get(m.executionId) === m.id).map((m) => m.id);
}

/**
 * The index of the last row of the turn `chosen` belongs to: every row whose `executionId` is the turn's root (the first
 * alternative's execution), or whose `alternativeOf` is. That covers the user message and every alternative's replies,
 * shown or not. A reply without an `executionId` is its own turn.
 */
function turnEnd(messages: readonly ForkMessage[], chosen: ForkMessage): number {
  const root = chosen.executionId ? (chosen.alternativeOf ?? chosen.executionId) : undefined;
  if (!root) return messages.indexOf(chosen);
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.executionId === root || message.alternativeOf === root) return i;
  }
  return messages.indexOf(chosen);
}

const executionIdOf = (entry: unknown): unknown =>
  typeof entry === 'object' && entry !== null ? (entry as { executionId?: unknown }).executionId : undefined;

/**
 * `state` cut to the turns of `kept`: the stored entries up to and including the last one whose `executionId` belongs to
 * a kept message. A turn that produced no reply counts without any message, so entries are cut by position rather than
 * copied wholesale: a reply-less turn before the cut stays, one after it goes. Entries are decided by their raw
 * `executionId` and never re-serialized, so unknown keys of `state` and entries this version cannot read survive as
 * stored (the `withTurnEntry` style).
 */
function stateUpTo(state: unknown, kept: readonly ForkMessage[]): SessionState {
  const executionIds = new Set(kept.flatMap((m) => (m.executionId ? [m.executionId] : [])));
  const rest = typeof state === 'object' && state !== null && !Array.isArray(state) ? state : {};
  const turns = Array.isArray((rest as { turns?: unknown }).turns) ? (rest as { turns: unknown[] }).turns : [];
  let end = 0;
  turns.forEach((entry, index) => {
    const executionId = executionIdOf(entry);
    if (typeof executionId === 'string' && executionIds.has(executionId)) end = index + 1;
  });
  return { ...rest, turns: turns.slice(0, end) } as SessionState;
}

/**
 * The messages and story state for a chat forked after `messageId`, or `undefined` when that message is not a fork point
 * (see `forkPoints`), so the caller can refuse without a separate check.
 *
 * - Messages: every stored row up to the end of the chosen turn, in stored order and unchanged (ids, unknown fields,
 *   `inactive` rows of earlier turns); `streaming` rows are left out. `keepAlternatives: false` filters them through
 *   `activeMessages`, so the fork holds no hidden alternative at all.
 * - State: see `stateUpTo`. The fold over the result equals the fold over the source with the later turns removed, so
 *   turn numbers, cooldowns and node state continue with no special case.
 */
export function forkCut<M extends ForkMessage>(
  messages: readonly M[],
  state: unknown,
  messageId: string,
  { keepAlternatives }: { keepAlternatives: boolean },
): ForkCut<M> | undefined {
  if (!forkPoints(messages).includes(messageId)) return undefined;
  const chosen = messages.find((m) => m.id === messageId)!;
  const settled = messages.slice(0, turnEnd(messages, chosen) + 1).filter((m) => m.status !== 'streaming');
  const kept = keepAlternatives ? settled : activeMessages(settled);
  return { messages: kept, state: stateUpTo(state, kept) };
}

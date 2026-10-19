import type { ChatMessage } from './models.js';

/**
 * Regenerate and swipes. An alternative is an ordinary turn (its own `executionId`, `TurnEntry` and replies); the
 * alternatives of one turn are tied by the `executionId` of the first one, the ROOT, which the replies of every later
 * alternative carry as `alternativeOf`. Exactly one alternative is active; the replies of the others are `inactive`
 * and kept. Story state needs no rule of its own: an inactive reply is not there for `turnPresence`, so the turn it
 * belongs to is not present and its writes do not apply (flipping the active alternative flips which writes apply).
 *
 * These functions are pure, never throw and never change their input. Stored sessions are not parsed on read, so they
 * read the two fields defensively: only `inactive === true` makes a message inactive, and a message without
 * `alternativeOf` is just a turn of its own.
 */

/** The part of a message the alternatives rules read. */
export type AlternativeMessage = Pick<
  ChatMessage,
  'id' | 'role' | 'executionId' | 'status' | 'alternativeOf' | 'inactive'
>;

/**
 * The messages that are in the chat: everything but the replies of alternatives that aren't shown. EVERY reader of a
 * chat (history for a run, turn presence, links, rendering, the delete check) goes through this.
 */
export function activeMessages<M extends object>(messages: readonly M[]): M[] {
  return messages.filter((message) => (message as { inactive?: unknown }).inactive !== true);
}

/** One alternative of the last turn: its execution and its assistant rows, in chat order. */
export type Alternative = { executionId: string; messageIds: string[] };

/** What `alternativesOfLastTurn` finds. */
export type LastTurnAlternatives = {
  /** The `executionId` of the first alternative; every other alternative carries it as `alternativeOf`. */
  rootId: string;
  /** All the alternatives (at least one), in created order: the order their first reply appears in the messages. */
  alternatives: Alternative[];
  /** The shown alternative's `executionId`, and its position in `alternatives` (0-based). */
  activeExecutionId: string;
  activeIndex: number;
  /** The last reply of the shown alternative: the one message that carries the regenerate and swipe controls. */
  lastReplyId: string;
};

type Group = { rootId: string; anchor: number; members: number[] };

/**
 * THE LAST TURN: the execution of the last active assistant reply (settled, so not `streaming`, with an
 * `executionId`) provided no active user message comes after it. A user message after it means the last turn
 * produced no reply, or a newer message was sent, so there is nothing to regenerate or swipe. The test is by
 * `executionId`, not by user messages, so a turn that followed an empty send (no user message of its own) works the
 * same: its replies simply follow the previous turn's.
 *
 * Its group, the alternatives: the assistant rows (active or not, settled) whose `executionId` is the root or whose
 * `alternativeOf` is the root, where root = that reply's `alternativeOf ?? executionId`. The user message that shares
 * the root's `executionId` is not a member.
 */
function lastTurnGroup(messages: readonly AlternativeMessage[]): Group | undefined {
  let anchor = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.inactive === true) continue;
    if (message.role === 'user') return undefined;
    if (message.status === 'streaming') continue;
    if (!message.executionId) return undefined;
    anchor = i;
    break;
  }
  if (anchor === -1) return undefined;
  const last = messages[anchor]!;
  const rootId = last.alternativeOf ?? last.executionId!;
  const members: number[] = [];
  messages.forEach((message, index) => {
    if (message.role !== 'assistant' || message.status === 'streaming' || !message.executionId) return;
    if (message.executionId === rootId || message.alternativeOf === rootId) members.push(index);
  });
  return { rootId, anchor, members };
}

/**
 * The alternatives of the chat's last turn, or `null` when there is no such turn (see `lastTurnGroup` for the rule): a
 * chat with no assistant reply, or a user message after the last reply. A turn that was never regenerated has one
 * alternative; the web shows swipe controls only from two.
 */
export function alternativesOfLastTurn(messages: readonly AlternativeMessage[]): LastTurnAlternatives | null {
  const group = lastTurnGroup(messages);
  if (!group) return null;
  const byExecution = new Map<string, Alternative>();
  for (const index of group.members) {
    const message = messages[index]!;
    const alternative = byExecution.get(message.executionId!) ?? { executionId: message.executionId!, messageIds: [] };
    alternative.messageIds.push(message.id);
    byExecution.set(message.executionId!, alternative);
  }
  const alternatives = [...byExecution.values()];
  const active = messages[group.anchor]!;
  return {
    rootId: group.rootId,
    alternatives,
    activeExecutionId: active.executionId!,
    activeIndex: alternatives.findIndex((alternative) => alternative.executionId === active.executionId),
    lastReplyId: active.id,
  };
}

/**
 * The messages with `executionId` as the shown alternative of the last turn: every reply of the group outside it gets
 * `inactive: true`, and the chosen one's replies lose the key (absent = active, never `false`). Messages that don't
 * change keep their identity. Returns `undefined` when `executionId` is not an alternative of the last turn (see
 * `alternativesOfLastTurn`), so the caller can refuse (the swipe route answers 400) without a separate check.
 */
export function withActiveAlternative<M extends AlternativeMessage>(
  messages: readonly M[],
  executionId: string,
): M[] | undefined {
  const group = lastTurnGroup(messages);
  if (!group || !group.members.some((index) => messages[index]!.executionId === executionId)) return undefined;
  const members = new Set(group.members);
  return messages.map((message, index) => {
    if (!members.has(index)) return message;
    if (message.executionId !== executionId)
      return message.inactive === true ? message : { ...message, inactive: true };
    if (message.inactive === undefined) return message;
    const { inactive: _dropped, ...shown } = message;
    return shown as M;
  });
}

/**
 * The active messages without the last turn's replies, whichever alternative is shown: what a regenerate runs on
 * (history, and the messages to fold the story state over, so `trigger.turn` is the number the original turn had).
 * The user message of the turn stays. `undefined` when there is no last turn to regenerate.
 */
export function withoutLastTurnReplies<M extends AlternativeMessage>(messages: readonly M[]): M[] | undefined {
  const group = lastTurnGroup(messages);
  if (!group) return undefined;
  const members = new Set(group.members);
  return activeMessages(messages.filter((_, index) => !members.has(index)));
}

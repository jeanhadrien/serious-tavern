import { alternativesOfLastTurn, withoutLastTurnReplies, type ChatMessage } from '@st/shared';
import { HttpError } from '../errors.js';
import { historyMessages } from './settle-turn.js';

/** What a regenerate runs on, read from the session's messages (see alternatives.ts). */
export type RegenerateTarget = {
  /** The `executionId` of the first alternative of the last turn: the new replies join its alternatives. */
  rootId: string;
  /** `trigger.message`: the last turn's user message, or `''` when the turn was an empty send. */
  content: string;
  /** The active messages without the last turn's replies, whichever alternative is shown: what the state is folded over. */
  messages: ChatMessage[];
  /** What the nodes see as history: the same as `messages` without the turn's own user message, as in the original run. */
  history: ChatMessage[];
  /** The last turn's user message, absent for an empty send. */
  user?: ChatMessage;
};

/**
 * The last turn of the chat, to run again on the same input; `409 NOTHING_TO_REGENERATE` when there is none (the chat
 * has no assistant reply, or a user message follows the last reply). The original run saw the history from before its
 * user message and got the message separately, so the regenerate does the same; and `trigger.turn` stays the number the
 * original had because the fold ignores every alternative of the turn.
 */
export function regenerateTarget(messages: ChatMessage[]): RegenerateTarget {
  const last = alternativesOfLastTurn(messages);
  const rest = last && withoutLastTurnReplies(messages);
  if (!last || !rest) throw new HttpError(409, 'NOTHING_TO_REGENERATE', 'There is no reply to regenerate');
  const user = rest.find((message) => message.role === 'user' && message.executionId === last.rootId);
  return {
    rootId: last.rootId,
    content: user?.content ?? '',
    messages: rest,
    history: historyMessages(rest.filter((message) => message !== user)),
    ...(user ? { user } : {}),
  };
}

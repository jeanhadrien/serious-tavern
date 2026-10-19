import { withActiveAlternative, type ApiResponse } from '@st/shared';
import type { AppContext } from '../context.js';
import { HttpError, notFound } from '../errors.js';

/**
 * Swipe: shows another alternative of the chat's last turn. Flipping which replies are active is the whole change
 * (story state follows through turn presence), so nothing runs. It is refused while a job holds the session's queue
 * slot (a turn, a regenerate or an after-reply run, which would otherwise lose the turn it works on), checked inside
 * the session's `update` so a job starting meanwhile waits for the write. Like an edit it leaves `updatedAt` alone.
 */
export async function setAlternative(
  { sessions, turns }: AppContext,
  id: string,
  executionId: string,
): Promise<ApiResponse<'setAlternative'>> {
  const session = await sessions.update(id, (current) => {
    if (turns.isRunning(id)) throw new HttpError(409, 'TURN_RUNNING', 'Wait for the running turn to finish');
    const messages = withActiveAlternative(current.messages, executionId);
    if (!messages)
      throw new HttpError(400, 'NOT_AN_ALTERNATIVE', 'That is not an alternative of the last turn of this chat');
    current.messages = messages;
    return current;
  });
  if (!session) throw notFound('Session');
  return session;
}

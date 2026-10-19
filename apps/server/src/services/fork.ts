import { randomUUID } from 'node:crypto';
import { activeMessages, forkCut, type ApiResponse, type Session } from '@st/shared';
import { now, type AppContext } from '../context.js';
import { HttpError, notFound } from '../errors.js';

/**
 * Forks a chat: a new chat that holds the source up to and including the turn of the reply `messageId` (the cut rules are
 * `forkCut` in shared) and continues from there. The source is read under its session lock and refused while a job holds
 * its queue slot (a copied `running` run would read as interrupted in the fork, streaming rows would be copied
 * mid-write); it is never modified, `updatedAt` included.
 *
 * Message ids, `executionId`, `runId` and `alternativeOf` are kept as they are: message links store message ids, and
 * replies open their logs by `runId ?? executionId`, so the fork shares the source's execution logs. Everything else the
 * source stores (reply list, character, persona, settings, keys this version does not know) is copied raw, not
 * validated: stored sessions are not parsed on read, and a workflow or character deleted since is copied as is.
 */
export async function forkSession(
  { sessions, turns, appSettings }: AppContext,
  id: string,
  messageId: string,
): Promise<ApiResponse<'forkSession'>> {
  // `update` is the repository's only locked read; handing the session back unchanged rewrites identical bytes.
  const source = await sessions.silent.update(id, (current) => {
    if (turns.isRunning(id)) throw new HttpError(409, 'TURN_RUNNING', 'Wait for the running turn to finish');
    return current;
  });
  if (!source) throw notFound('Session');
  if (!activeMessages(source.messages).some((message) => message.id === messageId)) throw notFound('Message');
  const { forkKeepsAlternatives } = await appSettings.get();
  const cut = forkCut(source.messages, source.state, messageId, { keepAlternatives: forkKeepsAlternatives });
  if (!cut) throw new HttpError(400, 'NOT_A_FORK_POINT', 'A chat can only be forked from the last reply of a turn');
  const date = now();
  const fork: Session = {
    ...source,
    id: randomUUID(),
    title: `${source.title} (fork)`,
    messages: cut.messages,
    state: cut.state,
    forkedFrom: { sessionId: id, messageId },
    createdAt: date,
    updatedAt: date,
  };
  await sessions.save(fork);
  return fork;
}

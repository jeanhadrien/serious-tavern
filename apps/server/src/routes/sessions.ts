import type { FastifyInstance } from 'fastify';
import { activeMessages, apiContract } from '@st/shared';
import type { AppContext } from '../context.js';
import { requireEntity } from '../errors.js';
import { setAlternative } from '../services/alternatives.js';
import { forkSession } from '../services/fork.js';
import { sessionStats } from '../services/message-stats.js';
import { sessionStateView } from '../services/session-state.js';
import { createSession, updateSession } from '../services/sessions.js';
import { route } from './route.js';

export function registerSessions(app: FastifyInstance, context: AppContext) {
  const { sessions } = context;
  route(app, 'listSessions', async () =>
    // The turn entries are the session's own business: a list carries neither messages nor state.
    (await sessions.list()).map(({ messages, state: _state, ...session }) => ({
      ...session,
      messageCount: activeMessages(messages).length,
    })),
  );
  route(app, 'createSession', async (request, reply) =>
    reply.code(201).send(await createSession(context, apiContract.createSession.body.parse(request.body))),
  );
  route(app, 'getSession', async (request) =>
    requireEntity(sessions, apiContract.getSession.params.parse(request.params).id, 'Session'),
  );
  route(app, 'getSessionState', async (request) =>
    sessionStateView(context, apiContract.getSessionState.params.parse(request.params).id),
  );
  route(app, 'getSessionStats', async (request) =>
    sessionStats(context, apiContract.getSessionStats.params.parse(request.params).id),
  );
  route(app, 'updateSession', async (request) => {
    const { id } = apiContract.updateSession.params.parse(request.params);
    return updateSession(context, id, apiContract.updateSession.body.parse(request.body));
  });
  route(app, 'setAlternative', async (request) => {
    const { id } = apiContract.setAlternative.params.parse(request.params);
    return setAlternative(context, id, apiContract.setAlternative.body.parse(request.body).executionId);
  });
  route(app, 'forkSession', async (request, reply) => {
    const { id } = apiContract.forkSession.params.parse(request.params);
    const { messageId } = apiContract.forkSession.body.parse(request.body);
    return reply.code(201).send(await forkSession(context, id, messageId));
  });
  route(app, 'deleteSession', async (request, reply) => {
    const { id } = apiContract.deleteSession.params.parse(request.params);
    // A running turn (or a run after its reply) of the chat would only work for a chat that is gone: stop it first.
    context.turns.stop(id);
    await sessions.delete(id);
    return reply.code(204).send();
  });
}

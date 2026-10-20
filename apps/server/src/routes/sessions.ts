import type { FastifyInstance } from 'fastify';
import { activeMessages, apiContract } from '@st/shared';
import type { AppContext } from '../context.js';
import { requireEntity } from '../errors.js';
import { setAlternative } from '../services/alternatives.js';
import { sessionStateView } from '../services/session-state.js';
import { createSession, updateSession } from '../services/sessions.js';
import type { ApiRoute } from './types.js';

export function registerSessions(app: FastifyInstance, context: AppContext) {
  const { sessions } = context;
  app.get<ApiRoute<'listSessions'>>('/api/sessions', async () =>
    // The turn entries are the session's own business: a list carries neither messages nor state.
    (await sessions.list()).map(({ messages, state: _state, ...session }) => ({
      ...session,
      messageCount: activeMessages(messages).length,
    })),
  );
  app.post<ApiRoute<'createSession'>>('/api/sessions', async (request, reply) =>
    reply.code(201).send(await createSession(context, apiContract.createSession.body.parse(request.body))),
  );
  app.get<ApiRoute<'getSession'>>('/api/sessions/:id', async (request) =>
    requireEntity(sessions, apiContract.getSession.params.parse(request.params).id, 'Session'),
  );
  app.get<ApiRoute<'getSessionState'>>('/api/sessions/:id/state', async (request) =>
    sessionStateView(context, apiContract.getSessionState.params.parse(request.params).id),
  );
  app.patch<ApiRoute<'updateSession'>>('/api/sessions/:id', async (request) => {
    const { id } = apiContract.updateSession.params.parse(request.params);
    return updateSession(context, id, apiContract.updateSession.body.parse(request.body));
  });
  app.patch<ApiRoute<'setAlternative'>>('/api/sessions/:id/alternative', async (request) => {
    const { id } = apiContract.setAlternative.params.parse(request.params);
    return setAlternative(context, id, apiContract.setAlternative.body.parse(request.body).executionId);
  });
  app.delete<ApiRoute<'deleteSession'>>('/api/sessions/:id', async (request, reply) => {
    const { id } = apiContract.deleteSession.params.parse(request.params);
    // A running turn (or a run after its reply) of the chat would only work for a chat that is gone: stop it first.
    context.turns.stop(id);
    await sessions.delete(id);
    return reply.code(204).send();
  });
}

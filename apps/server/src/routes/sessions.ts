import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { apiContract, type ApiResponse } from '@st/shared';
import { now, type AppContext } from '../context.js';
import { requireEntity } from '../errors.js';
import { sessionStateView } from '../services/session-state.js';
import { updateSession } from '../services/sessions.js';
import type { ApiRoute } from './types.js';

export function registerSessions(app: FastifyInstance, context: AppContext) {
  const { workflows, characters, personas, sessions } = context;
  app.get<ApiRoute<'listSessions'>>('/api/sessions', async () =>
    // The turn entries are the session's own business: a list carries neither messages nor state.
    (await sessions.list()).map(({ messages, state: _state, ...session }) => ({
      ...session,
      messageCount: messages.length,
    })),
  );
  app.post<ApiRoute<'createSession'>>('/api/sessions', async (request, reply) => {
    const body = apiContract.createSession.body.parse(request.body);
    await requireEntity(workflows, body.workflowId, 'Workflow');
    if (body.characterId) await requireEntity(characters, body.characterId, 'Character');
    if (body.personaId) await requireEntity(personas, body.personaId, 'Persona');
    const date = now();
    const session: ApiResponse<'createSession'> = {
      id: randomUUID(),
      title: body.title ?? 'New chat',
      workflowId: body.workflowId,
      characterId: body.characterId,
      personaId: body.personaId,
      settings: {},
      state: { turns: [] },
      messages: [],
      createdAt: date,
      updatedAt: date,
    };
    await sessions.save(session);
    return reply.code(201).send(session);
  });
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
  app.delete<ApiRoute<'deleteSession'>>('/api/sessions/:id', async (request, reply) => {
    await sessions.delete(apiContract.deleteSession.params.parse(request.params).id);
    return reply.code(204).send();
  });
}

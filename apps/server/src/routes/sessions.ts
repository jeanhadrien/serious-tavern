import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { apiContract, type ApiResponse } from '@st/shared';
import { now, type AppContext } from '../context.js';
import { notFound, requireEntity } from '../errors.js';
import type { ApiRoute } from './types.js';

export function registerSessions(app: FastifyInstance, { workflows, characters, personas, sessions }: AppContext) {
  app.get<ApiRoute<'listSessions'>>('/api/sessions', async () =>
    (await sessions.list()).map(({ messages, ...session }) => ({ ...session, messageCount: messages.length })),
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
  app.patch<ApiRoute<'updateSession'>>('/api/sessions/:id', async (request) => {
    const { id } = apiContract.updateSession.params.parse(request.params);
    const body = apiContract.updateSession.body.parse(request.body);
    const session = await sessions.update(id, async (current) => {
      if (body.workflowId) await requireEntity(workflows, body.workflowId, 'Workflow');
      if (body.characterId) await requireEntity(characters, body.characterId, 'Character');
      if (body.personaId) await requireEntity(personas, body.personaId, 'Persona');
      if (body.characterId === null) delete current.characterId;
      if (body.personaId === null) delete current.personaId;
      Object.assign(current, Object.fromEntries(Object.entries(body).filter(([, value]) => value !== null)));
      return current;
    });
    if (!session) throw notFound('Session');
    return session;
  });
  app.delete<ApiRoute<'deleteSession'>>('/api/sessions/:id', async (request, reply) => {
    await sessions.delete(apiContract.deleteSession.params.parse(request.params).id);
    return reply.code(204).send();
  });
}

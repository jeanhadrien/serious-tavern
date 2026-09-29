import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { apiContract, personaSchema } from '@st/shared';
import { now, type AppContext } from '../context.js';
import { requireEntity } from '../errors.js';
import { importPersonas } from '../services/persona-import.js';
import { parseImageRequest, removeAvatar, sendAvatar, storeAvatar, uploadedFiles } from '../uploads.js';
import type { ApiRoute } from './types.js';

export function registerPersonas(app: FastifyInstance, context: AppContext) {
  const { personas, personaAvatars } = context;
  app.get<ApiRoute<'listPersonas'>>('/api/personas', async () => personas.list());
  app.post<ApiRoute<'createPersona'>>('/api/personas', async (request, reply) => {
    const body = apiContract.createPersona.body.parse(request.body);
    const date = now();
    const persona = personaSchema.parse({ id: randomUUID(), ...body, avatar: false, createdAt: date, updatedAt: date });
    await personas.save(persona);
    return reply.code(201).send(persona);
  });
  app.get<ApiRoute<'getPersona'>>('/api/personas/:id', async (request) =>
    requireEntity(personas, apiContract.getPersona.params.parse(request.params).id, 'Persona'),
  );
  app.put<ApiRoute<'updatePersona'>>('/api/personas/:id', async (request) => {
    const { id } = apiContract.updatePersona.params.parse(request.params);
    const old = await requireEntity(personas, id, 'Persona');
    const body = apiContract.updatePersona.body.parse(request.body);
    const persona = personaSchema.parse({
      ...old,
      ...body,
      id,
      avatar: old.avatar,
      createdAt: old.createdAt,
      updatedAt: now(),
    });
    await personas.save(persona);
    return persona;
  });
  app.delete<ApiRoute<'deletePersona'>>('/api/personas/:id', async (request, reply) => {
    const { id } = apiContract.deletePersona.params.parse(request.params);
    await requireEntity(personas, id, 'Persona');
    await Promise.all([personas.delete(id), removeAvatar(personaAvatars, id)]);
    return reply.code(204).send();
  });
  app.get<ApiRoute<'getPersonaAvatar'>>('/api/personas/:id/avatar', async (request, reply) => {
    const { id } = apiContract.getPersonaAvatar.params.parse(request.params);
    const persona = await requireEntity(personas, id, 'Persona');
    return sendAvatar(reply, personaAvatars, persona.avatar);
  });
  app.put<ApiRoute<'updatePersonaAvatar'>>('/api/personas/:id/avatar', async (request, reply) => {
    const { id } = apiContract.updatePersonaAvatar.params.parse(request.params);
    const old = await requireEntity(personas, id, 'Persona');
    const avatar = await storeAvatar(personaAvatars, id, parseImageRequest(request));
    const persona = { ...old, avatar, updatedAt: now() };
    await personas.save(persona);
    return reply.send(persona);
  });
  app.post<ApiRoute<'importPersonas'>>('/api/personas/import', async (request) =>
    importPersonas(context, uploadedFiles(request)),
  );
}

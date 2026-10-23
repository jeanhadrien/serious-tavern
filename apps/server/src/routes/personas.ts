import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { apiContract, personaSchema } from '@st/shared';
import { now, type AppContext } from '../context.js';
import { requireEntity } from '../errors.js';
import { importPersonas } from '../services/persona-import.js';
import { deleteEntity, updateEntity, updateEntityAvatar } from '../services/entity-mutations.js';
import { parseImageRequest, sendAvatar, uploadedFiles } from '../uploads.js';
import { route } from './route.js';

export function registerPersonas(app: FastifyInstance, context: AppContext) {
  const { personas, personaAvatars } = context;
  route(app, 'listPersonas', async () => personas.list());
  route(app, 'createPersona', async (request, reply) => {
    const body = apiContract.createPersona.body.parse(request.body);
    const date = now();
    const persona = personaSchema.parse({ id: randomUUID(), ...body, avatar: false, createdAt: date, updatedAt: date });
    await personas.save(persona);
    return reply.code(201).send(persona);
  });
  route(app, 'getPersona', async (request) =>
    requireEntity(personas, apiContract.getPersona.params.parse(request.params).id, 'Persona'),
  );
  route(app, 'updatePersona', async (request) => {
    const { id } = apiContract.updatePersona.params.parse(request.params);
    const body = apiContract.updatePersona.body.parse(request.body);
    return updateEntity(personas, id, body, personaSchema, 'Persona');
  });
  route(app, 'deletePersona', async (request, reply) => {
    const { id } = apiContract.deletePersona.params.parse(request.params);
    await deleteEntity(personas, personaAvatars, id, 'Persona');
    return reply.code(204).send();
  });
  route(app, 'getPersonaAvatar', async (request, reply) => {
    const { id } = apiContract.getPersonaAvatar.params.parse(request.params);
    const persona = await requireEntity(personas, id, 'Persona');
    return sendAvatar(reply, personaAvatars, persona.avatar);
  });
  route(app, 'updatePersonaAvatar', async (request, reply) => {
    const { id } = apiContract.updatePersonaAvatar.params.parse(request.params);
    const persona = await updateEntityAvatar(personas, personaAvatars, id, parseImageRequest(request), 'Persona');
    return reply.send(persona);
  });
  route(app, 'importPersonas', async (request) => importPersonas(context, uploadedFiles(request)));
}

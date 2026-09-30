import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { apiContract, characterSchema } from '@st/shared';
import { now, type AppContext } from '../context.js';
import { requireEntity } from '../errors.js';
import { cardData, exportCharacterPng, importCharacters } from '../services/character-cards.js';
import { deleteEntity, updateEntity, updateEntityAvatar } from '../services/entity-mutations.js';
import { parseImageRequest, sendAvatar, uploadedFiles } from '../uploads.js';
import type { ApiRoute } from './types.js';

export function registerCharacters(app: FastifyInstance, context: AppContext) {
  const { characters, characterAvatars } = context;
  app.get<ApiRoute<'listCharacters'>>('/api/characters', async () => characters.list());
  app.post<ApiRoute<'createCharacter'>>('/api/characters', async (request, reply) => {
    const body = apiContract.createCharacter.body.parse(request.body);
    const date = now();
    const character = characterSchema.parse({
      id: randomUUID(),
      ...body,
      avatar: false,
      createdAt: date,
      updatedAt: date,
    });
    await characters.save(character);
    return reply.code(201).send(character);
  });
  app.get<ApiRoute<'getCharacter'>>('/api/characters/:id', async (request) =>
    requireEntity(characters, apiContract.getCharacter.params.parse(request.params).id, 'Character'),
  );
  app.put<ApiRoute<'updateCharacter'>>('/api/characters/:id', async (request) => {
    const { id } = apiContract.updateCharacter.params.parse(request.params);
    const body = apiContract.updateCharacter.body.parse(request.body);
    return updateEntity(characters, id, body, characterSchema, 'Character');
  });
  app.delete<ApiRoute<'deleteCharacter'>>('/api/characters/:id', async (request, reply) => {
    const { id } = apiContract.deleteCharacter.params.parse(request.params);
    await deleteEntity(characters, characterAvatars, id, 'Character');
    return reply.code(204).send();
  });
  app.get<ApiRoute<'getCharacterAvatar'>>('/api/characters/:id/avatar', async (request, reply) => {
    const { id } = apiContract.getCharacterAvatar.params.parse(request.params);
    const character = await requireEntity(characters, id, 'Character');
    return sendAvatar(reply, characterAvatars, character.avatar);
  });
  app.put<ApiRoute<'updateCharacterAvatar'>>('/api/characters/:id/avatar', async (request, reply) => {
    const { id } = apiContract.updateCharacterAvatar.params.parse(request.params);
    const file = parseImageRequest(request);
    const character = await updateEntityAvatar(characters, characterAvatars, id, file, 'Character');
    return reply.send(character);
  });
  app.post<ApiRoute<'importCharacters'>>('/api/characters/import', async (request) =>
    importCharacters(context, uploadedFiles(request)),
  );
  app.get<ApiRoute<'exportCharacter'>>('/api/characters/:id/export', async (request, reply) => {
    const { id } = apiContract.exportCharacter.params.parse(request.params);
    const { format } = apiContract.exportCharacter.query.parse(request.query);
    const character = await requireEntity(characters, id, 'Character');
    const safeName = character.name.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'character';
    if (format === 'json')
      return reply
        .type('application/json; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${safeName}.json"`)
        .serializer((data) => JSON.stringify(data, null, 2))
        .send(cardData(character));
    const png = await exportCharacterPng(character, characterAvatars);
    return reply.type('image/png').header('Content-Disposition', `attachment; filename="${safeName}.png"`).send(png);
  });
}

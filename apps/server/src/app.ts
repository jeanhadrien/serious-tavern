import Fastify from 'fastify';
import { extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { workflowSchema, presetSchema, presetWarnings, characterSchema, personaSchema,
  type Character, type Persona, type Preset, type Workflow, type Session, type ExecutionLog } from '@st/shared';
import { descriptors, executeWorkflow, ExecutionFailure, registry, validateWorkflow, renderPreset, providers } from '@st/engine';
import { JsonRepository } from './storage/repository.js';
import { SecretStore } from './secrets/store.js';
import { seed } from './seed.js';
import { HttpError, notFound } from './errors.js';
import { InvalidCardError, characterFromCard, placeholderPng, readCharacterCardPng,
  readPngTextChunks, writePngCard } from './card.js';
import { imageExtension, MAX_UPLOAD_BYTES, parseMultipart, removeAvatar, sendAvatar, storeAvatar, type UploadedFile } from './uploads.js';

const idParam = z.object({ id: z.string().uuid() });
const nameParam = z.object({ name: z.string().regex(/^[a-zA-Z0-9_-]+$/) });
const now = () => new Date().toISOString();
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export async function createApp(dataDir = join(process.cwd(), 'data'), options: { seed?: boolean } = {}) {
  const app = Fastify({ logger: false, bodyLimit: MAX_UPLOAD_BYTES + 256 * 1024 });
  const parseJson = app.getDefaultJsonParser('error', 'error');
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    if (body.length === 0) return done(null, {});
    parseJson(request, typeof body === 'string' ? body : body.toString('utf8'), done);
  });
  app.addContentTypeParser(/^multipart\/form-data/i, { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
  app.addContentTypeParser(/^image\/(png|jpeg|gif|webp)$/i, { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
  const workflows = new JsonRepository<Workflow>(join(dataDir, 'workflows'));
  const presets = new JsonRepository<Preset>(join(dataDir, 'presets'));
  const sessions = new JsonRepository<Session>(join(dataDir, 'sessions'));
  const executions = new JsonRepository<ExecutionLog>(join(dataDir, 'executions'));
  const characters = new JsonRepository<Character>(join(dataDir, 'characters'));
  const personas = new JsonRepository<Persona>(join(dataDir, 'personas'));
  const characterAvatars = join(dataDir, 'avatars', 'characters');
  const personaAvatars = join(dataDir, 'avatars', 'personas');
  const secrets = new SecretStore(dataDir);
  await secrets.init();
  if (options.seed !== false) await seed(workflows, presets);

  app.get('/api/node-types', async () => descriptors());
  app.get('/api/providers', async () => [...providers.values()].map(({ id, label, secretName }) => ({ id, label, secretName })));
  app.post('/api/node-types/:type/ports', async request => {
    const type = z.object({ type: z.string() }).parse(request.params).type;
    const definition = registry.get(type);
    if (!definition) throw notFound('Node type');
    const config = z.object({ config: z.record(z.string(), z.unknown()) }).parse(request.body).config;
    try { return definition.resolvePorts ? await definition.resolvePorts(config, { presets }) :
      { inputs: definition.inputs, outputs: definition.outputs }; }
    catch (error) { throw new HttpError(422, 'PORT_RESOLUTION_FAILED', errorMessage(error)); }
  });

  const characterFields = z.object({
    name: z.string().trim().min(1), description: z.string().default(''), personality: z.string().default(''),
    scenario: z.string().default(''), first_mes: z.string().default(''), mes_example: z.string().default(''),
    creator_notes: z.string().default(''), system_prompt: z.string().default(''),
    post_history_instructions: z.string().default(''), alternate_greetings: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]), creator: z.string().default(''), character_version: z.string().default(''),
    extensions: z.record(z.string(), z.unknown()).default({})
  });
  const personaFields = z.object({ name: z.string().trim().min(1), description: z.string().default('') });
  const avatarName = (id: string, format: string) => `${id}.${format}`;
  const cardData = (character: Character) => ({
    ...character.extensions, name: character.name, description: character.description,
    personality: character.personality, scenario: character.scenario, first_mes: character.first_mes,
    mes_example: character.mes_example, creator_notes: character.creator_notes, system_prompt: character.system_prompt,
    post_history_instructions: character.post_history_instructions, alternate_greetings: character.alternate_greetings,
    tags: character.tags, creator: character.creator, character_version: character.character_version
  });
  const normalizeImage = (file: UploadedFile): UploadedFile => {
    if (file.mime !== 'application/octet-stream') return file;
    const suffix = extname(file.name).toLowerCase();
    const mime = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.webp': 'image/webp' } as Record<string, string>)[suffix];
    return { ...file, mime: mime ?? file.mime };
  };
  const uploadedFiles = (request: import('fastify').FastifyRequest) =>
    parseMultipart(request.body, String(request.headers['content-type'] ?? ''));
  const parseImageRequest = (request: import('fastify').FastifyRequest): UploadedFile => {
    if (String(request.headers['content-type'] ?? '').toLowerCase().startsWith('multipart/'))
      return normalizeImage(uploadedFiles(request)[0]!);
    if (!Buffer.isBuffer(request.body)) throw new HttpError(400, 'INVALID_UPLOAD', 'Expected an image upload');
    return normalizeImage({ name: 'avatar', mime: String(request.headers['content-type'] ?? ''), data: request.body });
  };

  app.get('/api/characters', async () => characters.list());
  app.post('/api/characters', async (request, reply) => {
    const body = characterFields.parse(request.body);
    const date = now();
    const character = characterSchema.parse({ id: randomUUID(), ...body, avatar: false, createdAt: date, updatedAt: date });
    await characters.save(character);
    return reply.code(201).send(character);
  });
  app.get('/api/characters/:id', async request => {
    const character = await characters.get(idParam.parse(request.params).id);
    if (!character) throw notFound('Character');
    return character;
  });
  app.put('/api/characters/:id', async request => {
    const { id } = idParam.parse(request.params);
    const old = await characters.get(id);
    if (!old) throw notFound('Character');
    const body = characterFields.partial().parse(request.body);
    const character = characterSchema.parse({ ...old, ...body, id, avatar: old.avatar, createdAt: old.createdAt, updatedAt: now() });
    await characters.save(character);
    return character;
  });
  app.delete('/api/characters/:id', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    if (!await characters.get(id)) throw notFound('Character');
    await Promise.all([characters.delete(id), removeAvatar(characterAvatars, id)]);
    return reply.code(204).send();
  });
  app.get('/api/characters/:id/avatar', async (request, reply) => {
    const character = await characters.get(idParam.parse(request.params).id);
    if (!character) throw notFound('Character');
    return sendAvatar(reply, characterAvatars, character.avatar);
  });
  app.put('/api/characters/:id/avatar', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const old = await characters.get(id);
    if (!old) throw notFound('Character');
    const file = parseImageRequest(request);
    const avatar = await storeAvatar(characterAvatars, id, file);
    const character = { ...old, avatar, updatedAt: now() };
    await characters.save(character);
    return reply.send(character);
  });
  app.post('/api/characters/import', async request => {
    const files = uploadedFiles(request);
    const imported: Character[] = [];
    const failed: { filename: string; error: { code: string; message: string } }[] = [];
    for (const source of files) {
      const file = normalizeImage(source);
      const id = randomUUID();
      const date = now();
      try {
        if (file.data.length > MAX_UPLOAD_BYTES) throw new HttpError(413, 'UPLOAD_TOO_LARGE', 'File must be 20 MB or smaller');
        let character: Character;
        if (file.mime === 'image/png' || /\.png$/i.test(file.name)) {
          const image = { ...file, mime: 'image/png' };
          const avatar = avatarName(id, 'png');
          character = readCharacterCardPng(image.data, id, date, avatar);
          await storeAvatar(characterAvatars, id, image);
        } else if (/\.json$/i.test(file.name) || /^(application|text)\/json$/i.test(file.mime)) {
          character = characterFromCard(file.data.toString('utf8'), id, date, false);
        } else throw new InvalidCardError('Import a character card JSON file or PNG with embedded card metadata');
        await characters.save(character);
        imported.push(character);
      } catch (error) {
        if (error instanceof HttpError && error.code === 'UPLOAD_TOO_LARGE') throw error;
        const code = error instanceof InvalidCardError ? 'INVALID_CARD' :
          error instanceof HttpError ? error.code : 'INVALID_CARD';
        failed.push({ filename: file.name, error: { code, message: errorMessage(error) } });
      }
    }
    if (!imported.length && failed.length === 1 && failed[0]!.error.code === 'INVALID_CARD')
      throw new HttpError(400, 'INVALID_CARD', failed[0]!.error.message, failed);
    return { imported, failed };
  });
  app.get('/api/characters/:id/export', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const { format } = z.object({ format: z.enum(['png', 'json']).default('json') }).parse(request.query);
    const character = await characters.get(id);
    if (!character) throw notFound('Character');
    const data = cardData(character);
    const safeName = character.name.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'character';
    if (format === 'json') return reply.type('application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${safeName}.json"`).send(JSON.stringify(data, null, 2));
    let image = placeholderPng();
    if (typeof character.avatar === 'string') {
      try { image = await import('node:fs/promises').then(fs => fs.readFile(join(characterAvatars, character.avatar as string))); }
      catch { image = placeholderPng(); }
    }
    const v2 = JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data });
    const v3 = JSON.stringify({ spec: 'chara_card_v3', spec_version: '3.0', data });
    const png = writePngCard(image, v2, v3);
    return reply.type('image/png').header('Content-Disposition', `attachment; filename="${safeName}.png"`).send(png);
  });

  app.get('/api/personas', async () => personas.list());
  app.post('/api/personas', async (request, reply) => {
    const body = personaFields.parse(request.body);
    const date = now();
    const persona = personaSchema.parse({ id: randomUUID(), ...body, avatar: false, createdAt: date, updatedAt: date });
    await personas.save(persona);
    return reply.code(201).send(persona);
  });
  app.get('/api/personas/:id', async request => {
    const persona = await personas.get(idParam.parse(request.params).id);
    if (!persona) throw notFound('Persona');
    return persona;
  });
  app.put('/api/personas/:id', async request => {
    const { id } = idParam.parse(request.params);
    const old = await personas.get(id);
    if (!old) throw notFound('Persona');
    const body = personaFields.partial().parse(request.body);
    const persona = personaSchema.parse({ ...old, ...body, id, avatar: old.avatar, createdAt: old.createdAt, updatedAt: now() });
    await personas.save(persona);
    return persona;
  });
  app.delete('/api/personas/:id', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    if (!await personas.get(id)) throw notFound('Persona');
    await Promise.all([personas.delete(id), removeAvatar(personaAvatars, id)]);
    return reply.code(204).send();
  });
  app.get('/api/personas/:id/avatar', async (request, reply) => {
    const persona = await personas.get(idParam.parse(request.params).id);
    if (!persona) throw notFound('Persona');
    return sendAvatar(reply, personaAvatars, persona.avatar);
  });
  app.put('/api/personas/:id/avatar', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const old = await personas.get(id);
    if (!old) throw notFound('Persona');
    const avatar = await storeAvatar(personaAvatars, id, parseImageRequest(request));
    const persona = { ...old, avatar, updatedAt: now() };
    await personas.save(persona);
    return reply.send(persona);
  });
  app.post('/api/personas/import', async request => {
    const files = uploadedFiles(request);
    const imported: Persona[] = [];
    const failed: { filename: string; error: { code: string; message: string } }[] = [];
    for (const source of files) {
      const file = normalizeImage(source);
      const id = randomUUID();
      const date = now();
      try {
        if (file.data.length > MAX_UPLOAD_BYTES) throw new HttpError(413, 'UPLOAD_TOO_LARGE', 'File must be 20 MB or smaller');
        const avatarFile = { ...file, mime: imageExtension(file.mime) === '.png' ? 'image/png' : file.mime };
        const avatar = avatarName(id, imageExtension(avatarFile.mime).slice(1));
        let name = file.name.replace(/\.[^.]*$/, '').trim() || 'New persona';
        let description = '';
        if (avatarFile.mime === 'image/png') {
          const metadata = readPngTextChunks(file.data);
          if (metadata.has('ccv3') || metadata.has('chara')) {
            const card = readCharacterCardPng(file.data, id, date, avatar);
            name = card.name;
            description = card.description;
          }
        }
        const persona = personaSchema.parse({ id, name, description, avatar, createdAt: date, updatedAt: date });
        await storeAvatar(personaAvatars, id, avatarFile);
        await personas.save(persona);
        imported.push(persona);
      } catch (error) {
        const code = error instanceof HttpError ? error.code : error instanceof InvalidCardError ? 'INVALID_CARD' : 'INVALID_IMAGE';
        failed.push({ filename: file.name, error: { code, message: errorMessage(error) } });
      }
    }
    return { imported, failed };
  });
  app.get('/api/presets', async () => presets.list());
  app.post('/api/presets/preview', async request => {
    const { preset, inputs = {}, sessionId } = z.object({
      preset: presetSchema, inputs: z.record(z.string(), z.string()).optional(), sessionId: z.string().uuid().optional()
    }).parse(request.body);
    const session = sessionId ? await sessions.get(sessionId) : undefined;
    if (sessionId && !session) throw notFound('Session');
    const character = session?.characterId ? await characters.get(session.characterId) : undefined;
    const persona = session?.personaId ? await personas.get(session.personaId) : undefined;
    const values: Record<string, unknown> = { ...inputs };
    const sample = [{ role: 'user', content: 'Hello!' }, { role: 'assistant', content: 'Hi! How can I help?' }];
    for (const input of preset.inputs) {
      if (input.dataType === 'messages') values[input.key] = session ? session.messages : sample;
      else values[input.key] ??= `<${input.key}>`;
    }
    try {
      return { messages: renderPreset(preset, { inputs: values, templateContext: {
        trigger: { message: 'Sample message', sessionId: sessionId ?? 'sample-session' },
        history: session?.messages, character, persona
      } }), warnings: presetWarnings(preset) };
    } catch (error) { throw new HttpError(400, 'PRESET_PREVIEW_INVALID', errorMessage(error)); }
  });
  app.post('/api/presets', async (request, reply) => {
    const date = now();
    const preset = presetSchema.parse({ ...request.body as object, id: randomUUID(), createdAt: date, updatedAt: date });
    await presets.save(preset);
    return reply.code(201).send(preset);
  });
  app.get('/api/presets/:id', async request => {
    const preset = await presets.get(idParam.parse(request.params).id);
    if (!preset) throw notFound('Preset');
    return preset;
  });
  app.put('/api/presets/:id', async request => {
    const { id } = idParam.parse(request.params);
    const old = await presets.get(id);
    if (!old) throw notFound('Preset');
    const fields = presetSchema.safeParse({ ...request.body as object, id, createdAt: old.createdAt, updatedAt: now() });
    if (!fields.success) throw fields.error;
    await presets.save(fields.data);
    return fields.data;
  });
  app.delete('/api/presets/:id', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    if (!await presets.get(id)) throw notFound('Preset');
    const users = (await workflows.list()).filter(workflow =>
      workflow.nodes.some(node => node.type === 'llm' && node.config.presetId === id)).map(workflow => workflow.name);
    if (users.length) throw new HttpError(409, 'PRESET_IN_USE', 'Preset is used by workflows', users);
    await presets.delete(id);
    return reply.code(204).send();
  });
  app.get('/api/workflows', async () => workflows.list());
  app.post('/api/workflows', async (request, reply) => {
    const body = z.object({ name: z.string().trim().min(1) }).parse(request.body);
    const date = now();
    const workflow: Workflow = { id: randomUUID(), name: body.name, nodes: [], edges: [], createdAt: date, updatedAt: date };
    await workflows.save(workflow);
    return reply.code(201).send(workflow);
  });
  app.get('/api/workflows/:id', async request => {
    const workflow = await workflows.get(idParam.parse(request.params).id);
    if (!workflow) throw notFound('Workflow');
    return workflow;
  });
  app.put('/api/workflows/:id', async request => {
    const { id } = idParam.parse(request.params);
    const old = await workflows.get(id);
    if (!old) throw notFound('Workflow');
    const body = workflowSchema.pick({ name: true, nodes: true, edges: true }).parse(request.body);
    const workflow = { ...old, ...body, updatedAt: now() };
    await workflows.save(workflow);
    return workflow;
  });
  app.delete('/api/workflows/:id', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    if ((await sessions.list()).some(s => s.workflowId === id))
      throw new HttpError(409, 'WORKFLOW_IN_USE', 'Workflow is used by a session');
    await workflows.delete(id);
    return reply.code(204).send();
  });
  app.post('/api/workflows/:id/validate', async request => {
    const { id } = idParam.parse(request.params);
    const workflow = await workflows.get(id);
    if (!workflow) throw notFound('Workflow');
    const errors = await validateWorkflow(workflow, { presets });
    if (errors.length) throw new HttpError(422, 'WORKFLOW_INVALID', 'Invalid workflow', errors);
    return { valid: true, errors: [] };
  });

  app.get('/api/sessions', async () => (await sessions.list()).map(({ messages, ...session }) =>
    ({ ...session, messageCount: messages.length })));
  app.post('/api/sessions', async (request, reply) => {
    const body = z.object({ workflowId: z.string().uuid(), title: z.string().trim().min(1).optional(),
      characterId: z.string().uuid().optional(), personaId: z.string().uuid().optional() }).parse(request.body);
    if (!await workflows.get(body.workflowId)) throw notFound('Workflow');
    if (body.characterId && !await characters.get(body.characterId)) throw notFound('Character');
    if (body.personaId && !await personas.get(body.personaId)) throw notFound('Persona');
    const date = now();
    const session: Session = { id: randomUUID(), title: body.title ?? 'New chat', workflowId: body.workflowId,
      characterId: body.characterId, personaId: body.personaId, messages: [], createdAt: date, updatedAt: date };
    await sessions.save(session);
    return reply.code(201).send(session);
  });
  app.get('/api/sessions/:id', async request => {
    const session = await sessions.get(idParam.parse(request.params).id);
    if (!session) throw notFound('Session');
    return session;
  });
  app.patch('/api/sessions/:id', async request => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ title: z.string().trim().min(1).optional(), workflowId: z.string().uuid().optional(),
      characterId: z.string().uuid().nullable().optional(), personaId: z.string().uuid().nullable().optional() }).parse(request.body);
    const session = await sessions.update(id, async current => {
      if (body.workflowId && !await workflows.get(body.workflowId)) throw notFound('Workflow');
      if (body.characterId && !await characters.get(body.characterId)) throw notFound('Character');
      if (body.personaId && !await personas.get(body.personaId)) throw notFound('Persona');
      if (body.characterId === null) delete current.characterId;
      if (body.personaId === null) delete current.personaId;
      Object.assign(current, Object.fromEntries(Object.entries(body).filter(([, value]) => value !== null)), { updatedAt: now() });
      return current;
    });
    if (!session) throw notFound('Session');
    return session;
  });
  app.delete('/api/sessions/:id', async (request, reply) => {
    await sessions.delete(idParam.parse(request.params).id);
    return reply.code(204).send();
  });
  app.post('/api/sessions/:id/messages', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const { content } = z.object({ content: z.string().trim().min(1) }).parse(request.body);
    let result: { userMessage: Session['messages'][number]; assistantMessage: Session['messages'][number]; execution: ExecutionLog } | undefined;
    let failure: unknown;
    const session = await sessions.update(id, async current => {
      const workflow = await workflows.get(current.workflowId);
      if (!workflow) throw notFound('Workflow');
      const errors = await validateWorkflow(workflow, { presets });
      if (errors.length) throw new HttpError(400, 'WORKFLOW_INVALID', 'Invalid workflow', errors);
      const history = [...current.messages];
      const character = current.characterId ? await characters.get(current.characterId) : undefined;
      const persona = current.personaId ? await personas.get(current.personaId) : undefined;
      const userMessage = { id: randomUUID(), role: 'user' as const, content, createdAt: now() };
      current.messages.push(userMessage);
      current.updatedAt = now();
      await sessions.save(current);
      try {
        const { reply: text, execution } = await executeWorkflow(workflow, {
          message: content, sessionId: id, history, secrets, resources: { presets }, character, persona
        });
        const assistantMessage = { id: randomUUID(), role: 'assistant' as const, content: text,
          createdAt: now(), executionId: execution.id };
        current.messages.push(assistantMessage);
        current.updatedAt = now();
        await executions.save(execution);
        result = { userMessage, assistantMessage, execution };
      } catch (error) {
        if (error instanceof ExecutionFailure) {
          await executions.save(error.execution);
          const failedId = /^Node ([^ ]+) \(/.exec(error.message)?.[1];
          const failedNode = workflow.nodes.find(node => node.id === failedId);
          const label = failedNode && registry.get(failedNode.type)?.label;
          const message = label && failedId
            ? `${label} (${failedId}): ${error.execution.nodes[failedId]?.error ?? error.message}` : error.message;
          failure = new HttpError(500, 'WORKFLOW_EXECUTION_FAILED', message, {
            execution: error.execution, userMessage
          });
        } else failure = error;
      }
      return current;
    });
    if (!session) throw notFound('Session');
    if (failure) throw failure;
    return reply.send(result);
  });
  app.get('/api/executions/:id', async request => {
    const execution = await executions.get(idParam.parse(request.params).id);
    if (!execution) throw notFound('Execution');
    return execution;
  });
  app.get('/api/secrets', async () => secrets.list());
  app.put('/api/secrets/:name', async (request, reply) => {
    const { name } = nameParam.parse(request.params);
    const { value } = z.object({ value: z.string().min(1) }).parse(request.body);
    await secrets.set(name, value);
    return reply.code(204).send();
  });
  app.delete('/api/secrets/:name', async (request, reply) => {
    await secrets.delete(nameParam.parse(request.params).name);
    return reply.code(204).send();
  });
  app.setNotFoundHandler(() => { throw notFound('Route'); });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request',
        details: error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })) } });
    }
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({ error: {
        code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details })
      } });
    }
    const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error ? error.statusCode : undefined;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({ error: {
        code: typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
          ? error.code : 'BAD_REQUEST',
        message: errorMessage(error)
      } });
    }
    console.error(`Unexpected API error on ${request.method} ${request.url}:`, error);
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });
  return app;
}

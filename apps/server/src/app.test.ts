import { afterEach, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createApp } from './app.js';
import { placeholderPng, writePngCard } from './card.js';
import {
  apiContract,
  errorEnvelopeSchema,
  forkPoints,
  type ApiEndpoint,
  type ApiResponse,
  type Character,
  type Persona,
} from '@st/shared';
import type { InjectOptions } from 'fastify';
import { isSink, registry } from '@st/engine';
import { chatResponse, restoreAdapter, useAdapter } from './test-support/adapter.js';
import { parseEventStream } from './test-support/event-stream.js';

const directories: string[] = [];
afterEach(async () => {
  restoreAdapter();
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
it('returns payloads conforming to every shared endpoint response contract', async () => {
  const directory = join(process.cwd(), '.test-data', `test-${randomUUID()}`);
  directories.push(directory);
  const app = await createApp(directory, { seed: false });
  const covered = new Set<ApiEndpoint>();
  const request = async <K extends ApiEndpoint>(key: K, options: InjectOptions): Promise<ApiResponse<K>> => {
    const response = await app.inject(options);
    expect(response.statusCode, `${key}: ${response.body}`).toBeGreaterThanOrEqual(200);
    expect(response.statusCode, `${key}: ${response.body}`).toBeLessThan(300);
    const payload =
      response.statusCode === 204
        ? undefined
        : String(response.headers['content-type']).includes('application/json')
          ? response.json()
          : response.rawPayload;
    covered.add(key);
    return apiContract[key].response.parse(payload) as ApiResponse<K>;
  };
  try {
    const nodeTypes = await request('listNodeTypes', { method: 'GET', url: '/api/node-types' });
    expect(
      nodeTypes
        .filter((descriptor) => descriptor.dynamicPorts)
        .map((descriptor) => descriptor.type)
        .sort(),
    ).toEqual(['character', 'llm', 'next-chunk', 'parse-json', 'random', 'state-read', 'state-write', 'trigger']);
    for (const descriptor of nodeTypes) {
      expect(descriptor.dynamicPorts).toBe(!!registry.get(descriptor.type)?.resolvePorts);
      // A sink that depends on its config is described with the node's default config.
      const definition = registry.get(descriptor.type)!;
      expect(descriptor.sink).toBe(isSink(definition, definition.defaultConfig));
    }
    expect(nodeTypes.find((descriptor) => descriptor.type === 'llm')?.sink).toBe(false);
    expect(nodeTypes.find((descriptor) => descriptor.type === 'chat-output')?.sink).toBe(true);
    expect(nodeTypes.find((descriptor) => descriptor.type === 'state-write')?.sink).toBe(true);
    const builtIn = await request('listProviders', { method: 'GET', url: '/api/providers' });
    expect(builtIn.map((provider) => [provider.id, provider.builtIn])).toEqual([
      ['openrouter', true],
      ['abliteration', true],
    ]);
    const provider = await request('createProvider', {
      method: 'POST',
      url: '/api/providers',
      payload: { name: 'Contract provider', baseUrl: 'https://api.example.com/v1' },
    });
    await request('getProvider', { method: 'GET', url: `/api/providers/${provider.id}` });
    useAdapter({
      chat: async () => chatResponse(''),
      listModels: async () => [{ id: 'model-a', contextLength: 8192 }],
    });
    const catalog = await request('listProviderModels', { method: 'GET', url: `/api/providers/${provider.id}/models` });
    expect(catalog.models).toEqual([{ id: 'model-a', contextLength: 8192 }]);
    await request('updateProvider', {
      method: 'PUT',
      url: `/api/providers/${provider.id}`,
      payload: { name: 'Contract provider', baseUrl: 'https://api.example.com/v1', secret: 'example' },
    });
    const copy = await request('duplicateProvider', { method: 'POST', url: '/api/providers/openrouter/duplicate' });
    expect(copy).toMatchObject({ name: 'OpenRouter (copy)', builtIn: false, secret: 'openrouter' });
    await request('deleteProvider', { method: 'DELETE', url: `/api/providers/${copy.id}` });
    await request('deleteProvider', { method: 'DELETE', url: `/api/providers/${provider.id}` });
    const collection = await request('createCollection', {
      method: 'POST',
      url: '/api/collections',
      payload: { name: 'Contract lore', entries: [{ text: 'The Salt Inn', keywords: ['inn'] }] },
    });
    await request('getCollection', { method: 'GET', url: `/api/collections/${collection.id}` });
    const summaries = await request('listCollections', { method: 'GET', url: '/api/collections' });
    expect(summaries.map((summary) => summary.entryCount)).toEqual([1]);
    await request('updateCollection', {
      method: 'PUT',
      url: `/api/collections/${collection.id}`,
      payload: { name: 'Contract lore', entries: [] },
    });
    await request('deleteCollection', { method: 'DELETE', url: `/api/collections/${collection.id}` });
    const definition = await request('createStateDefinition', {
      method: 'POST',
      url: '/api/state-definitions',
      payload: { name: 'contract', keys: { tension: { type: 'number', min: 0, max: 10 } } },
    });
    await request('getStateDefinition', { method: 'GET', url: `/api/state-definitions/${definition.id}` });
    const definitions = await request('listStateDefinitions', { method: 'GET', url: '/api/state-definitions' });
    expect(definitions.map((entry) => entry.name)).toEqual(['contract']);
    await request('updateStateDefinition', {
      method: 'PUT',
      url: `/api/state-definitions/${definition.id}`,
      payload: { name: 'contract', keys: { mood: { type: 'enum', options: ['calm'] } } },
    });
    await request('deleteStateDefinition', { method: 'DELETE', url: `/api/state-definitions/${definition.id}` });
    const workflow = await request('createWorkflow', {
      method: 'POST',
      url: '/api/workflows',
      payload: { name: 'Contract echo' },
    });
    await request('updateWorkflow', {
      method: 'PUT',
      url: `/api/workflows/${workflow.id}`,
      payload: {
        name: 'Contract echo',
        nodes: [
          { id: 'input', type: 'chat-input', config: {}, position: { x: 0, y: 0 } },
          { id: 'output', type: 'chat-output', config: {}, position: { x: 100, y: 0 } },
        ],
        edges: [{ id: 'reply', source: 'input', sourceHandle: 'message', target: 'output', targetHandle: 'value' }],
      },
    });
    await request('getWorkflow', { method: 'GET', url: `/api/workflows/${workflow.id}` });
    await request('listWorkflows', { method: 'GET', url: '/api/workflows' });
    await request('validateWorkflow', { method: 'POST', url: `/api/workflows/${workflow.id}/validate` });
    const preset = await request('createPreset', {
      method: 'POST',
      url: '/api/presets',
      payload: { name: 'Contract preset', inputs: [], entries: [] },
    });
    await request('updatePreset', { method: 'PUT', url: `/api/presets/${preset.id}`, payload: preset });
    await request('getPreset', { method: 'GET', url: `/api/presets/${preset.id}` });
    await request('listPresets', { method: 'GET', url: '/api/presets' });
    await request('resolvePorts', {
      method: 'POST',
      url: '/api/node-types/llm/ports',
      payload: { config: { presetId: preset.id } },
    });
    const character = await request('createCharacter', {
      method: 'POST',
      url: '/api/characters',
      payload: { name: 'Contract character' },
    });
    await request('updateCharacter', { method: 'PUT', url: `/api/characters/${character.id}`, payload: character });
    await request('getCharacter', { method: 'GET', url: `/api/characters/${character.id}` });
    await request('listCharacters', { method: 'GET', url: '/api/characters' });
    const persona = await request('createPersona', {
      method: 'POST',
      url: '/api/personas',
      payload: { name: 'Contract persona' },
    });
    await request('updatePersona', { method: 'PUT', url: `/api/personas/${persona.id}`, payload: persona });
    await request('getPersona', { method: 'GET', url: `/api/personas/${persona.id}` });
    await request('listPersonas', { method: 'GET', url: '/api/personas' });
    for (const [resource, id, updateKey, getKey] of [
      ['characters', character.id, 'updateCharacterAvatar', 'getCharacterAvatar'],
      ['personas', persona.id, 'updatePersonaAvatar', 'getPersonaAvatar'],
    ] as const) {
      await request(updateKey, {
        method: 'PUT',
        url: `/api/${resource}/${id}/avatar`,
        headers: { 'content-type': 'image/png' },
        payload: placeholderPng(),
      });
      await request(getKey, { method: 'GET', url: `/api/${resource}/${id}/avatar` });
    }
    await request('exportCharacter', { method: 'GET', url: `/api/characters/${character.id}/export?format=json` });
    await request('exportCharacter', { method: 'GET', url: `/api/characters/${character.id}/export?format=png` });
    const cards = multipart([
      { filename: 'card.json', mime: 'application/json', data: Buffer.from('{"name":"Imported"}') },
    ]);
    await request('importCharacters', {
      method: 'POST',
      url: '/api/characters/import',
      payload: cards.payload,
      headers: { 'content-type': `multipart/form-data; boundary=${cards.boundary}` },
    });
    const images = multipart([{ filename: 'persona.png', mime: 'image/png', data: placeholderPng() }]);
    await request('importPersonas', {
      method: 'POST',
      url: '/api/personas/import',
      payload: images.payload,
      headers: { 'content-type': `multipart/form-data; boundary=${images.boundary}` },
    });
    const session = await request('createSession', {
      method: 'POST',
      url: '/api/sessions',
      payload: { workflowId: workflow.id, characterId: character.id, personaId: persona.id },
    });
    await request('updateSession', {
      method: 'PATCH',
      url: `/api/sessions/${session.id}`,
      payload: { title: 'Contract chat' },
    });
    const message = await request('sendMessage', {
      method: 'POST',
      url: `/api/sessions/${session.id}/messages`,
      payload: { content: 'Contract reply' },
    });
    expect(message.assistantMessages[0]?.content).toBe('Contract reply');
    const sessions = await request('listSessions', { method: 'GET', url: '/api/sessions' });
    expect(sessions[0]?.messageCount).toBe(2);
    await request('getSession', { method: 'GET', url: `/api/sessions/${session.id}` });
    const story = await request('getSessionState', { method: 'GET', url: `/api/sessions/${session.id}/state` });
    expect(story.turn).toBe(2);
    expect(story.turns.map((entry) => entry.turnNumber)).toEqual([1]);
    await request('getExecution', { method: 'GET', url: `/api/executions/${message.execution!.id}` });
    const streamed = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/messages/stream`,
      payload: { content: 'Contract stream' },
    });
    expect(streamed.statusCode).toBe(200);
    expect(streamed.headers['content-type']).toContain('text/event-stream');
    const turnEvents = parseEventStream(streamed.body).map(({ event, data }) => {
      expect(event).toBe(data.type);
      return apiContract.streamTurn.response.parse(data);
    });
    covered.add('streamTurn');
    // The long-lived event stream cannot be driven through inject; change-events.test.ts parses it with the contract.
    covered.add('streamChanges');
    expect(turnEvents.at(-1)).toMatchObject({
      type: 'turn.complete',
      assistantMessages: [{ content: 'Contract stream' }],
    });
    // The last turn again (plain and streamed), then a swipe back to the first alternative.
    const regenerated = await request('regenerate', { method: 'POST', url: `/api/sessions/${session.id}/regenerate` });
    expect(regenerated.userMessage).toBeUndefined();
    expect(regenerated.assistantMessages[0]?.content).toBe('Contract stream');
    const regenStream = await app.inject({ method: 'POST', url: `/api/sessions/${session.id}/regenerate/stream` });
    expect(regenStream.statusCode).toBe(200);
    for (const { data } of parseEventStream(regenStream.body)) apiContract.streamRegenerate.response.parse(data);
    covered.add('streamRegenerate');
    const swiped = await request('setAlternative', {
      method: 'PATCH',
      url: `/api/sessions/${session.id}/alternative`,
      payload: { executionId: regenerated.execution!.id },
    });
    expect(swiped.messages.filter((item) => item.inactive).length).toBe(2);
    // A fork after the shown reply, and the app-wide preference that decides whether it keeps the alternatives.
    const forkPoint = forkPoints(swiped.messages).at(-1)!;
    const forked = await request('forkSession', {
      method: 'POST',
      url: `/api/sessions/${session.id}/fork`,
      payload: { messageId: forkPoint },
    });
    expect(forked.forkedFrom).toEqual({ sessionId: session.id, messageId: forkPoint });
    await request('getAppSettings', { method: 'GET', url: '/api/app-settings' });
    const settings = await request('updateAppSettings', {
      method: 'PATCH',
      url: '/api/app-settings',
      payload: { forkKeepsAlternatives: false },
    });
    expect(settings.forkKeepsAlternatives).toBe(false);
    await request('stopTurn', { method: 'POST', url: `/api/sessions/${session.id}/stop` });
    await request('updateMessage', {
      method: 'PATCH',
      url: `/api/sessions/${session.id}/messages/${message.userMessage!.id}`,
      payload: { content: 'Edited reply' },
    });
    await request('deleteMessage', {
      method: 'DELETE',
      url: `/api/sessions/${session.id}/messages/${message.userMessage!.id}`,
    });
    await request('previewPreset', {
      method: 'POST',
      url: '/api/presets/preview',
      payload: { preset, sessionId: session.id },
    });
    await request('setSecret', { method: 'PUT', url: '/api/secrets/contract', payload: { value: 'secret-value' } });
    await request('listSecrets', { method: 'GET', url: '/api/secrets' });
    await request('deleteSecret', { method: 'DELETE', url: '/api/secrets/contract' });
    await request('deleteSession', { method: 'DELETE', url: `/api/sessions/${session.id}` });
    await request('deleteSession', { method: 'DELETE', url: `/api/sessions/${forked.id}` });
    await request('deleteWorkflow', { method: 'DELETE', url: `/api/workflows/${workflow.id}` });
    await request('deletePreset', { method: 'DELETE', url: `/api/presets/${preset.id}` });
    await request('deleteCharacter', { method: 'DELETE', url: `/api/characters/${character.id}` });
    await request('deletePersona', { method: 'DELETE', url: `/api/personas/${persona.id}` });
    const install = join(process.cwd(), '.test-data', `install-${randomUUID()}`);
    directories.push(install);
    await mkdir(join(install, 'data', 'default-user', 'OpenAI Settings'), { recursive: true });
    await writeFile(
      join(install, 'data', 'default-user', 'OpenAI Settings', 'Contract.json'),
      JSON.stringify({
        prompts: [{ identifier: 'main', name: 'Main', role: 'system', content: 'Hi' }],
        prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
      }),
    );
    await request('listImportSources', { method: 'GET', url: '/api/import-sources' });
    await request('setImportSource', {
      method: 'PUT',
      url: '/api/import-sources/sillytavern',
      payload: { path: install },
    });
    await request('syncImportSource', { method: 'POST', url: '/api/import-sources/sillytavern/sync' });
    expect([...covered].sort()).toEqual(Object.keys(apiContract).sort());
    for (const options of [
      { method: 'GET', url: `/api/sessions/${randomUUID()}` },
      { method: 'POST', url: '/api/sessions', payload: {} },
    ] as const) {
      const response = await app.inject(options);
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      errorEnvelopeSchema.parse(response.json());
    }
  } finally {
    await app.close();
  }
});
it('supports workflow CRUD, secrets masking, and a chat execution through inject', async () => {
  const directory = join(process.cwd(), '.test-data', `test-${randomUUID()}`);
  directories.push(directory);
  const app = await createApp(directory, { seed: false });
  try {
    const types = (await app.inject({ method: 'GET', url: '/api/node-types' })).json();
    expect(types.find((type: { type: string }) => type.type === 'llm')).toMatchObject({
      inputs: [{ name: 'character', label: 'Character', dataType: 'character' }],
      outputs: expect.arrayContaining([{ name: 'text', label: 'Text', dataType: 'text' }]),
    });
    const create = await app.inject({ method: 'POST', url: '/api/workflows', payload: { name: 'Echo' } });
    expect(create.statusCode).toBe(201);
    const workflow = create.json();
    const nodes = [
      { id: 'input', type: 'chat-input', config: {}, position: { x: 0, y: 0 } },
      {
        id: 'condition',
        type: 'condition',
        config: { left: '{{input.value}}', right: 'hi', operator: 'equals' },
        position: { x: 100, y: 0 },
      },
      { id: 'merge', type: 'merge', config: { mode: 'first-non-empty' }, position: { x: 200, y: 0 } },
      { id: 'output', type: 'chat-output', config: { template: '' }, position: { x: 300, y: 0 } },
    ];
    const edges = [
      ['input', 'message', 'condition', 'value'],
      ['condition', 'true', 'merge', 'a'],
      ['condition', 'false', 'merge', 'b'],
      ['merge', 'value', 'output', 'value'],
    ].map(([source, sourceHandle, target, targetHandle], id) => ({
      id: String(id),
      source,
      sourceHandle,
      target,
      targetHandle,
    }));
    const update = await app.inject({
      method: 'PUT',
      url: `/api/workflows/${workflow.id}`,
      payload: { name: 'Echo', nodes, edges },
    });
    expect(update.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/workflows' })).json()).toHaveLength(1);
    expect((await app.inject({ method: 'POST', url: `/api/workflows/${workflow.id}/validate` })).json().valid).toBe(
      true,
    );
    const emptyValidation = await app.inject({
      method: 'POST',
      url: `/api/workflows/${workflow.id}/validate`,
      headers: { 'content-type': 'application/json' },
      payload: '',
    });
    expect(emptyValidation.statusCode).toBe(200);
    expect(emptyValidation.json().valid).toBe(true);
    const emptyDelete = await app.inject({
      method: 'DELETE',
      url: '/api/secrets/nonexistent',
      headers: { 'content-type': 'application/json' },
      payload: '',
    });
    expect(emptyDelete.statusCode).toBe(204);
    const malformed = await app.inject({
      method: 'POST',
      url: `/api/workflows/${workflow.id}/validate`,
      headers: { 'content-type': 'application/json' },
      payload: '{',
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error).toMatchObject({ code: expect.any(String), message: expect.any(String) });
    const notFound = await app.inject({ method: 'GET', url: `/api/workflows/${randomUUID()}` });
    expect(notFound.statusCode).toBe(404);
    expect(notFound.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Workflow not found' } });
    const missingRoute = await app.inject({ method: 'GET', url: '/api/not-a-route' });
    expect(missingRoute.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
    const invalidBody = await app.inject({ method: 'POST', url: '/api/workflows', payload: {} });
    expect(invalidBody.statusCode).toBe(400);
    expect(invalidBody.json().error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Invalid request',
      details: [{ path: 'name', message: expect.any(String) }],
    });
    const created = (
      await app.inject({ method: 'POST', url: '/api/sessions', payload: { workflowId: workflow.id } })
    ).json();
    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${created.id}/messages`,
      payload: { content: 'hi' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().assistantMessages[0]?.content).toBe('hi');
    const executionId = response.json().execution.id;
    expect((await app.inject({ method: 'GET', url: `/api/executions/${executionId}` })).json().status).toBe(
      'completed',
    );
    await app.inject({
      method: 'PUT',
      url: `/api/workflows/${workflow.id}`,
      payload: { name: 'Empty', nodes: [], edges: [] },
    });
    const invalidValidation = await app.inject({ method: 'POST', url: `/api/workflows/${workflow.id}/validate` });
    expect(invalidValidation.statusCode).toBe(422);
    expect(invalidValidation.json().error).toMatchObject({
      code: 'WORKFLOW_INVALID',
      message: 'Workflow "Empty" is invalid',
      details: {
        workflowId: workflow.id,
        workflowName: 'Empty',
        issues: expect.arrayContaining([
          expect.objectContaining({ message: expect.stringContaining('at least one node that writes') }),
        ]),
      },
    });
    const invalidGraph = await app.inject({
      method: 'POST',
      url: `/api/sessions/${created.id}/messages`,
      payload: { content: 'hi' },
    });
    expect(invalidGraph.statusCode).toBe(400);
    expect(invalidGraph.json().error).toMatchObject({
      code: 'WORKFLOW_INVALID',
      message: 'Workflow "Empty" is invalid',
      details: {
        workflowId: workflow.id,
        workflowName: 'Empty',
        issues: expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining('chat-input') })]),
      },
    });
    const preset = (
      await app.inject({
        method: 'POST',
        url: '/api/presets',
        payload: {
          name: 'Test',
          inputs: [{ id: 'message-input', key: 'message', label: 'Message', dataType: 'text' }],
          entries: [{ kind: 'slot', id: 'message-slot', displayName: 'Message', enabled: true, inputKey: 'message' }],
        },
      })
    ).json();
    await app.inject({
      method: 'PUT',
      url: `/api/workflows/${workflow.id}`,
      payload: {
        name: 'LLM',
        nodes: [
          nodes[0],
          { id: 'llm', type: 'llm', config: { presetId: preset.id }, position: { x: 100, y: 0 } },
          nodes[3],
        ],
        edges: [
          { id: 'prompt', source: 'input', sourceHandle: 'message', target: 'llm', targetHandle: 'message' },
          { id: 'reply', source: 'llm', sourceHandle: 'text', target: 'output', targetHandle: 'value' },
        ],
      },
    });
    const missingSecret = await app.inject({
      method: 'POST',
      url: `/api/sessions/${created.id}/messages`,
      payload: { content: 'hi' },
    });
    expect(missingSecret.statusCode).toBe(500);
    expect(missingSecret.json().error).toMatchObject({
      code: 'WORKFLOW_EXECUTION_FAILED',
      message: expect.stringContaining('LLM (llm): Missing openrouter secret'),
      details: { execution: { status: 'error' }, userMessage: { content: 'hi' } },
    });
    await app.inject({ method: 'PUT', url: '/api/secrets/openrouter', payload: { value: 'sk-test-secret123' } });
    const list = (await app.inject({ method: 'GET', url: '/api/secrets' })).json();
    expect(list[0].hint).toContain('…');
    expect(JSON.stringify(list)).not.toContain('sk-test-secret123');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'rate limited upstream' } }), { status: 429 }),
    );
    const upstream = await app.inject({
      method: 'POST',
      url: `/api/sessions/${created.id}/messages`,
      payload: { content: 'again' },
    });
    expect(upstream.json().error.message).toContain('OpenRouter 429: rate limited upstream');
    expect((await app.inject({ method: 'DELETE', url: `/api/workflows/${workflow.id}` })).statusCode).toBe(409);
    expect((await app.inject({ method: 'DELETE', url: `/api/sessions/${created.id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `/api/workflows/${workflow.id}` })).statusCode).toBe(204);
  } finally {
    await app.close();
  }
});
it('prunes orphaned preset-input edges when a preset is updated', async () => {
  const directory = join(process.cwd(), '.test-data', `test-${randomUUID()}`);
  directories.push(directory);
  const app = await createApp(directory, { seed: false });
  try {
    const preset = (
      await app.inject({
        method: 'POST',
        url: '/api/presets',
        payload: {
          name: 'Dynamic',
          inputs: [
            { id: 'message-input', key: 'message', label: 'Message', dataType: 'text' },
            { id: 'extra-input', key: 'extra', label: 'Extra', dataType: 'text' },
          ],
          entries: [
            { id: 'message-slot', displayName: 'Message', enabled: true, kind: 'slot', inputKey: 'message' },
            { id: 'extra-slot', displayName: 'Extra', enabled: true, kind: 'slot', inputKey: 'extra' },
          ],
        },
      })
    ).json();
    const workflow = (
      await app.inject({ method: 'POST', url: '/api/workflows', payload: { name: 'Preset workflow' } })
    ).json();
    const put = await app.inject({
      method: 'PUT',
      url: `/api/workflows/${workflow.id}`,
      payload: {
        name: 'Preset workflow',
        nodes: [
          { id: 'input', type: 'chat-input', config: {}, position: { x: 0, y: 0 } },
          { id: 'llm', type: 'llm', config: { presetId: preset.id }, position: { x: 100, y: 0 } },
          { id: 'output', type: 'chat-output', config: {}, position: { x: 200, y: 0 } },
        ],
        edges: [
          { id: 'prompt', source: 'input', sourceHandle: 'message', target: 'llm', targetHandle: 'message' },
          { id: 'extra', source: 'input', sourceHandle: 'message', target: 'llm', targetHandle: 'extra' },
          { id: 'reply', source: 'llm', sourceHandle: 'text', target: 'output', targetHandle: 'value' },
        ],
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().edges.map((edge: { id: string }) => edge.id)).toEqual(['prompt', 'extra', 'reply']);
    const updated = await app.inject({
      method: 'PUT',
      url: `/api/presets/${preset.id}`,
      payload: {
        name: 'Dynamic',
        inputs: [{ id: 'message-input', key: 'message', label: 'Message', dataType: 'text' }],
        entries: [{ id: 'message-slot', displayName: 'Message', enabled: true, kind: 'slot', inputKey: 'message' }],
      },
    });
    expect(updated.statusCode).toBe(200);
    const after = (await app.inject({ method: 'GET', url: `/api/workflows/${workflow.id}` })).json();
    expect(after.edges.map((edge: { id: string }) => edge.id)).toEqual(['prompt', 'reply']);
  } finally {
    await app.close();
  }
});
it('hides unexpected error stacks and logs them server-side', async () => {
  const directory = join(process.cwd(), '.test-data', `test-${randomUUID()}`);
  directories.push(directory);
  const app = await createApp(directory, { seed: false });
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  app.get('/api/boom', async () => {
    throw new Error('sensitive internal details');
  });
  try {
    const response = await app.inject({ method: 'GET', url: '/api/boom' });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
    expect(response.body).not.toContain('sensitive internal details');
    expect(log).toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
it('serializes same-session message exchanges and merges concurrent session patches', async () => {
  const directory = join(process.cwd(), '.test-data', `test-${randomUUID()}`);
  directories.push(directory);
  const histories: string[][] = [];
  let activeExecutions = 0;
  let maxConcurrentExecutions = 0;
  let waitForPair = false;
  let pairCount = 0;
  let releasePair!: () => void;
  const pairStarted = new Promise<void>((resolve) => {
    releasePair = resolve;
  });
  let releasePatchExecution!: () => void;
  const patchExecutionGate = new Promise<void>((resolve) => {
    releasePatchExecution = resolve;
  });
  let announcePatchExecution!: () => void;
  const patchExecutionStarted = new Promise<void>((resolve) => {
    announcePatchExecution = resolve;
  });
  registry.set('slow-echo-test', {
    type: 'slow-echo-test',
    label: 'Slow echo',
    description: '',
    category: 'Tests',
    inputs: [
      { name: 'message', label: 'Message', dataType: 'any' },
      { name: 'history', label: 'History', dataType: 'any' },
    ],
    outputs: [{ name: 'reply', label: 'Reply', dataType: 'text' }],
    configSchema: z.object({}),
    defaultConfig: {},
    async execute({ inputs, history }) {
      histories.push(history.map((message) => `${message.role}:${message.content}`));
      activeExecutions++;
      maxConcurrentExecutions = Math.max(maxConcurrentExecutions, activeExecutions);
      try {
        if (inputs.message === 'patch-race') {
          announcePatchExecution();
          await patchExecutionGate;
        } else if (waitForPair) {
          pairCount++;
          if (pairCount === 2) releasePair();
          await Promise.race([pairStarted, new Promise((resolve) => setTimeout(resolve, 1000))]);
        } else await new Promise((resolve) => setTimeout(resolve, 30));
        return { reply: `reply ${String(inputs.message)}` };
      } finally {
        activeExecutions--;
      }
    },
  });
  const app = await createApp(directory, { seed: false });
  try {
    const workflow = (
      await app.inject({ method: 'POST', url: '/api/workflows', payload: { name: 'Slow echo' } })
    ).json();
    const saved = await app.inject({
      method: 'PUT',
      url: `/api/workflows/${workflow.id}`,
      payload: {
        name: 'Slow echo',
        nodes: [
          { id: 'input', type: 'chat-input', config: {}, position: { x: 0, y: 0 } },
          { id: 'echo', type: 'slow-echo-test', config: {}, position: { x: 100, y: 0 } },
          { id: 'output', type: 'chat-output', config: {}, position: { x: 200, y: 0 } },
        ],
        edges: [
          { id: 'message', source: 'input', sourceHandle: 'message', target: 'echo', targetHandle: 'message' },
          { id: 'history', source: 'input', sourceHandle: 'history', target: 'echo', targetHandle: 'history' },
          { id: 'reply', source: 'echo', sourceHandle: 'reply', target: 'output', targetHandle: 'value' },
        ],
      },
    });
    expect(saved.statusCode).toBe(200);
    const character = (
      await app.inject({ method: 'POST', url: '/api/characters', payload: { name: 'Patch target' } })
    ).json();
    const session = (
      await app.inject({ method: 'POST', url: '/api/sessions', payload: { workflowId: workflow.id } })
    ).json();
    const [first, second] = await Promise.all(
      ['first', 'second'].map((content) =>
        app.inject({ method: 'POST', url: `/api/sessions/${session.id}/messages`, payload: { content } }),
      ),
    );
    expect(first!.statusCode).toBe(200);
    expect(second!.statusCode).toBe(200);
    expect(histories).toEqual([[], ['user:first', 'assistant:reply first']]);
    expect(
      (await app.inject({ method: 'GET', url: `/api/sessions/${session.id}` }))
        .json()
        .messages.map((message: { role: string; content: string }) => `${message.role}:${message.content}`),
    ).toEqual(['user:first', 'assistant:reply first', 'user:second', 'assistant:reply second']);

    const sessionTwo = (
      await app.inject({ method: 'POST', url: '/api/sessions', payload: { workflowId: workflow.id } })
    ).json();
    waitForPair = true;
    const crossSession = await Promise.all([
      app.inject({ method: 'POST', url: `/api/sessions/${session.id}/messages`, payload: { content: 'parallel one' } }),
      app.inject({
        method: 'POST',
        url: `/api/sessions/${sessionTwo.id}/messages`,
        payload: { content: 'parallel two' },
      }),
    ]);
    expect(crossSession.map((response) => response.statusCode)).toEqual([200, 200]);
    expect(pairCount).toBe(2);
    expect(maxConcurrentExecutions).toBe(2);

    const inFlightMessage = app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/messages`,
      payload: { content: 'patch-race' },
    });
    await patchExecutionStarted;
    // The engine runs outside the session lock, so a patch during execution is not held back by it.
    const inFlightPatch = await app.inject({
      method: 'PATCH',
      url: `/api/sessions/${session.id}`,
      payload: { title: 'Patched during execution' },
    });
    expect(inFlightPatch.statusCode).toBe(200);
    releasePatchExecution();
    expect((await inFlightMessage).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/sessions/${session.id}` })).json()).toMatchObject({
      title: 'Patched during execution',
    });

    const [titlePatch, characterPatch] = await Promise.all([
      app.inject({ method: 'PATCH', url: `/api/sessions/${session.id}`, payload: { title: 'Updated title' } }),
      app.inject({ method: 'PATCH', url: `/api/sessions/${session.id}`, payload: { characterId: character.id } }),
    ]);
    expect(titlePatch.statusCode).toBe(200);
    expect(characterPatch.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/sessions/${session.id}` })).json()).toMatchObject({
      title: 'Updated title',
      characterId: character.id,
      messages: expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: 'patch-race' }),
        expect.objectContaining({ role: 'assistant', content: 'reply patch-race' }),
      ]),
    });
  } finally {
    registry.delete('slow-echo-test');
    await app.close();
  }
});
it('supports presets CRUD, preview with a session, dynamic ports, and deletion conflicts', async () => {
  const directory = join(process.cwd(), '.test-data', `test-${randomUUID()}`);
  directories.push(directory);
  const app = await createApp(directory, { seed: false });
  try {
    const created = await app.inject({
      method: 'POST',
      url: '/api/presets',
      payload: {
        name: 'Demo',
        inputs: [
          { id: 'history-input', key: 'history', label: 'Chat history', dataType: 'messages' },
          { id: 'message-input', key: 'message', label: 'User message', dataType: 'text' },
        ],
        entries: [
          {
            id: 'system',
            kind: 'message',
            displayName: 'System',
            enabled: true,
            role: 'system',
            content: '{{trigger.message}}',
          },
          { id: 'history', kind: 'slot', displayName: 'History', enabled: true, inputKey: 'history' },
          { id: 'message', kind: 'slot', displayName: 'Message', enabled: true, inputKey: 'message' },
        ],
      },
    });
    expect(created.statusCode).toBe(201);
    const preset = created.json();
    expect((await app.inject({ method: 'GET', url: '/api/presets' })).json()).toHaveLength(1);
    const draft = {
      ...preset,
      entries: [
        ...preset.entries,
        {
          id: 'note',
          kind: 'message',
          displayName: 'Note',
          enabled: true,
          role: 'system',
          content: 'Last',
          placement: { mode: 'depth', entryId: 'history', depth: 0 },
        },
      ],
    };
    const updated = await app.inject({ method: 'PUT', url: `/api/presets/${preset.id}`, payload: draft });
    expect(updated.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/presets/${preset.id}` })).json().entries).toHaveLength(4);
    const preview = await app.inject({
      method: 'POST',
      url: '/api/presets/preview',
      payload: { preset: draft, inputs: { message: 'Example' } },
    });
    expect(preview.json().warnings).toEqual([]);
    expect(preview.json().messages.map((message: { content: string }) => message.content)).toEqual([
      'Sample message',
      'Hello!',
      'Hi! How can I help?',
      'Last',
      'Example',
    ]);
    const workflow = (
      await app.inject({ method: 'POST', url: '/api/workflows', payload: { name: 'Using demo' } })
    ).json();
    await app.inject({
      method: 'PUT',
      url: `/api/workflows/${workflow.id}`,
      payload: {
        name: workflow.name,
        nodes: [
          { id: 'input', type: 'chat-input', config: {}, position: { x: 0, y: 0 } },
          { id: 'llm', type: 'llm', config: { presetId: preset.id }, position: { x: 0, y: 0 } },
          { id: 'output', type: 'chat-output', config: {}, position: { x: 0, y: 0 } },
        ],
        edges: [
          { id: 'prompt', source: 'input', sourceHandle: 'message', target: 'llm', targetHandle: 'message' },
          { id: 'reply', source: 'llm', sourceHandle: 'text', target: 'output', targetHandle: 'value' },
        ],
      },
    });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/node-types/llm/ports',
          payload: {
            config: { presetId: preset.id },
          },
        })
      )
        .json()
        .inputs.map((port: { name: string }) => port.name),
    ).toEqual(['character', 'history', 'message']);
    const session = (
      await app.inject({ method: 'POST', url: '/api/sessions', payload: { workflowId: workflow.id } })
    ).json();
    const withSession = await app.inject({
      method: 'POST',
      url: '/api/presets/preview',
      payload: {
        preset: draft,
        sessionId: session.id,
        inputs: { message: 'With session' },
      },
    });
    expect(withSession.json().messages.map((message: { content: string }) => message.content)).toEqual([
      'Sample message',
      'Last',
      'With session',
    ]);
    const warnedPreview = await app.inject({
      method: 'POST',
      url: '/api/presets/preview',
      payload: {
        preset: { ...draft, inputs: [...draft.inputs, { id: 'unused-input', key: 'unused', dataType: 'text' }] },
      },
    });
    expect(warnedPreview.json().warnings).toContainEqual({
      path: ['inputs', 2],
      message: 'Input "unused" is not used by an enabled entry.',
    });
    const removedInputDraft = {
      ...draft,
      inputs: draft.inputs.filter((input: { key: string }) => input.key !== 'message'),
      entries: draft.entries.filter(
        (entry: { kind: string; inputKey?: string }) => entry.kind !== 'slot' || entry.inputKey !== 'message',
      ),
    };
    expect(
      (await app.inject({ method: 'PUT', url: `/api/presets/${preset.id}`, payload: removedInputDraft })).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/node-types/llm/ports',
          payload: {
            config: { presetId: preset.id },
          },
        })
      )
        .json()
        .inputs.map((port: { name: string }) => port.name),
    ).toEqual(['character', 'history']);
    const staleInputValidation = await app.inject({ method: 'POST', url: `/api/workflows/${workflow.id}/validate` });
    expect(staleInputValidation.statusCode).toBe(200);
    expect(staleInputValidation.json()).toEqual({ valid: true, errors: [] });
    // Removing the preset input pruned the orphaned edge into it.
    expect(
      (await app.inject({ method: 'GET', url: `/api/workflows/${workflow.id}` }))
        .json()
        .edges.map((edge: { id: string }) => edge.id),
    ).toEqual(['reply']);
    const inUse = await app.inject({ method: 'DELETE', url: `/api/presets/${preset.id}` });
    expect(inUse.statusCode).toBe(409);
    expect(inUse.json().error).toEqual({
      code: 'PRESET_IN_USE',
      message: 'Preset is used by workflows',
      details: ['Using demo'],
    });
    await app.inject({ method: 'DELETE', url: `/api/sessions/${session.id}` });
    await app.inject({ method: 'DELETE', url: `/api/workflows/${workflow.id}` });
    expect((await app.inject({ method: 'DELETE', url: `/api/presets/${preset.id}` })).statusCode).toBe(204);
  } finally {
    await app.close();
  }
});
it('keeps one Default preset and both valid seed workflows across server restarts', async () => {
  const directory = join(process.cwd(), '.test-data', `test-${randomUUID()}`);
  directories.push(directory);
  const first = await createApp(directory);
  const presets = (await first.inject({ method: 'GET', url: '/api/presets' })).json();
  const workflows = (await first.inject({ method: 'GET', url: '/api/workflows' })).json();
  expect(presets.map((preset: { name: string }) => preset.name)).toEqual(['Default']);
  expect(workflows.map((workflow: { name: string }) => workflow.name).sort()).toEqual([
    'Default Assistant',
    'Parallel demo',
  ]);
  await first.close();
  const second = await createApp(directory);
  try {
    expect((await second.inject({ method: 'GET', url: '/api/presets' })).json()).toEqual(presets);
    expect((await second.inject({ method: 'GET', url: '/api/workflows' })).json()).toEqual(workflows);
    for (const workflow of workflows) {
      const response = await second.inject({ method: 'POST', url: `/api/workflows/${workflow.id}/validate` });
      expect(response.json()).toEqual({ valid: true, errors: [] });
    }
  } finally {
    await second.close();
  }
});

function multipart(files: { filename: string; mime: string; data: Buffer }[]) {
  const boundary = `test-${randomUUID()}`;
  const chunks: Buffer[] = [];
  for (const file of files) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${file.filename}"\r\nContent-Type: ${file.mime}\r\n\r\n`,
      ),
      file.data,
      Buffer.from('\r\n'),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { boundary, payload: Buffer.concat(chunks) };
}

it('supports character/persona CRUD, card import and export, avatars, and session context persistence', async () => {
  const directory = join(process.cwd(), '.test-data', `test-${randomUUID()}`);
  directories.push(directory);
  const app = await createApp(directory, { seed: false });
  try {
    const character = (
      await app.inject({ method: 'POST', url: '/api/characters', payload: { name: 'Test character' } })
    ).json();
    expect((await app.inject({ method: 'GET', url: '/api/characters' })).json()).toHaveLength(1);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/api/characters/${character.id}`,
          payload: {
            description: 'Updated',
            personality: 'curious',
          },
        })
      ).json(),
    ).toMatchObject({ description: 'Updated', personality: 'curious' });

    const plainPng = multipart([{ filename: 'plain.png', mime: 'image/png', data: placeholderPng() }]);
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/characters/import',
      headers: { 'content-type': `multipart/form-data; boundary=${plainPng.boundary}` },
      payload: plainPng.payload,
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error).toMatchObject({ code: 'INVALID_CARD' });

    const cardPng = writePngCard(
      placeholderPng(),
      JSON.stringify({ spec: 'chara_card_v2', data: { name: 'Imported V2', description: 'From png' } }),
      JSON.stringify({ spec: 'chara_card_v3', data: { name: 'Imported V3', description: 'From png' } }),
    );
    const importedPayload = multipart([
      {
        filename: 'character.json',
        mime: 'application/json',
        data: Buffer.from(JSON.stringify({ name: 'Imported JSON', description: 'From file' })),
      },
      { filename: 'card.png', mime: 'image/png', data: cardPng },
    ]);
    const importedResponse = await app.inject({
      method: 'POST',
      url: '/api/characters/import',
      headers: { 'content-type': `multipart/form-data; boundary=${importedPayload.boundary}` },
      payload: importedPayload.payload,
    });
    expect(importedResponse.statusCode).toBe(200);
    const imported = importedResponse.json();
    expect(imported.imported.map((item: Character) => item.name)).toEqual(['Imported JSON', 'Imported V3']);
    expect(imported.failed).toEqual([]);
    const exported = await app.inject({
      method: 'GET',
      url: `/api/characters/${imported.imported[1].id}/export?format=png`,
    });
    expect(exported.headers['content-type']).toContain('image/png');
    const roundTrip = multipart([{ filename: 'export.png', mime: 'image/png', data: exported.rawPayload }]);
    const roundTripResponse = await app.inject({
      method: 'POST',
      url: '/api/characters/import',
      headers: { 'content-type': `multipart/form-data; boundary=${roundTrip.boundary}` },
      payload: roundTrip.payload,
    });
    expect(roundTripResponse.json().imported[0]).toMatchObject({ name: 'Imported V3', description: 'From png' });
    expect(
      (await app.inject({ method: 'GET', url: `/api/characters/${imported.imported[1].id}/avatar` })).statusCode,
    ).toBe(200);

    const persona = (await app.inject({ method: 'POST', url: '/api/personas', payload: { name: 'Persona' } })).json();
    expect((await app.inject({ method: 'GET', url: '/api/personas' })).json()).toHaveLength(1);
    await app.inject({ method: 'PUT', url: `/api/personas/${persona.id}`, payload: { description: 'About me' } });
    const avatarUpload = multipart([{ filename: 'avatar.png', mime: 'image/png', data: placeholderPng() }]);
    const avatarResponse = await app.inject({
      method: 'PUT',
      url: `/api/personas/${persona.id}/avatar`,
      headers: { 'content-type': `multipart/form-data; boundary=${avatarUpload.boundary}` },
      payload: avatarUpload.payload,
    });
    expect(avatarResponse.json().avatar).toContain('.png');
    const personaImport = multipart([
      { filename: 'simple.png', mime: 'image/png', data: placeholderPng() },
      { filename: 'character-card.png', mime: 'image/png', data: cardPng },
    ]);
    const personaResult = await app.inject({
      method: 'POST',
      url: '/api/personas/import',
      headers: { 'content-type': `multipart/form-data; boundary=${personaImport.boundary}` },
      payload: personaImport.payload,
    });
    expect(personaResult.json().imported.map((item: Persona) => item.name)).toEqual(['simple', 'Imported V3']);

    const workflow = (await app.inject({ method: 'POST', url: '/api/workflows', payload: { name: 'Echo' } })).json();
    const session = (
      await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: {
          workflowId: workflow.id,
          characterId: character.id,
          personaId: persona.id,
        },
      })
    ).json();
    expect((await app.inject({ method: 'GET', url: `/api/sessions/${session.id}` })).json()).toMatchObject({
      characterId: character.id,
      personaId: persona.id,
    });
    await app.inject({
      method: 'PUT',
      url: `/api/workflows/${workflow.id}`,
      payload: {
        name: 'Context echo',
        nodes: [
          { id: 'input', type: 'chat-input', config: {}, position: { x: 0, y: 0 } },
          {
            id: 'output',
            type: 'chat-output',
            config: { template: '{{character.name}} meets {{persona.name}}' },
            position: { x: 200, y: 0 },
          },
        ],
        edges: [{ id: 'message', source: 'input', sourceHandle: 'message', target: 'output', targetHandle: 'value' }],
      },
    });
    const message = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/messages`,
      payload: { content: 'Hi' },
    });
    expect(message.json().assistantMessages[0]?.content).toBe('Test character meets Persona');
    const changed = await app.inject({
      method: 'PATCH',
      url: `/api/sessions/${session.id}`,
      payload: { characterId: null },
    });
    expect(changed.json()).not.toHaveProperty('characterId');
    expect(changed.json().personaId).toBe(persona.id);
    expect((await app.inject({ method: 'DELETE', url: `/api/characters/${character.id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `/api/personas/${persona.id}` })).statusCode).toBe(204);
  } finally {
    await app.close();
  }
});

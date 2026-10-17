import { afterEach, expect, it, vi } from 'vitest';
import { alerts } from './alerts/store.js';
import {
  ApiError,
  api,
  json,
  sessionsApi,
  workflowsApi,
  charactersApi,
  collectionsApi,
  stateDefinitionsApi,
  nodeTypesApi,
  secretsApi,
} from './api.js';

afterEach(() => {
  vi.restoreAllMocks();
  alerts.clear();
});
it('only sends JSON content type when the request has a body', async () => {
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(new Response('{}', { status: 200 }));
  await api('/secrets/openrouter', json('DELETE'));
  await api('/sessions', json('POST', { workflowId: 'id' }));
  const emptyHeaders = new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit).headers);
  const bodyHeaders = new Headers((fetchMock.mock.calls[1]?.[1] as RequestInit).headers);
  expect(emptyHeaders.has('content-type')).toBe(false);
  expect(bodyHeaders.get('content-type')).toBe('application/json');
});
it('turns backend errors into typed ApiErrors and toasts unless silent', async () => {
  const details = {
    workflowId: 'workflow-id',
    workflowName: 'Broken',
    issues: [
      { message: 'Missing chat output' },
      {
        message: 'Connection from "LLM #2 (llm)" [output "text"] to "Chat Output #1 (chat-output)" [input "value"]',
        edgeId: 'edge-1',
        nodeIds: ['llm', 'out'],
      },
    ],
  };
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ error: { code: 'WORKFLOW_INVALID', message: 'Invalid workflow', details } }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  await expect(api('/workflows/id/validate', json('POST'))).rejects.toMatchObject({
    name: 'ApiError',
    status: 400,
    code: 'WORKFLOW_INVALID',
    message: 'Invalid workflow',
    details,
  } satisfies Partial<ApiError>);
  expect(alerts.getSnapshot()).toMatchObject([
    {
      level: 'error',
      message: 'Invalid workflow',
      details:
        'Missing chat output\nConnection from "LLM #2 (llm)" [output "text"] to "Chat Output #1 (chat-output)" [input "value"]',
      action: { label: 'Open workflow', to: '/?wide=workflow:workflow-id&edge=edge-1' },
    },
  ]);
  alerts.clear();
  await expect(api('/workflows/id/validate', { ...json('POST'), silent: true })).rejects.toBeInstanceOf(ApiError);
  expect(alerts.getSnapshot()).toHaveLength(0);
  expect((fetchMock.mock.calls[1]?.[1] as Record<string, unknown>).silent).toBeUndefined();
});
it('reports network failures as toasts', async () => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
  await expect(api('/sessions')).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  expect(alerts.getSnapshot()[0]?.message).toBe('Could not reach the server');
});
it('uses resource methods for typed JSON, multipart and bodyless requests', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
  await sessionsApi.sendMessage('session-id', { content: 'Hello' });
  await nodeTypesApi.resolvePorts('llm', { presetId: 'preset-id' });
  const form = new FormData();
  form.append('files', new Blob(['{"name":"Card"}'], { type: 'application/json' }), 'card.json');
  await charactersApi.import(form);
  await secretsApi.delete('test key');
  expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/sessions/session-id/messages');
  expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', body: '{"content":"Hello"}' });
  expect(fetchMock.mock.calls[1]?.[1]?.body).toBe('{"config":{"presetId":"preset-id"}}');
  expect(fetchMock.mock.calls[2]?.[1]?.body).toBe(form);
  expect(new Headers(fetchMock.mock.calls[2]?.[1]?.headers).has('content-type')).toBe(false);
  expect(fetchMock.mock.calls[3]?.[0]).toBe('/api/secrets/test%20key');
  expect(fetchMock.mock.calls[3]?.[1]?.body).toBeUndefined();
  expect(charactersApi.exportUrl('card-id', 'png')).toBe('/api/characters/card-id/export?format=png');
});
it('preserves silent errors through resource clients', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ error: { code: 'WORKFLOW_INVALID', message: 'Invalid workflow' } }), { status: 422 }),
  );
  await expect(workflowsApi.validate('workflow-id', { silent: true })).rejects.toBeInstanceOf(ApiError);
  expect(alerts.getSnapshot()).toHaveLength(0);
});

it('uses PATCH with JSON for message edits and bodyless DELETE for message removal', async () => {
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response('{}'))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  await sessionsApi.updateMessage('session-id', 'message-id', { content: 'Edited' });
  await sessionsApi.deleteMessage('session-id', 'message-id');
  expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/sessions/session-id/messages/message-id');
  expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'PATCH', body: '{"content":"Edited"}' });
  expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/sessions/session-id/messages/message-id');
  expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'DELETE' });
  expect(fetchMock.mock.calls[1]?.[1]?.body).toBeUndefined();
  expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).has('content-type')).toBe(false);
});

it("reads a chat's story state from its own path", async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
  await sessionsApi.state('session-id', { silent: true });
  expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/sessions/session-id/state');
  expect(fetchMock.mock.calls[0]?.[1]?.method).toBeUndefined();
});

it('reads and writes collections by id', async () => {
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(
      async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
  await collectionsApi.list();
  await collectionsApi.get('c/1');
  await collectionsApi.create({ name: 'Lore', entries: [] });
  await collectionsApi.update('c1', { name: 'Lore', entries: [] });
  await collectionsApi.delete('c1');
  expect(fetchMock.mock.calls.map(([url, init]) => [url, (init as RequestInit | undefined)?.method ?? 'GET'])).toEqual([
    ['/api/collections', 'GET'],
    ['/api/collections/c%2F1', 'GET'],
    ['/api/collections', 'POST'],
    ['/api/collections/c1', 'PUT'],
    ['/api/collections/c1', 'DELETE'],
  ]);
});

it('reads and writes state definitions by id (whole records, no single get)', async () => {
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(
      async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
  await stateDefinitionsApi.list();
  await stateDefinitionsApi.create({ name: 'scene', keys: {} });
  await stateDefinitionsApi.update('d/1', { name: 'scene', keys: {} });
  await stateDefinitionsApi.delete('d1');
  expect(fetchMock.mock.calls.map(([url, init]) => [url, (init as RequestInit | undefined)?.method ?? 'GET'])).toEqual([
    ['/api/state-definitions', 'GET'],
    ['/api/state-definitions', 'POST'],
    ['/api/state-definitions/d%2F1', 'PUT'],
    ['/api/state-definitions/d1', 'DELETE'],
  ]);
  expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ body: '{"name":"scene","keys":{}}' });
});

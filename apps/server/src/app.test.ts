import { afterEach, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createApp } from './app.js';

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});
it('supports workflow CRUD, secrets masking, and a chat execution through inject', async () => {
  const directory = join(process.cwd(), 'data', `test-${randomUUID()}`);
  directories.push(directory);
  const app = await createApp(directory, { seed: false });
  try {
    const types = (await app.inject({ method: 'GET', url: '/api/node-types' })).json();
    expect(types.find((type: { type: string }) => type.type === 'llm')).toMatchObject({
      inputs: [{ name: 'prompt', dataType: 'text' }, { name: 'context', dataType: 'any' }],
      templateFields: ['systemPrompt', 'promptTemplate']
    });
    const create = await app.inject({ method: 'POST', url: '/api/workflows', payload: { name: 'Echo' } });
    expect(create.statusCode).toBe(201);
    const workflow = create.json();
    const nodes = [
      { id: 'input', type: 'chat-input', config: {}, position: { x: 0, y: 0 } },
      { id: 'condition', type: 'condition', config: { left: '{{input.value}}', right: 'hi', operator: 'equals' }, position: { x: 100, y: 0 } },
      { id: 'merge', type: 'merge', config: { mode: 'first-non-empty' }, position: { x: 200, y: 0 } },
      { id: 'output', type: 'chat-output', config: { template: '' }, position: { x: 300, y: 0 } }
    ];
    const edges = [
      ['input', 'message', 'condition', 'value'], ['condition', 'true', 'merge', 'a'],
      ['condition', 'false', 'merge', 'b'], ['merge', 'value', 'output', 'value']
    ].map(([source, sourceHandle, target, targetHandle], id) => ({ id: String(id), source, sourceHandle, target, targetHandle }));
    const update = await app.inject({ method: 'PUT', url: `/api/workflows/${workflow.id}`, payload: { name: 'Echo', nodes, edges } });
    expect(update.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/workflows' })).json()).toHaveLength(1);
    expect((await app.inject({ method: 'POST', url: `/api/workflows/${workflow.id}/validate` })).json().valid).toBe(true);
    const emptyValidation = await app.inject({ method: 'POST', url: `/api/workflows/${workflow.id}/validate`,
      headers: { 'content-type': 'application/json' }, payload: '' });
    expect(emptyValidation.statusCode).toBe(200);
    expect(emptyValidation.json().valid).toBe(true);
    const emptyDelete = await app.inject({ method: 'DELETE', url: '/api/secrets/nonexistent',
      headers: { 'content-type': 'application/json' }, payload: '' });
    expect(emptyDelete.statusCode).toBe(204);
    const malformed = await app.inject({ method: 'POST', url: `/api/workflows/${workflow.id}/validate`,
      headers: { 'content-type': 'application/json' }, payload: '{' });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error).toMatchObject({ code: expect.any(String), message: expect.any(String) });
    const notFound = await app.inject({ method: 'GET', url: `/api/workflows/${randomUUID()}` });
    expect(notFound.statusCode).toBe(404);
    expect(notFound.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Workflow not found' } });
    const missingRoute = await app.inject({ method: 'GET', url: '/api/not-a-route' });
    expect(missingRoute.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
    const invalidBody = await app.inject({ method: 'POST', url: '/api/workflows', payload: {} });
    expect(invalidBody.statusCode).toBe(400);
    expect(invalidBody.json().error).toMatchObject({ code: 'VALIDATION_ERROR', message: 'Invalid request',
      details: [{ path: 'name', message: expect.any(String) }] });
    const created = (await app.inject({ method: 'POST', url: '/api/sessions', payload: { workflowId: workflow.id } })).json();
    const response = await app.inject({ method: 'POST', url: `/api/sessions/${created.id}/messages`, payload: { content: 'hi' } });
    expect(response.statusCode).toBe(200);
    expect(response.json().assistantMessage.content).toBe('hi');
    const executionId = response.json().execution.id;
    expect((await app.inject({ method: 'GET', url: `/api/executions/${executionId}` })).json().status).toBe('completed');
    await app.inject({ method: 'PUT', url: `/api/workflows/${workflow.id}`, payload: { name: 'Empty', nodes: [], edges: [] } });
    const invalidValidation = await app.inject({ method: 'POST', url: `/api/workflows/${workflow.id}/validate` });
    expect(invalidValidation.statusCode).toBe(422);
    expect(invalidValidation.json().error).toMatchObject({ code: 'WORKFLOW_INVALID',
      details: expect.arrayContaining([expect.stringContaining('chat-output')]) });
    const invalidGraph = await app.inject({ method: 'POST', url: `/api/sessions/${created.id}/messages`, payload: { content: 'hi' } });
    expect(invalidGraph.statusCode).toBe(400);
    expect(invalidGraph.json().error).toMatchObject({ code: 'WORKFLOW_INVALID', details: expect.arrayContaining([expect.stringContaining('chat-input')]) });
    await app.inject({ method: 'PUT', url: `/api/workflows/${workflow.id}`, payload: {
      name: 'LLM', nodes: [nodes[0], { id: 'llm', type: 'llm', config: {}, position: { x: 100, y: 0 } }, nodes[3]],
      edges: [{ id: 'prompt', source: 'input', sourceHandle: 'message', target: 'llm', targetHandle: 'prompt' },
        { id: 'reply', source: 'llm', sourceHandle: 'text', target: 'output', targetHandle: 'value' }]
    } });
    const missingSecret = await app.inject({ method: 'POST', url: `/api/sessions/${created.id}/messages`, payload: { content: 'hi' } });
    expect(missingSecret.statusCode).toBe(500);
    expect(missingSecret.json().error).toMatchObject({
      code: 'WORKFLOW_EXECUTION_FAILED', message: expect.stringContaining('OpenRouter LLM (llm): Missing openrouter secret'),
      details: { execution: { status: 'error' }, userMessage: { content: 'hi' } }
    });
    await app.inject({ method: 'PUT', url: '/api/secrets/openrouter', payload: { value: 'sk-test-secret123' } });
    const list = (await app.inject({ method: 'GET', url: '/api/secrets' })).json();
    expect(list[0].hint).toContain('…');
    expect(JSON.stringify(list)).not.toContain('sk-test-secret123');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { message: 'rate limited upstream' } }), { status: 429 }));
    const upstream = await app.inject({ method: 'POST', url: `/api/sessions/${created.id}/messages`, payload: { content: 'again' } });
    expect(upstream.json().error.message).toContain('OpenRouter 429: rate limited upstream');
    expect((await app.inject({ method: 'DELETE', url: `/api/workflows/${workflow.id}` })).statusCode).toBe(409);
    expect((await app.inject({ method: 'DELETE', url: `/api/sessions/${created.id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `/api/workflows/${workflow.id}` })).statusCode).toBe(204);
  } finally { await app.close(); }
});
it('hides unexpected error stacks and logs them server-side', async () => {
  const directory = join(process.cwd(), 'data', `test-${randomUUID()}`);
  directories.push(directory);
  const app = await createApp(directory, { seed: false });
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  app.get('/api/boom', async () => { throw new Error('sensitive internal details'); });
  try {
    const response = await app.inject({ method: 'GET', url: '/api/boom' });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
    expect(response.body).not.toContain('sensitive internal details');
    expect(log).toHaveBeenCalled();
  } finally { await app.close(); }
});

import { afterEach, expect, it } from 'vitest';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createApp } from './app.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
it('supports workflow CRUD, secrets masking, and a chat execution through inject', async () => {
  const directory = join(process.cwd(), 'data', `test-${randomUUID()}`);
  directories.push(directory);
  const app = await createApp(directory, { seed: false });
  try {
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
    const created = (await app.inject({ method: 'POST', url: '/api/sessions', payload: { workflowId: workflow.id } })).json();
    const response = await app.inject({ method: 'POST', url: `/api/sessions/${created.id}/messages`, payload: { content: 'hi' } });
    expect(response.statusCode).toBe(200);
    expect(response.json().assistantMessage.content).toBe('hi');
    const executionId = response.json().execution.id;
    expect((await app.inject({ method: 'GET', url: `/api/executions/${executionId}` })).json().status).toBe('completed');
    await app.inject({ method: 'PUT', url: '/api/secrets/openrouter', payload: { value: 'sk-test-secret123' } });
    const list = (await app.inject({ method: 'GET', url: '/api/secrets' })).json();
    expect(list[0].hint).toContain('…');
    expect(JSON.stringify(list)).not.toContain('sk-test-secret123');
    expect((await app.inject({ method: 'DELETE', url: `/api/workflows/${workflow.id}` })).statusCode).toBe(409);
    expect((await app.inject({ method: 'DELETE', url: `/api/sessions/${created.id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `/api/workflows/${workflow.id}` })).statusCode).toBe(204);
  } finally { await app.close(); }
});

import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { errorEnvelopeSchema, type PortDef, type StateDefinition, type Workflow } from '@st/shared';
import { createApp } from './app.js';

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'state-nodes-api-test-'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const open = async () => createApp(directory, { seed: false });
type App = Awaited<ReturnType<typeof open>>;
const call = (app: App, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
  app.inject({ method, url, payload });
const ports = (app: App, type: string, config: object) =>
  call(app, 'POST', `/api/node-types/${type}/ports`, { config });
const names = (list: PortDef[]) => list.map((port) => port.name);

async function define(app: App): Promise<StateDefinition> {
  const response = await call(app, 'POST', '/api/state-definitions', {
    name: 'scene',
    keys: { tension: { type: 'number', min: 0, max: 10 }, injected: { type: 'collection' } },
  });
  return response.json() as StateDefinition;
}

const node = (id: string, type: string, config: object) => ({ id, type, config, position: { x: 0, y: 0 } });
const edge = (source: string, sourceHandle: string, target: string, targetHandle: string) => ({
  id: `${source}-${sourceHandle}-${target}-${targetHandle}`,
  source,
  sourceHandle,
  target,
  targetHandle,
});
const workflowBody = (nodes: object[], edges: object[]) => ({ name: 'State flow', nodes, edges });

describe('State Read and State Write through the API', () => {
  it('resolves ports from a stored definition', async () => {
    const app = await open();
    const definition = await define(app);
    const read = await ports(app, 'state-read', { definitionId: definition.id, key: 'tension', read: 'value' });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ inputs: [], outputs: [{ name: 'value', dataType: 'number' }] });
    const meta = await ports(app, 'state-read', { definitionId: definition.id, key: 'injected', read: 'meta' });
    expect(names(meta.json().outputs)).toEqual(['written', 'turnsSinceWrite', 'writtenAtTurn', 'count']);
    const write = await ports(app, 'state-write', { definitionId: definition.id, key: 'tension', op: 'increment' });
    expect(write.json()).toMatchObject({
      inputs: [
        { name: 'value', dataType: 'number', requiredIfConnected: true },
        { name: 'when', dataType: 'any', requiredIfConnected: true },
      ],
      outputs: [{ name: 'value', dataType: 'number' }],
    });
    await app.close();
  });

  it('makes the Value input optional when the node has a fixed value, and validates accordingly', async () => {
    const app = await open();
    const definition = await define(app);
    const setting = { definitionId: definition.id, key: 'tension', op: 'set' };
    const needed = await ports(app, 'state-write', setting);
    expect(needed.json().inputs[0]).toMatchObject({ name: 'value', required: true });
    const fixed = await ports(app, 'state-write', { ...setting, value: 5 });
    expect(fixed.json().inputs[0]).toMatchObject({ name: 'value', requiredIfConnected: true });
    expect(fixed.json().inputs[0].required).toBeUndefined();

    const flow = (config: object) =>
      workflowBody(
        [node('input', 'chat-input', {}), node('output', 'chat-output', {}), node('mark', 'state-write', config)],
        [edge('input', 'message', 'output', 'value')],
      );
    const unset = (await call(app, 'POST', '/api/workflows', flow(setting))).json() as Workflow;
    const refused = await call(app, 'POST', `/api/workflows/${unset.id}/validate`);
    expect(refused.statusCode).toBe(422);
    const set = (await call(app, 'POST', '/api/workflows', flow({ ...setting, value: 5 }))).json() as Workflow;
    const accepted = await call(app, 'POST', `/api/workflows/${set.id}/validate`);
    expect(accepted.json()).toEqual({ valid: true, errors: [] });
    await app.close();
  });

  it.each([
    [{}, 'Select a state definition'],
    [{ definitionId: randomUUID(), key: 'tension' }, 'not found'],
  ])('answers 422 PORT_RESOLUTION_FAILED for %j', async (config, message) => {
    const app = await open();
    for (const type of ['state-read', 'state-write']) {
      const response = await ports(app, type, config);
      expect(response.statusCode).toBe(422);
      const { error } = errorEnvelopeSchema.parse(response.json());
      expect(error.code).toBe('PORT_RESOLUTION_FAILED');
      expect(error.message).toContain(message);
    }
    await app.close();
  });

  it('answers 422 for a key the definition does not have, naming it', async () => {
    const app = await open();
    const definition = await define(app);
    const response = await ports(app, 'state-write', { definitionId: definition.id, key: 'mood', op: 'set' });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.message).toBe('State definition "scene" has no key "mood"');
    await app.close();
  });

  it('validates a workflow that reads and writes state', async () => {
    const app = await open();
    const definition = await define(app);
    const nodes = [
      node('input', 'chat-input', {}),
      node('output', 'chat-output', {}),
      node('look', 'state-read', { definitionId: definition.id, key: 'tension', read: 'value' }),
      node('bump', 'state-write', { definitionId: definition.id, key: 'tension', op: 'increment' }),
    ];
    const created = (
      await call(app, 'POST', '/api/workflows', workflowBody(nodes, [edge('look', 'value', 'output', 'value')]))
    ).json() as Workflow;
    const validation = await call(app, 'POST', `/api/workflows/${created.id}/validate`);
    expect(validation.statusCode).toBe(200);
    expect(validation.json()).toEqual({ valid: true, errors: [] });
    await app.close();
  });

  it('reports a node whose definition was deleted as invalid, in plain words', async () => {
    const app = await open();
    const nodes = [
      node('input', 'chat-input', {}),
      node('output', 'chat-output', {}),
      node('look', 'state-read', { definitionId: randomUUID(), key: 'tension', read: 'value' }),
    ];
    const created = (
      await call(app, 'POST', '/api/workflows', workflowBody(nodes, [edge('look', 'value', 'output', 'value')]))
    ).json() as Workflow;
    const validation = await call(app, 'POST', `/api/workflows/${created.id}/validate`);
    expect(validation.statusCode).toBe(422);
    expect(validation.json().error.details.issues[0].message).toContain(
      'could not resolve its ports: State definition',
    );
    await app.close();
  });

  it('prunes a connection to a port that disappeared when the workflow is saved', async () => {
    const app = await open();
    const definition = await define(app);
    const nodes = (key: string) => [
      node('input', 'chat-input', {}),
      node('output', 'chat-output', {}),
      node('size', 'state-read', { definitionId: definition.id, key, read: 'meta' }),
    ];
    const connections = [edge('size', 'count', 'output', 'value')];
    const created = (
      await call(app, 'POST', '/api/workflows', workflowBody(nodes('injected'), connections))
    ).json() as Workflow;
    // Still a collection: `count` exists, the connection stays.
    const kept = await call(app, 'PUT', `/api/workflows/${created.id}`, workflowBody(nodes('injected'), connections));
    expect((kept.json() as Workflow).edges).toHaveLength(1);
    // Now a number key: there is no `count` port, so the connection goes (the node stays).
    const pruned = await call(app, 'PUT', `/api/workflows/${created.id}`, workflowBody(nodes('tension'), connections));
    expect((pruned.json() as Workflow).edges).toEqual([]);
    expect((pruned.json() as Workflow).nodes).toHaveLength(3);
    await app.close();
  });
});

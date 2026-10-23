import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'st-workflow-save-'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const nodes = [
  { id: 'input', type: 'chat-input', config: {}, position: { x: 0, y: 0 } },
  { id: 'output', type: 'chat-output', config: {}, position: { x: 300, y: 0 } },
];
const goodEdge = { id: 'reply', source: 'input', sourceHandle: 'message', target: 'output', targetHandle: 'value' };
// Points at an input the Chat Output does not have.
const badEdge = { id: 'bad', source: 'input', sourceHandle: 'message', target: 'output', targetHandle: 'nope' };

it('create and update drop edges to missing ports the same way and report their ids', async () => {
  const app = await createApp(directory, { seed: false });
  try {
    const created = await app.inject({
      method: 'POST',
      url: '/api/workflows',
      payload: { name: 'W', nodes, edges: [goodEdge, badEdge] },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ droppedEdgeIds: ['bad'], issues: [], edges: [goodEdge] });

    const updated = await app.inject({
      method: 'PUT',
      url: `/api/workflows/${created.json().id}`,
      payload: { name: 'W', nodes, edges: [badEdge, goodEdge] },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ droppedEdgeIds: ['bad'], issues: [], edges: [goodEdge] });

    const stored = (await app.inject({ method: 'GET', url: `/api/workflows/${created.json().id}` })).json();
    expect(stored.edges).toEqual([goodEdge]);
  } finally {
    await app.close();
  }
});

it('an invalid workflow is still saved, with its issues reported as data', async () => {
  const app = await createApp(directory, { seed: false });
  try {
    const created = await app.inject({ method: 'POST', url: '/api/workflows', payload: { name: 'Draft' } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ droppedEdgeIds: [], issues: [expect.any(Object), expect.any(Object)] });

    // A Chat Output with nothing wired into its required input.
    const updated = await app.inject({
      method: 'PUT',
      url: `/api/workflows/${created.json().id}`,
      payload: { name: 'Draft', nodes, edges: [] },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().issues).toEqual([
      { message: expect.stringContaining('required input "value"'), nodeIds: ['output'] },
    ]);
    const stored = (await app.inject({ method: 'GET', url: `/api/workflows/${created.json().id}` })).json();
    expect(stored.nodes).toHaveLength(2);
  } finally {
    await app.close();
  }
});

it('a save response echoed back as the next body does not store its report fields', async () => {
  const app = await createApp(directory, { seed: false });
  try {
    const created = (await app.inject({ method: 'POST', url: '/api/workflows', payload: { name: 'W' } })).json();
    const updated = await app.inject({
      method: 'PUT',
      url: `/api/workflows/${created.id}`,
      payload: { ...created, name: 'Renamed' },
    });
    expect(updated.statusCode).toBe(200);
    const stored = (await app.inject({ method: 'GET', url: `/api/workflows/${created.id}` })).json();
    expect(stored.name).toBe('Renamed');
    expect(stored).not.toHaveProperty('droppedEdgeIds');
    expect(stored).not.toHaveProperty('issues');
  } finally {
    await app.close();
  }
});

describe('positions', () => {
  const bare = nodes.map(({ position: _position, ...node }) => node);

  it('create and update lay out nodes without a position, along the edges', async () => {
    const app = await createApp(directory, { seed: false });
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/workflows',
        payload: { name: 'W', nodes: bare, edges: [goodEdge] },
      });
      expect(created.statusCode).toBe(201);
      expect(created.json().nodes.map((node: { position: unknown }) => node.position)).toEqual([
        { x: 0, y: 0 },
        { x: 320, y: 0 },
      ]);

      // Nothing stored under these ids yet. The edge to a port that does not exist is dropped, so it does not make a
      // second column: both nodes stack in the order written.
      const blank = (await app.inject({ method: 'POST', url: '/api/workflows', payload: { name: 'B' } })).json();
      const updated = await app.inject({
        method: 'PUT',
        url: `/api/workflows/${blank.id}`,
        payload: { name: 'B', nodes: [...bare].reverse(), edges: [badEdge] },
      });
      expect(updated.statusCode).toBe(200);
      expect(updated.json().nodes.map((node: { id: string; position: unknown }) => [node.id, node.position])).toEqual([
        ['output', { x: 0, y: 0 }],
        ['input', { x: 0, y: 240 }],
      ]);
      const stored = (await app.inject({ method: 'GET', url: `/api/workflows/${blank.id}` })).json();
      expect(stored.nodes.map((node: { position: unknown }) => node.position)).toEqual([
        { x: 0, y: 0 },
        { x: 0, y: 240 },
      ]);
    } finally {
      await app.close();
    }
  });

  it('an update keeps the stored position of a node written without one', async () => {
    const app = await createApp(directory, { seed: false });
    try {
      const placed = [
        { ...bare[0], position: { x: 40, y: 50 } },
        { ...bare[1], position: { x: 700, y: 90 } },
      ];
      const created = (
        await app.inject({ method: 'POST', url: '/api/workflows', payload: { name: 'W', nodes: placed, edges: [] } })
      ).json();
      const extra = { id: 'extra', type: 'chat-output', config: {} };
      const updated = await app.inject({
        method: 'PUT',
        url: `/api/workflows/${created.id}`,
        payload: { name: 'W', nodes: [...bare, extra], edges: [goodEdge] },
      });
      const positions = Object.fromEntries(
        updated.json().nodes.map((node: { id: string; position: unknown }) => [node.id, node.position]),
      );
      expect(positions).toMatchObject({ input: { x: 40, y: 50 }, output: { x: 700, y: 90 } });
      // The new node starts below the placed ones.
      expect(positions.extra).toEqual({ x: 40, y: 330 });
    } finally {
      await app.close();
    }
  });
});

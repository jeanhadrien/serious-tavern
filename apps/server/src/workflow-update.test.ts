import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createApp } from './app.js';

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'st-workflow-update-'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

it('a workflow PUT never changes id or createdAt, and keeps stored unknown fields', async () => {
  const app = await createApp(directory, { seed: false });
  try {
    const created = (await app.inject({ method: 'POST', url: '/api/workflows', payload: { name: 'Original' } })).json();
    // Stand in for a field written by a newer version.
    await app.inject({
      method: 'PUT',
      url: `/api/workflows/${created.id}`,
      payload: { name: 'Original', nodes: [], edges: [], futureField: 'kept' },
    });

    const hijackedId = randomUUID();
    const response = await app.inject({
      method: 'PUT',
      url: `/api/workflows/${created.id}`,
      payload: { name: 'Renamed', nodes: [], edges: [], id: hijackedId, createdAt: '1999-01-01T00:00:00.000Z' },
    });

    expect(response.statusCode).toBe(200);
    const updated = response.json();
    expect(updated).toMatchObject({
      id: created.id,
      createdAt: created.createdAt,
      name: 'Renamed',
      futureField: 'kept',
    });
    const stored = (await app.inject({ method: 'GET', url: `/api/workflows/${created.id}` })).json();
    expect(stored).toMatchObject({ id: created.id, createdAt: created.createdAt, name: 'Renamed' });
    expect((await app.inject({ method: 'GET', url: `/api/workflows/${hijackedId}` })).statusCode).toBe(404);
  } finally {
    await app.close();
  }
});

it('a workflow POST ignores a client-supplied id and timestamps', async () => {
  const app = await createApp(directory, { seed: false });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/workflows',
      payload: {
        name: 'W',
        id: 'chosen',
        createdAt: '1999-01-01T00:00:00.000Z',
        updatedAt: '1999-01-01T00:00:00.000Z',
      },
    });
    expect(response.statusCode).toBe(201);
    const workflow = response.json();
    expect(workflow.id).not.toBe('chosen');
    expect(workflow.createdAt).not.toBe('1999-01-01T00:00:00.000Z');
    expect(workflow.updatedAt).toBe(workflow.createdAt);
  } finally {
    await app.close();
  }
});

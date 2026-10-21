import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { apiContract } from '@st/shared';
import { createApp } from './app.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const note = { id: 'n1', text: 'Remember the lamp', position: { x: 10, y: 20 }, size: { width: 200, height: 120 } };
const graph = {
  nodes: [
    { id: 'input', type: 'chat-input', config: {}, position: { x: 0, y: 0 } },
    { id: 'output', type: 'chat-output', config: {}, position: { x: 100, y: 0 } },
  ],
  edges: [{ id: 'e', source: 'input', sourceHandle: 'message', target: 'output', targetHandle: 'value' }],
};

it('keeps sticky notes beside the nodes: created, kept when omitted, replaced and cleared on write, ignored by validation', async () => {
  const directory = join(process.cwd(), '.test-data', `notes-${randomUUID()}`);
  directories.push(directory);
  const app = await createApp(directory, { seed: false });
  try {
    const created = apiContract.createWorkflow.response.parse(
      (
        await app.inject({ method: 'POST', url: '/api/workflows', payload: { name: 'Noted', ...graph, notes: [note] } })
      ).json(),
    );
    expect(created.notes).toEqual([note]);
    const put = async (payload: Record<string, unknown>) =>
      apiContract.updateWorkflow.response.parse(
        (
          await app.inject({
            method: 'PUT',
            url: `/api/workflows/${created.id}`,
            payload: { name: 'Noted', ...graph, ...payload },
          })
        ).json(),
      );
    // An omitted `notes` keeps the stored ones.
    expect((await put({})).notes).toEqual([note]);
    const moved = { ...note, text: 'Changed', position: { x: 1, y: 2 } };
    expect((await put({ notes: [moved] })).notes).toEqual([moved]);
    expect((await put({ notes: [] })).notes).toEqual([]);
    const withNotes = await put({ notes: [note] });
    const validation = await app.inject({ method: 'POST', url: `/api/workflows/${withNotes.id}/validate` });
    expect(validation.statusCode).toBe(200);
    expect(validation.json().valid).toBe(true);
    expect((await app.inject({ method: 'GET', url: `/api/workflows/${created.id}` })).json().notes).toEqual([note]);
  } finally {
    await app.close();
  }
});

it('refuses a note without text or a position', async () => {
  const directory = join(process.cwd(), '.test-data', `notes-${randomUUID()}`);
  directories.push(directory);
  const app = await createApp(directory, { seed: false });
  try {
    const bad = await app.inject({
      method: 'POST',
      url: '/api/workflows',
      payload: { name: 'Bad', ...graph, notes: [{ id: 'n', text: 'no position' }] },
    });
    expect(bad.statusCode).toBe(400);
  } finally {
    await app.close();
  }
});

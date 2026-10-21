import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { ChatRequest, StreamOptions } from '@st/engine';
import { alternativesOfLastTurn, apiContract, type Edge } from '@st/shared';
import { createApp } from './app.js';
import { chatResponse, restoreAdapter, useAdapter } from './test-support/adapter.js';
import { parseEventStream } from './test-support/event-stream.js';
import { waitFor } from './test-support/post.js';
import { assistantRows, entriesOf, readSession, turn } from './test-support/story.js';

// A stopped regenerate keeps what had streamed: the partial reply becomes the shown alternative.

const directories: string[] = [];
afterEach(async () => {
  restoreAdapter();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const node = (id: string, type: string, config: Record<string, unknown> = {}) => ({
  id,
  type,
  config,
  position: { x: 0, y: 0 },
});
const link: Edge = { id: 'e', source: 'llm', sourceHandle: 'text', target: 'output', targetHandle: 'value' };

it('shows the partial reply of a stopped regenerate in place of the old one', async () => {
  let calls = 0;
  useAdapter({
    chat: async () => {
      throw new Error('These tests stream');
    },
    stream: async (_request: ChatRequest, { onToken, signal }: StreamOptions) => {
      calls++;
      if (calls === 1) {
        onToken('First');
        return chatResponse('First');
      }
      onToken('Par');
      await new Promise<never>((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('upstream aborted')), { once: true }),
      );
      throw new Error('unreachable');
    },
  });
  const directory = join(process.cwd(), '.test-data', `regenerate-llm-${randomUUID()}`);
  directories.push(directory);
  const app = await createApp(directory, { seed: false });
  try {
    await app.inject({ method: 'PUT', url: '/api/secrets/openrouter', payload: { value: 'test-key' } });
    const preset = (
      await app.inject({ method: 'POST', url: '/api/presets', payload: { name: 'Regen', inputs: [], entries: [] } })
    ).json();
    const workflow = (await app.inject({ method: 'POST', url: '/api/workflows', payload: { name: 'Regen' } })).json();
    await app.inject({
      method: 'PUT',
      url: `/api/workflows/${workflow.id}`,
      payload: {
        name: 'Regen',
        nodes: [
          node('input', 'chat-input'),
          node('llm', 'llm', { presetId: preset.id, provider: 'openrouter', model: 'm' }),
          node('output', 'chat-output'),
        ],
        edges: [link],
      },
    });
    const session = (
      await app.inject({ method: 'POST', url: '/api/sessions', payload: { workflowId: workflow.id } })
    ).json();
    expect(await turn(app, session.id, 'hi')).toEqual(['First']);
    const root = assistantRows(await readSession(app, session.id))[0]!.executionId!;

    const running = app.inject({ method: 'POST', url: `/api/sessions/${session.id}/regenerate/stream` });
    // While it streams, the new row is already tied to the turn's alternatives, and the old reply is still shown.
    const live = await waitFor(async () =>
      assistantRows(await readSession(app, session.id)).find((message) => message.content === 'Par'),
    );
    expect(live).toMatchObject({ status: 'streaming', alternativeOf: root });
    expect(assistantRows(await readSession(app, session.id))[0]).not.toHaveProperty('inactive');
    await app.inject({ method: 'POST', url: `/api/sessions/${session.id}/stop` });

    const events = parseEventStream((await running).body).map(({ data }) =>
      apiContract.streamRegenerate.response.parse(data),
    );
    expect(events.at(-1)).toMatchObject({
      type: 'turn.error',
      error: { code: 'TURN_STOPPED', details: { assistantMessages: [{ content: 'Par', status: 'partial' }] } },
    });
    const saved = await readSession(app, session.id);
    expect(assistantRows(saved)).toMatchObject([
      { content: 'First', inactive: true },
      { content: 'Par', status: 'partial', alternativeOf: root },
    ]);
    expect(assistantRows(saved)[1]).not.toHaveProperty('inactive');
    expect(alternativesOfLastTurn(saved.messages)).toMatchObject({ rootId: root, activeIndex: 1 });
    // The stopped alternative has a reply, so its turn is present (it did not complete).
    expect(entriesOf(saved).map((entry) => [entry.replies, entry.completed])).toEqual([
      [1, true],
      [1, false],
    ]);
  } finally {
    await app.close();
  }
});

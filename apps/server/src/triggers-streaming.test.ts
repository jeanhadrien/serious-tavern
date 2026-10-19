import { afterEach, expect, it } from 'vitest';
import type { ChatRequest, StreamOptions } from '@st/engine';
import { turnEventSchema } from '@st/shared';
import { restoreAdapter, useAdapter } from './test-support/adapter.js';
import { parseEventStream } from './test-support/event-stream.js';
import { waitFor } from './test-support/post.js';
import { assistantRows, edge, makeWorkflow, node, readSession, tempApps } from './test-support/story.js';
import { makeListSession } from './test-support/triggers.js';

// Two workflows that stream at the same time: their rows are stored (and sent) in list order whichever starts first.

const apps = tempApps('triggers-streaming');
afterEach(async () => {
  restoreAdapter();
  await apps.cleanup();
});

/** A promise the test settles by hand. */
function latch() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

it('stores the rows of workflows that stream together in list order, and reports each run with its position', async () => {
  // Per model: when it may send its first token, and when it may finish.
  const start = { a: latch(), b: latch() };
  const finish = { a: latch(), b: latch() };
  useAdapter({
    chat: async () => {
      throw new Error('These tests stream');
    },
    stream: async ({ model }: ChatRequest, { onToken }: StreamOptions) => {
      const name = model as 'a' | 'b';
      await start[name].opened;
      onToken(`${name.toUpperCase()}1`);
      await finish[name].opened;
      onToken(`${name.toUpperCase()}2`);
      return { text: `${name.toUpperCase()}1${name.toUpperCase()}2`, raw: {} };
    },
  });
  const { app } = await apps.open();
  try {
    await app.inject({ method: 'PUT', url: '/api/secrets/openrouter', payload: { value: 'test-key' } });
    const preset = (
      await app.inject({ method: 'POST', url: '/api/presets', payload: { name: 'P', inputs: [], entries: [] } })
    ).json();
    const streaming = (name: string, model: string) =>
      makeWorkflow(
        app,
        [
          node('input', 'chat-input'),
          node('llm', 'llm', { presetId: preset.id, provider: 'openrouter', model }),
          node('output', 'chat-output'),
        ],
        [edge('llm', 'text', 'output', 'value')],
        name,
      );
    const upper = await streaming('Upper', 'a');
    const lower = await streaming('Lower', 'b');
    const session = await makeListSession(app, [{ workflowId: upper.id }, { workflowId: lower.id }]);
    const running = app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/messages/stream`,
      payload: { content: 'go' },
    });
    const rows = async () => assistantRows(await readSession(app, session.id)).map((message) => message.content);
    // The lower workflow streams first: its row is stored before the upper one has a row at all.
    start.b.open();
    await waitFor(async () => ((await rows()).length === 1 ? true : undefined));
    expect(await rows()).toEqual(['B1']);
    // The upper one's row then goes ABOVE it, where the settled turn will have it.
    start.a.open();
    await waitFor(async () => ((await rows()).length === 2 ? true : undefined));
    expect(await rows()).toEqual(['A1', 'B1']);
    finish.b.open();
    finish.a.open();
    const frames = parseEventStream((await running).body).map((frame) => turnEventSchema.parse(frame.data));
    const starts = frames.flatMap((frame) => (frame.type === 'run.start' ? [[frame.workflowId, frame.position]] : []));
    expect(starts.sort()).toEqual(
      [
        [upper.id, 0],
        [lower.id, 1],
      ].sort(),
    );
    const done = frames.at(-1)!;
    expect(done.type).toBe('turn.complete');
    expect(await rows()).toEqual(['A1A2', 'B1B2']);
    if (done.type === 'turn.complete')
      expect(done.assistantMessages.map((message) => message.content)).toEqual(['A1A2', 'B1B2']);
  } finally {
    start.a.open();
    start.b.open();
    finish.a.open();
    finish.b.open();
    await app.close();
  }
});

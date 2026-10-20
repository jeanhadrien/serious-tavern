import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import type { ChatRequest } from '@st/engine';
import type { ToolCall } from '@st/shared';
import { createApp } from './app.js';
import { PLOT_DEFINITION_ID, SCENARIST_NARRATOR_WORKFLOW_ID, SCENARIST_WORKFLOW_ID } from './examples/scenarist.js';
import { chatResponse, restoreAdapter, useAdapter } from './test-support/adapter.js';
import { stateView, waitForPostRun } from './test-support/post.js';
import { assistantRows, deleteMessage, entriesOf, readSession, turn, type App } from './test-support/story.js';
import { makeListSession } from './test-support/triggers.js';

// The "Scenarist with tools" example pack over two turns: the narrator replies, the scenarist (listed below it, so it
// runs after the reply) steers the plot through its tools, and its exchanges come back woven into its next prompt.

let directory: string;
let app: App | undefined;
let quiet: MockInstance<typeof console.log> | undefined;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'scenarist-example-'));
  quiet = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(async () => {
  restoreAdapter();
  quiet?.mockRestore();
  await app?.close();
  app = undefined;
  await rm(directory, { recursive: true, force: true });
});

type Wire = { role: string; content: string; tool_calls?: { function: { name: string } }[] };
const wire = (request: ChatRequest) => request.messages as Wire[];

// The adapter stamps replies with the node that produced them; the fake does the same (the default provider and model).
const stamp = { providerId: 'openrouter', model: 'openai/gpt-4o-mini', nodeId: 'llm' };
const callsTools = (...calls: [name: string, args: object][]) => {
  const tool_calls: ToolCall[] = calls.map(([name, args], index) => ({
    id: `call_${index}_${name}`,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  }));
  return chatResponse('', { message: { role: 'assistant', content: '', tool_calls, provenance: stamp } });
};
const says = (text: string) => chatResponse(text, { message: { role: 'assistant', content: text, provenance: stamp } });

/** What the scenarist does on each turn: its tool calls first, then a one-line answer. */
const SCENARIST_TURNS = [
  () =>
    callsTools(
      ['write_plot_tension', { op: 'set', value: 4 }],
      ['write_plot_threads', { op: 'add', text: 'Who sent the letter?' }],
    ),
  () => callsTools(['write_plot_beat', { op: 'set', value: 'twist' }]),
];

it('steers the plot after each reply, keeps its exchanges on a thread and weaves them into its next prompt', async () => {
  const narrator: ChatRequest[] = [];
  const scenarist: ChatRequest[] = [];
  useAdapter({
    chat: async (request) => {
      if (!request.tools?.length) {
        narrator.push(structuredClone(request));
        return says(`reply ${narrator.length}`);
      }
      scenarist.push(structuredClone(request));
      // Two calls per turn: the tools, then the answer once their results are back.
      const turnIndex = Math.floor((scenarist.length - 1) / 2);
      return scenarist.length % 2 === 1 ? SCENARIST_TURNS[turnIndex]!() : says(`Done with turn ${turnIndex + 1}.`);
    },
  });
  app = await createApp(directory, { seed: true, examples: true });
  await app.inject({ method: 'PUT', url: '/api/secrets/openrouter', payload: { value: 'test-key' } });
  // The narrator, and below it the scenarist, which has no Chat Output and so runs after the reply.
  const session = await makeListSession(app, [
    { workflowId: SCENARIST_NARRATOR_WORKFLOW_ID },
    { workflowId: SCENARIST_WORKFLOW_ID },
  ]);
  const plot = async () => {
    const values = (await stateView(app!, session.id)).definitions.find((item) => item.name === 'plot')!.values;
    return values as { tension: number; beat: string; threads: { text: string }[]; notes: Record<string, unknown>[] };
  };

  // Turn 1.
  expect(await turn(app, session.id, 'message 1')).toEqual(['reply 1']);
  await waitForPostRun(app, session.id, 'completed');
  expect(scenarist).toHaveLength(2);
  // The scenarist gets tools for every plot key but the thread, and the narrator none.
  expect(narrator[0]?.tools).toBeUndefined();
  expect(scenarist[0]?.tools?.map((tool) => tool.function.name)).toEqual([
    'read_state',
    'write_plot_tension',
    'write_plot_beat',
    'write_plot_threads',
  ]);
  expect(JSON.stringify(scenarist[0]?.tools)).not.toContain('notes');
  // Nothing to weave yet: the chat as it stands (the question and the narrator's reply), then the instruction.
  expect(wire(scenarist[0]!).map((message) => message.role)).toEqual(['system', 'user', 'assistant', 'user']);

  const first = await plot();
  expect(first).toMatchObject({ tension: 4, beat: 'setup', threads: [{ text: 'Who sent the letter?' }] });
  expect(first.notes).toEqual([
    expect.objectContaining({
      text: 'Done with turn 1.',
      steps: 2,
      toolCalls: ['write_plot_tension', 'write_plot_threads'],
    }),
  ]);
  // The scenarist's writes and its thread item are the turn's: three writes, the LLM's two and the State Write's one.
  const [entry] = entriesOf(await readSession(app, session.id));
  expect(entry?.writes.map((write) => [write.target, write.nodeId])).toEqual([
    [{ kind: 'definition', definitionId: PLOT_DEFINITION_ID, key: 'tension' }, 'llm'],
    [{ kind: 'definition', definitionId: PLOT_DEFINITION_ID, key: 'threads' }, 'llm'],
    [{ kind: 'definition', definitionId: PLOT_DEFINITION_ID, key: 'notes' }, 'keep'],
  ]);

  // Turn 2: the narrator now reads the plot state, and the scenarist sees its first exchange.
  expect(await turn(app, session.id, 'message 2')).toEqual(['reply 2']);
  await waitForPostRun(app, session.id, 'completed');
  const direction = (request: ChatRequest) =>
    wire(request).find((message) => message.role === 'system' && message.content.includes('Story direction'))?.content;
  expect(direction(narrator[0]!)).toContain('the current beat is setup and the tension is 2 out of 10.');
  expect(direction(narrator[0]!)).not.toContain('Open plot threads');
  expect(direction(narrator[1]!)).toContain('the current beat is setup and the tension is 4 out of 10.');
  expect(direction(narrator[1]!)).toContain('Open plot threads:\n- Who sent the letter?');

  // Woven after turn 1's reply, tool calls and results as native messages; the exchange's answer comes along because
  // the chat does not hold it (the scenarist writes no Chat Output).
  const prompt = wire(scenarist[2]!).filter((message) => message.role !== 'system');
  expect(prompt.map((message) => message.role)).toEqual([
    'user',
    'assistant',
    'assistant',
    'tool',
    'tool',
    'assistant',
    'user',
    'assistant',
    'user',
  ]);
  expect(prompt.map((message) => message.content)).toEqual([
    'message 1',
    'reply 1',
    '',
    expect.stringContaining('4'),
    expect.stringContaining('Who sent the letter?'),
    'Done with turn 1.',
    'message 2',
    'reply 2',
    'Steer the plot for the next reply.',
  ]);
  expect(prompt[2]?.tool_calls?.map((call) => call.function.name)).toEqual([
    'write_plot_tension',
    'write_plot_threads',
  ]);

  const second = await plot();
  expect(second).toMatchObject({ tension: 4, beat: 'twist', threads: [{ text: 'Who sent the letter?' }] });
  expect(second.notes).toHaveLength(2);

  // Deleting turn 1's reply undoes everything that turn wrote: its tension, its thread and its exchange.
  const stored = await readSession(app, session.id);
  const firstReply = assistantRows(stored).find((message) => message.content === 'reply 1')!;
  expect((await deleteMessage(app, session.id, firstReply.id)).statusCode).toBeLessThan(300);
  const after = await plot();
  expect(after).toMatchObject({ tension: 2, beat: 'twist', threads: [] });
  expect(after.notes).toEqual([expect.objectContaining({ text: 'Done with turn 2.', toolCalls: ['write_plot_beat'] })]);
});

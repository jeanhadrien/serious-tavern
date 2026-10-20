import { describe, expect, it } from 'vitest';
import type { ConversationMessage, StateDefinition } from '@st/shared';
import { descriptors } from './registry.js';
import { thread } from './nodes/thread/index.js';
import { runNode } from './test-collections.js';
import { snapshotOf, stateResources } from './test-state.js';

const ID = '44444444-4444-4444-8444-444444444444';
const definition: StateDefinition = {
  id: ID,
  name: 'story',
  keys: { log: { type: 'thread' }, notes: { type: 'collection' }, mood: { type: 'text' } },
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};
const resources = stateResources(definition);
const provenance = { providerId: 'p', model: 'm', nodeId: 'llm' };

// One LLM run: a tool call, its result and the final answer.
const exchange = (tag: string): ConversationMessage[] => [
  {
    role: 'assistant',
    content: '',
    provenance,
    tool_calls: [{ id: `call-${tag}`, type: 'function', function: { name: 'read_state', arguments: '{}' } }],
  },
  { role: 'tool', content: `result ${tag}`, tool_call_id: `call-${tag}` },
  { role: 'assistant', content: `answer ${tag}`, provenance },
];
const item = (tag: string, turnId: string, input?: string) => ({
  id: `item-${tag}`,
  text: `answer ${tag}`,
  exchange: exchange(tag),
  ...(input && { input: { role: 'user', content: input } }),
  turnId,
  runId: `run-${tag}`,
});

// As the fold hands them: newest first, the items of turn t2 in reverse write order (b was written after a).
const a1 = item('a1', 't1', 'question 1');
const a2 = item('a2', 't2', 'question 2');
const b2 = item('b2', 't2');
const stored = [b2, a2, a1];

const config = (extra: Record<string, unknown> = {}, key = 'log') =>
  thread.configSchema.parse({ definitionId: ID, key, ...extra });
const run = (
  options: {
    items?: unknown[];
    key?: string;
    history?: unknown;
    extra?: Record<string, unknown>;
    turnId?: string;
  } = {},
) => {
  const items = options.items ?? stored;
  return runNode(thread, config(options.extra, options.key), {
    resources,
    turnId: options.turnId,
    inputs: options.history === undefined ? {} : { history: options.history },
    state: snapshotOf([definition], {
      turnIds: ['t1', 't2'],
      keys: {
        'story.log': {
          value: items,
          itemTurns: items.map((entry) => ((entry as { turnId?: string }).turnId === 't1' ? 1 : 2)),
        },
      },
    }),
  });
};
const contents = (messages: unknown) => (messages as ConversationMessage[]).map((message) => message.content);

describe('Thread node', () => {
  it('is a History node with an optional history input that never skips it, and no dynamic ports', () => {
    const entry = descriptors().find((descriptor) => descriptor.type === 'thread');
    expect(entry).toMatchObject({ category: 'History', label: 'Thread' });
    expect(entry?.dynamicPorts).toBeFalsy();
    expect(entry?.inputs).toEqual([
      expect.objectContaining({ name: 'history', dataType: 'messages', optional: true, neverSkips: true }),
    ]);
    expect(entry?.outputs).toEqual([expect.objectContaining({ name: 'messages', dataType: 'messages' })]);
  });

  describe('alone', () => {
    it('gives the exchanges oldest first, each after its question, same-turn items in write order', async () => {
      const { output } = await run();
      expect(contents(output.messages)).toEqual([
        'question 1',
        '',
        'result a1',
        'answer a1',
        'question 2',
        '',
        'result a2',
        'answer a2',
        '',
        'result b2',
        'answer b2',
      ]);
    });

    it('leaves the questions out with withInputs off', async () => {
      const { output } = await run({ extra: { withInputs: false } });
      expect(contents(output.messages)).not.toContain('question 1');
      expect(contents(output.messages)).toHaveLength(9);
    });

    it('keeps the newest N exchanges', async () => {
      const { output } = await run({ extra: { lastN: 2 } });
      expect(contents(output.messages)).toEqual([
        'question 2',
        '',
        'result a2',
        'answer a2',
        '',
        'result b2',
        'answer b2',
      ]);
      expect(contents((await run({ extra: { lastN: 99 } })).output.messages)).toHaveLength(11);
    });

    it('reads a plain item (no exchange) as one assistant message with its text', async () => {
      const plain = { id: 'old', text: 'an old note' };
      const { output } = await run({ items: [b2, plain], extra: { lastN: 5 } });
      expect(output.messages).toEqual([{ role: 'assistant', content: 'an old note' }, ...exchange('b2')]);
    });

    it('is empty for an empty key', async () => {
      expect((await run({ items: [] })).output.messages).toEqual([]);
    });
  });

  describe('woven into a history', () => {
    const history = [
      { id: 'm1', role: 'user', content: 'question 1', executionId: 't1' },
      { id: 'm2', role: 'assistant', content: 'answer a1', executionId: 't1', runId: 'run-a1', sourceNodeId: 'llm' },
      { id: 'm3', role: 'user', content: 'question 2', executionId: 't2' },
      { id: 'm4', role: 'assistant', content: 'edited a2', executionId: 't2', runId: 'run-a2', sourceNodeId: 'llm' },
    ];

    it('puts the tool blocks right before the reply and drops the duplicated answer', async () => {
      const { output } = await run({ history, extra: { lastN: 2 } });
      // The lastN: 2 keeps a2 and b2 only; a2's answer is in the chat (edited, the chat wins), b2's goes after the turn.
      expect(contents(output.messages)).toEqual([
        'question 1',
        'answer a1',
        'question 2',
        '',
        'result a2',
        'edited a2',
        '',
        'result b2',
        'answer b2',
      ]);
    });

    it('weaves every exchange the key holds and ignores withInputs', async () => {
      const { output } = await run({ history, extra: { withInputs: true } });
      expect(contents(output.messages).filter((text) => text.startsWith('question'))).toEqual([
        'question 1',
        'question 2',
      ]);
      expect(contents(output.messages).slice(0, 4)).toEqual(['question 1', '', 'result a1', 'answer a1']);
    });

    it('returns the history messages as they came in', async () => {
      const { output } = await run({ history });
      for (const message of history) expect(output.messages).toContain(message);
    });

    it('puts the items of the running turn after the history when none of its messages is in it', async () => {
      const { output } = await run({ history: history.slice(0, 2), turnId: 't2', extra: { lastN: 2 } });
      expect(contents(output.messages).slice(0, 2)).toEqual(['question 1', 'answer a1']);
      expect(contents(output.messages).slice(2)).toEqual(['', 'result a2', 'answer a2', '', 'result b2', 'answer b2']);
    });

    it('gives a plain item the turn its turn number stands for', async () => {
      const plain = { id: 'old', text: 'an old note' };
      const { output } = await run({ items: [plain], history });
      // itemTurns says turn 2: after the last message of t2.
      expect(contents(output.messages).at(-1)).toBe('an old note');
    });
  });

  describe('errors', () => {
    it('fails for a definition that does not exist', async () => {
      await expect(runNode(thread, config(), { resources, state: snapshotOf([]), inputs: {} })).rejects.toThrow(
        `State definition ${ID} not found`,
      );
    });

    it('fails for an unknown key', async () => {
      await expect(run({ key: 'nope' })).rejects.toThrow('has no key "nope"');
    });

    it.each(['notes', 'mood'])('fails for a key that is not a thread (%s)', async (key) => {
      await expect(run({ key })).rejects.toThrow(/story\.\w+ is a \w+ key; this node needs a thread key/);
    });

    it('fails when the history is not a list of messages', async () => {
      await expect(run({ history: 'user: hi' })).rejects.toThrow('needs a list of messages');
    });
  });
});

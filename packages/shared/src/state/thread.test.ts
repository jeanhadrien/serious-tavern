import { describe, expect, it } from 'vitest';
import { WRITE_PREVIEW_LIMIT } from '../api/state.js';
import type { ConversationMessage } from '../conversation/message.js';
import { stateKeyDefSchema } from './definition.js';
import { threadItem } from './node-values.js';
import { previewWrite, viewThreadItem } from './preview.js';
import { stateHints, emptyStateSnapshot, stateTemplateValues } from './snapshot.js';
import {
  addWrite,
  definition,
  deleteWrite,
  foldTurns,
  idsOf,
  item,
  keyOf,
  removeWrite,
  setWrite,
  turnEntry,
} from './test-fixtures.js';

const provenance = { providerId: 'p', model: 'm', nodeId: 'llm' };
const exchange = (answer = 'It is calm.'): ConversationMessage[] => [
  {
    role: 'assistant',
    content: '',
    reasoning: 'thinking',
    provider_data: { blob: 1 },
    provenance,
    tool_calls: [
      { id: 'c1', type: 'function', function: { name: 'read_state', arguments: '{}' } },
      { id: 'c2', type: 'function', function: { name: 'write_scene_mood', arguments: '{}' } },
    ],
  },
  { role: 'tool', content: 'a', tool_call_id: 'c1' },
  { role: 'tool', content: 'b', tool_call_id: 'c2' },
  { role: 'assistant', content: answer },
];

describe('the thread key definition', () => {
  it('takes a description and a whole-number cap, nothing else is needed', () => {
    expect(stateKeyDefSchema.parse({ type: 'thread' })).toEqual({ type: 'thread' });
    expect(stateKeyDefSchema.parse({ type: 'thread', cap: 3, description: 'x', later: 1 })).toEqual({
      type: 'thread',
      cap: 3,
      description: 'x',
      later: 1,
    });
    expect(stateKeyDefSchema.safeParse({ type: 'thread', cap: 0 }).success).toBe(false);
    expect(stateKeyDefSchema.safeParse({ type: 'thread', cap: 1.5 }).success).toBe(false);
  });
});

describe('folding a thread', () => {
  const story = definition('story', { log: { type: 'thread', cap: 2 }, note: { type: 'text' } });
  const exchangeItem = (id: string) => item(id, `text ${id}`, { exchange: exchange(), turnId: 't', runId: 'r' });
  const fold = (...args: Parameters<typeof foldTurns>) => foldTurns(args[0], { defs: [story], ...args[1] });
  const ids = (turns: Parameters<typeof foldTurns>[0], gone?: string[]) => idsOf(fold(turns, { gone }), 'log');

  it('keeps exchanges like a collection: newest first, removable, clearable', () => {
    const turns = [
      turnEntry('a', [addWrite('log', exchangeItem('1'))]),
      turnEntry('b', [addWrite('log', exchangeItem('2'))]),
    ];
    expect(ids(turns)).toEqual(['2', '1']);
    expect(ids([...turns, turnEntry('c', [removeWrite('log', '1')])])).toEqual(['2']);
    expect(ids([...turns, turnEntry('c', [deleteWrite('log'), addWrite('log', exchangeItem('3'))])])).toEqual(['3']);
  });

  it('does not look inside the items', () => {
    const odd = item('x', 'odd', { exchange: 'not a list' });
    expect(ids([turnEntry('a', [addWrite('log', odd)])])).toEqual(['x']);
  });

  it('keeps the newest `cap` exchanges and counts what it cut', () => {
    const turns = ['1', '2', '3'].map((id) => turnEntry(id, [addWrite('log', exchangeItem(id))]));
    const key = keyOf(fold(turns), 'log');
    expect((key.value as { id: string }[]).map((entry) => entry.id)).toEqual(['3', '2']);
    expect(key.meta).toMatchObject({ count: 2, droppedByCap: 1 });
    expect(key.itemTurns).toEqual([3, 2]);
  });

  it('follows the turn rules: deleting the reply undoes the exchange', () => {
    const turns = [
      turnEntry('a', [addWrite('log', exchangeItem('1'))]),
      turnEntry('b', [addWrite('log', exchangeItem('2'))]),
    ];
    expect(ids(turns, ['b'])).toEqual(['1']);
    expect(ids(turns, ['a'])).toEqual(['2']);
  });

  it('ignores a set stored for another key type and says so', () => {
    const story2 = fold([turnEntry('a', [setWrite('log', 'x'), addWrite('log', exchangeItem('1'))])]);
    expect(idsOf(story2, 'log')).toEqual(['1']);
    expect(story2.definitions[0]!.warnings).toHaveLength(1);
  });

  it('reads as an empty list before anything is written', () => {
    const empty = fold([]);
    expect(keyOf(empty, 'log').value).toEqual([]);
    expect(keyOf(empty, 'log').meta).toMatchObject({ written: false, count: 0 });
  });
});

describe('threadItem', () => {
  it('takes an exchange and uses its final answer as the text', () => {
    const fit = threadItem(exchange());
    expect(fit.problem).toBeUndefined();
    expect(fit).toMatchObject({ item: { text: 'It is calm.' } });
  });

  it('leaves reasoning and provider data out unless asked, and keeps provenance and tool calls', () => {
    const plain = threadItem(exchange());
    const stored = plain.problem === undefined ? plain.item.exchange : [];
    expect(stored[0]).toEqual({
      role: 'assistant',
      content: '',
      provenance,
      tool_calls: exchange()[0]!.tool_calls,
    });
    expect(threadItem(exchange(), undefined, { keepReasoning: true })).toMatchObject({
      item: { exchange: exchange() },
    });
  });

  it('does not change the value it was given', () => {
    const given = exchange();
    threadItem(given);
    expect(given).toEqual(exchange());
  });

  it('has no text for an exchange that does not end with an answer', () => {
    expect(threadItem([{ role: 'user', content: 'hi' }])).toMatchObject({ item: { text: '' } });
  });

  it('stores the input as a user message, from text or from a message', () => {
    expect(threadItem(exchange(), 'What now?')).toMatchObject({
      item: { input: { role: 'user', content: 'What now?' } },
    });
    expect(
      threadItem(exchange(), { role: 'user', content: 'hi', name: 'Ann', id: 'm1', createdAt: 'x' }),
    ).toMatchObject({
      item: { input: { role: 'user', content: 'hi', name: 'Ann' } },
    });
    const none = threadItem(exchange(), '   ');
    expect(none.problem === undefined && 'input' in none.item).toBe(false);
  });

  it.each<[string, unknown, unknown, string]>([
    ['text', 'hello', undefined, 'a list of messages (the exchange of an LLM node)'],
    ['null', null, undefined, 'a list of messages (the exchange of an LLM node)'],
    ['an object', exchange()[0], undefined, 'a list of messages (the exchange of an LLM node)'],
    ['an empty list', [], undefined, 'at least one message in the exchange'],
    [
      'a stray value',
      [{ role: 'assistant', content: 'a' }, 4],
      undefined,
      'messages only, but message 2 is not valid: ',
    ],
    ['a message with a wrong role', [{ role: 'robot', content: 'a' }], undefined, 'messages only, but message 1'],
    ['an input of a number', exchange(), 4, 'the input to be text or one message'],
    ['an input that is no message', exchange(), { text: 'x' }, 'the input to be text or one message'],
  ])('refuses %s', (_, value, input, problem) => {
    const fit = threadItem(value, input);
    expect(fit.problem).toContain(problem);
    expect('item' in fit).toBe(false);
  });
});

describe('the view of a thread', () => {
  const stored = item('r:n:1', 'It is calm.', {
    exchange: exchange(),
    input: { role: 'user', content: 'go' },
    turnId: 't',
    runId: 'r',
  });

  it('summarizes an item: text, steps and tool call names, never the exchange', () => {
    expect(viewThreadItem(stored)).toEqual({
      id: 'r:n:1',
      text: 'It is calm.',
      steps: 2,
      toolCalls: ['read_state', 'write_scene_mood'],
      turnId: 't',
      runId: 'r',
    });
  });

  it('leaves any other item as it is', () => {
    const plain = item('1', 'a note', { level: 2 });
    expect(viewThreadItem(plain)).toBe(plain);
  });

  it('shows an add as its summary in a write preview, without touching the stored write', () => {
    const write = addWrite('log', stored);
    const { write: shown, truncated } = previewWrite(write);
    expect(truncated).toBe(false);
    expect(shown).toMatchObject({
      op: 'add',
      item: { id: 'r:n:1', text: 'It is calm.', steps: 2, toolCalls: ['read_state', 'write_scene_mood'] },
    });
    expect(JSON.stringify(shown)).not.toContain('tool_call_id');
    expect(JSON.stringify(shown)).not.toContain('"exchange"');
    expect(write).toMatchObject({ item: { exchange: exchange() } });
  });

  it('cuts a long answer like any text and says so', () => {
    const long = item('r:n:2', 'x'.repeat(WRITE_PREVIEW_LIMIT + 5), { exchange: exchange('x') });
    const { write, truncated } = previewWrite(addWrite('log', long));
    expect(truncated).toBe(true);
    expect((write as { item: { text: string } }).item.text).toHaveLength(WRITE_PREVIEW_LIMIT);
  });
});

describe('a thread in templates and hints', () => {
  const story = { ...definition('story', { log: { type: 'thread', cap: 4 } }), id: 'd1' };

  it('hints the key as a list of exchanges', () => {
    expect(stateHints([story])).toEqual([
      {
        path: 'story.log',
        type: 'array',
        description: 'Story state: List of exchanges (their final text), newest first (up to 4)',
      },
    ]);
  });

  it('reads as an empty list in templates until written', () => {
    expect(stateTemplateValues(emptyStateSnapshot([story]))).toEqual({ story: { log: [] } });
  });
});

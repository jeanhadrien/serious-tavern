import { describe, expect, it } from 'vitest';
import { flattenUndeclaredToolBlocks, messageBlocks, repairToolSequence } from './blocks.js';
import type { ConversationMessage } from './message.js';

const user = (content: string): ConversationMessage => ({ role: 'user', content });
const system = (content: string): ConversationMessage => ({ role: 'system', content });
const calls = (content: string, ...ids: string[]): ConversationMessage => ({
  role: 'assistant',
  content,
  tool_calls: ids.map((id) => ({ id, type: 'function' as const, function: { name: `tool_${id}`, arguments: '{}' } })),
});
const result = (id: string, content = `result ${id}`): ConversationMessage => ({
  role: 'tool',
  content,
  tool_call_id: id,
});
const label = (message: ConversationMessage) =>
  message.role === 'tool'
    ? `tool:${message.tool_call_id}`
    : message.tool_calls?.length
      ? `${message.role}[${message.tool_calls.map((call) => call.id).join(',')}]`
      : `${message.role}:${message.content}`;
const labels = (messages: ConversationMessage[]) => messages.map(label);

describe('messageBlocks', () => {
  it.each([
    ['nothing', [], []],
    ['plain messages', [user('a'), { role: 'assistant', content: 'b' }], [['user:a'], ['assistant:b']]],
    [
      'a call with its answers',
      [calls('', 'a', 'b'), result('a'), result('b')],
      [['assistant[a,b]', 'tool:a', 'tool:b']],
    ],
    [
      'answers in any order, then the next message',
      [calls('', 'a', 'b'), result('b'), result('a'), user('x')],
      [['assistant[a,b]', 'tool:b', 'tool:a'], ['user:x']],
    ],
    ['a partial answer', [calls('', 'a', 'b'), result('a'), user('x')], [['assistant[a,b]', 'tool:a'], ['user:x']]],
    [
      'a system message in the middle splits the block',
      [calls('', 'a', 'b'), result('a'), system('s'), result('b')],
      [['assistant[a,b]', 'tool:a'], ['system:s'], ['tool:b']],
    ],
    ['an orphan tool message', [user('x'), result('a')], [['user:x'], ['tool:a']]],
    ['a tool message answering another call', [calls('', 'a'), result('z')], [['assistant[a]'], ['tool:z']]],
    [
      'two calls in a row',
      [calls('', 'a'), result('a'), calls('', 'b'), result('b')],
      [
        ['assistant[a]', 'tool:a'],
        ['assistant[b]', 'tool:b'],
      ],
    ],
    ['an empty call list as a plain message', [{ role: 'assistant', content: 'x', tool_calls: [] }], [['assistant:x']]],
  ] as [string, ConversationMessage[], string[][]][])('splits %s', (_name, messages, expected) => {
    expect(messageBlocks(messages).map(labels)).toEqual(expected);
  });
});

describe('flattenUndeclaredToolBlocks', () => {
  const flat = (messages: ConversationMessage[], declared: string[]) => flattenUndeclaredToolBlocks(messages, declared);

  it('leaves blocks of declared tools alone', () => {
    const messages = [user('a'), calls('', 'a'), result('a'), user('b')];
    const { messages: out, flattened } = flat(messages, ['tool_a']);
    expect(flattened).toBe(0);
    expect(out).toEqual(messages);
  });

  it('turns an undeclared block into text: the assistant keeps its content, the results become one user message', () => {
    const { messages, flattened } = flat(
      [user('a'), calls('Looking', 'a', 'b'), result('a', 'ra'), result('b', 'rb')],
      [],
    );
    expect(flattened).toBe(2);
    expect(messages).toEqual([
      user('a'),
      { role: 'assistant', content: 'Looking\nassistant -> tool_a({})\nassistant -> tool_b({})' },
      { role: 'user', content: 'tool tool_a: ra\ntool tool_b: rb' },
    ]);
  });

  it('flattens a whole block when any call is undeclared, and only that block', () => {
    const { messages, flattened } = flat(
      [calls('', 'a', 'b'), result('a'), result('b'), calls('', 'c'), result('c')],
      ['tool_a', 'tool_c'],
    );
    expect(flattened).toBe(2);
    expect(labels(messages)).toEqual([
      'assistant:assistant -> tool_a({})\nassistant -> tool_b({})',
      'user:tool tool_a: result a\ntool tool_b: result b',
      'assistant[c]',
      'tool:c',
    ]);
  });

  it('flattens every block for a node without tools, and takes any iterable of declared names', () => {
    expect(flat([calls('', 'a'), result('a')], []).flattened).toBe(1);
    expect(flattenUndeclaredToolBlocks([calls('', 'a'), result('a')], new Set(['tool_a'])).flattened).toBe(0);
  });

  it('flattens a call nobody answered, with no user message, and leaves orphan results to the repair', () => {
    const { messages } = flat([calls('x', 'a'), result('zzz')], []);
    expect(messages).toEqual([{ role: 'assistant', content: 'x\nassistant -> tool_a({})' }, result('zzz')]);
  });

  it('drops provider_data with the calls, keeps the other fields, and does not change the input', () => {
    const message = { ...calls('', 'a'), reasoning: 'why', provider_data: { x: 1 }, name: 'Mira' };
    const input = [message, result('a')];
    const before = structuredClone(input);
    expect(flat(input, []).messages[0]).toEqual({
      role: 'assistant',
      content: 'assistant -> tool_a({})',
      reasoning: 'why',
      name: 'Mira',
    });
    expect(input).toEqual(before);
  });

  it('is repaired cleanly afterwards', () => {
    const { messages } = flat([user('a'), calls('', 'a'), result('a')], []);
    expect(repairToolSequence(messages).dropped).toBe(0);
  });
});

describe('repairToolSequence', () => {
  it.each([
    [
      'a clean list',
      [user('a'), calls('', 'a'), result('a'), user('b')],
      ['user:a', 'assistant[a]', 'tool:a', 'user:b'],
      0,
    ],
    ['no tools at all', [system('s'), user('a')], ['system:s', 'user:a'], 0],
    ['an orphan tool message at the start', [result('a'), user('x')], ['user:x'], 1],
    [
      'an orphan tool message at the end',
      [user('x'), calls('', 'a'), result('a'), result('b')],
      ['user:x', 'assistant[a]', 'tool:a'],
      1,
    ],
    [
      'a tool message after a plain assistant message',
      [{ role: 'assistant', content: 'hi' }, result('a')],
      ['assistant:hi'],
      1,
    ],
    ['a duplicate answer', [calls('', 'a'), result('a'), result('a')], ['assistant[a]', 'tool:a'], 1],
    [
      'a partial answer: the unanswered call goes',
      [calls('text', 'a', 'b'), result('b'), user('x')],
      ['assistant[b]', 'tool:b', 'user:x'],
      1,
    ],
    ['no answer, with content: the content stays', [calls('text', 'a'), user('x')], ['assistant:text', 'user:x'], 1],
    ['no answer, no content: the message goes', [calls('', 'a', 'b'), user('x')], ['user:x'], 1],
    [
      'an interleaved system message orphans the answer and the call',
      [calls('', 'a'), system('s'), result('a')],
      ['system:s'],
      2,
    ],
    ['an empty call list is removed', [{ role: 'assistant', content: 'x', tool_calls: [] }], ['assistant:x'], 0],
  ] as [string, ConversationMessage[], string[], number][])('%s', (_name, messages, expected, dropped) => {
    const repaired = repairToolSequence(messages);
    expect(labels(repaired.messages)).toEqual(expected);
    expect(repaired.dropped).toBe(dropped);
  });

  it('keeps untouched messages as they are and does not change the input', () => {
    const messages = [calls('text', 'a', 'b'), result('a'), user('x')];
    const before = structuredClone(messages);
    const repaired = repairToolSequence(messages);
    expect(messages).toEqual(before);
    expect(repaired.messages[1]).toBe(messages[1]);
    expect(repaired.messages[2]).toBe(messages[2]);
  });

  it('keeps the other fields of an assistant message that loses its calls', () => {
    const message = { ...calls('text', 'a'), reasoning: 'why', provider_data: { x: 1 } };
    expect(repairToolSequence([message]).messages).toEqual([
      { role: 'assistant', content: 'text', reasoning: 'why', provider_data: { x: 1 } },
    ]);
  });
});

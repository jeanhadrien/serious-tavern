import { describe, expect, it } from 'vitest';
import type { ConversationMessage } from './message.js';
import { threadAlone, weaveThread, type WeaveChatMessage, type WeaveInput, type WeaveItem } from './weave.js';

// Chat messages: `user('t1', 'hi')` is turn t1's question; `reply` is an assistant message of a run.
const user = (turn: string, content = `q ${turn}`): WeaveChatMessage => ({ role: 'user', content, executionId: turn });
const reply = (turn: string, run: string, source?: string, content = `reply ${run}`): WeaveChatMessage => ({
  role: 'assistant',
  content,
  executionId: turn,
  runId: run,
  ...(source !== undefined && { sourceNodeId: source }),
});

// An exchange of one LLM node: one tool step, then the final answer. Labels show up in the expectations.
const provenance = (nodeId: string) => ({ providerId: 'p', model: 'm', nodeId });
function exchange(label: string, node = 'llm', final = `final ${label}`): ConversationMessage[] {
  const call = { id: `c-${label}`, type: 'function' as const, function: { name: 'read_state', arguments: '{}' } };
  return [
    { role: 'assistant', content: '', tool_calls: [call], provenance: provenance(node) },
    { role: 'tool', content: `result ${label}`, tool_call_id: call.id },
    { role: 'assistant', content: final, provenance: provenance(node) },
  ];
}
const item = (turnId: string, runId: string, ex: ConversationMessage[] | undefined, text = 'text'): WeaveItem => ({
  text,
  turnId,
  runId,
  ...(ex && { exchange: ex }),
});

// `weave` on labels: role and content, or the tool-call marker for an assistant message that calls a tool.
const label = (message: { role: string; content: string; tool_calls?: unknown[] }) =>
  message.tool_calls?.length ? 'call' : `${message.role}: ${message.content}`;
const weave = (input: WeaveInput<WeaveChatMessage>) => weaveThread(input).map(label);

describe('weaveThread: the answer is in the chat', () => {
  const history = [user('t1'), reply('t1', 'r1', 'llm')];
  const items = [item('t1', 'r1', exchange('a'))];

  it('puts the tool blocks right before the reply and drops the exchange final answer', () => {
    expect(weave({ history, items, turnIds: ['t1'] })).toEqual([
      'user: q t1',
      'call',
      'tool: result a',
      'assistant: reply r1',
    ]);
  });

  it('keeps the chat reply when it was edited (the chat wins)', () => {
    const edited = [user('t1'), reply('t1', 'r1', 'llm', 'my own words')];
    expect(weave({ history: edited, items, turnIds: ['t1'] })).toEqual([
      'user: q t1',
      'call',
      'tool: result a',
      'assistant: my own words',
    ]);
  });

  it('adds nothing for an exchange with no tool step', () => {
    const plain = [item('t1', 'r1', exchange('a').slice(2))];
    expect(weave({ history, items: plain, turnIds: ['t1'] })).toEqual(['user: q t1', 'assistant: reply r1']);
  });

  it('keeps a whole exchange that ends without an answer', () => {
    const cut = [item('t1', 'r1', exchange('a').slice(0, 2))];
    expect(weave({ history, items: cut, turnIds: ['t1'] })).toEqual([
      'user: q t1',
      'call',
      'tool: result a',
      'assistant: reply r1',
    ]);
  });

  it('finds the reply among the replies of its run by the LLM node', () => {
    const two = [
      user('t1'),
      reply('t1', 'r1', undefined, 'other'),
      reply('t1', 'r1', 'llm'),
      reply('t1', 'r2', 'llm', 'later'),
    ];
    expect(weave({ history: two, items, turnIds: ['t1'] })).toEqual([
      'user: q t1',
      'assistant: other',
      'call',
      'tool: result a',
      'assistant: reply r1',
      'assistant: later',
    ]);
  });
});

describe('weaveThread: the answer is not in the chat', () => {
  const whole = ['call', 'tool: result a', 'assistant: final a'];

  it.each<[string, WeaveChatMessage[]]>([
    ['a templated output (no sourceNodeId)', [user('t1'), reply('t1', 'r1')]],
    ['another LLM node (sourceNodeId differs)', [user('t1'), reply('t1', 'r1', 'other')]],
    ['a scenarist in the after section (no reply of its run)', [user('t1'), reply('t1', 'r0', 'llm')]],
    ['a reply stored before sourceNodeId existed', [user('t1'), reply('t1', 'r1')]],
  ])("%s: the whole exchange goes after the turn's last chat message", (_, history) => {
    const result = weave({ history, items: [item('t1', 'r1', exchange('a'))], turnIds: ['t1'] });
    expect(result).toEqual([...history.map(label), ...whole]);
  });

  it('goes after the last message of its turn, before the next turn', () => {
    const history = [user('t1'), reply('t1', 'r0', 'llm'), user('t2'), reply('t2', 'r2', 'llm')];
    expect(weave({ history, items: [item('t1', 'r1', exchange('a'))], turnIds: ['t1', 't2'] })).toEqual([
      'user: q t1',
      'assistant: reply r0',
      ...whole,
      'user: q t2',
      'assistant: reply r2',
    ]);
  });

  it('goes after the turn user message when the turn has no reply', () => {
    const history = [user('t1'), reply('t1', 'r1', 'llm'), user('t2')];
    expect(weave({ history, items: [item('t2', 'r2', exchange('a'))], turnIds: ['t1', 't2'] })).toEqual([
      'user: q t1',
      'assistant: reply r1',
      'user: q t2',
      ...whole,
    ]);
  });

  it('does not match a reply of the same run on the same node when the exchange has no provenance', () => {
    const bare = exchange('a').map(({ provenance: _provenance, ...message }) => message);
    expect(
      weave({ history: [user('t1'), reply('t1', 'r1', 'llm')], items: [item('t1', 'r1', bare)], turnIds: ['t1'] }),
    ).toEqual(['user: q t1', 'assistant: reply r1', ...whole]);
  });
});

describe('weaveThread: turns without messages and cut histories', () => {
  it('puts the items of a reply-less turn after the nearest earlier turn present in the history', () => {
    const history = [user('t1'), reply('t1', 'r1', 'llm'), user('t3'), reply('t3', 'r3', 'llm')];
    const items = [item('t2', 'r2', exchange('b', 'scribe'))];
    expect(weave({ history, items, turnIds: ['t1', 't2', 't3'] })).toEqual([
      'user: q t1',
      'assistant: reply r1',
      'call',
      'tool: result b',
      'assistant: final b',
      'user: q t3',
      'assistant: reply r3',
    ]);
  });

  it('skips a missing earlier turn to the one before it', () => {
    const history = [user('t1'), reply('t1', 'r1'), user('t4')];
    const items = [item('t3', 'r3', undefined, 'plain')];
    expect(weave({ history, items, turnIds: ['t1', 't2', 't3', 't4'] })).toEqual([
      'user: q t1',
      'assistant: reply r1',
      'assistant: plain',
      'user: q t4',
    ]);
  });

  it('leaves out the items older than the whole history (a history cut by lastN)', () => {
    const history = [user('t3'), reply('t3', 'r3', 'llm')];
    const items = [item('t1', 'r1', exchange('a')), item('t2', 'r2', exchange('b')), item('t3', 'r3', exchange('c'))];
    expect(weave({ history, items, turnIds: ['t1', 't2', 't3'] })).toEqual([
      'user: q t3',
      'call',
      'tool: result c',
      'assistant: reply r3',
    ]);
  });

  it('keeps the items of a turn cut in the middle whose reply is left', () => {
    const history = [reply('t3', 'r3', 'llm')];
    expect(weave({ history, items: [item('t3', 'r3', exchange('c'))], turnIds: ['t3'] })).toEqual([
      'call',
      'tool: result c',
      'assistant: reply r3',
    ]);
  });

  it('leaves out an item of a turn it does not know', () => {
    const history = [user('t1'), reply('t1', 'r1')];
    expect(weave({ history, items: [item('gone', 'rx', exchange('a'))], turnIds: ['t1'] })).toEqual(history.map(label));
  });
});

describe('weaveThread: several items', () => {
  it('keeps the write order of several items of one turn', () => {
    const history = [user('t1'), reply('t1', 'r1')];
    const items = [item('t1', 'r1', exchange('a', 'one')), item('t1', 'r1', exchange('b', 'two'))];
    expect(weave({ history, items, turnIds: ['t1'] })).toEqual([
      'user: q t1',
      'assistant: reply r1',
      'call',
      'tool: result a',
      'assistant: final a',
      'call',
      'tool: result b',
      'assistant: final b',
    ]);
  });

  it('gives each LLM node of one run its own reply', () => {
    const history = [user('t1'), reply('t1', 'r1', 'one', 'first'), reply('t1', 'r1', 'two', 'second')];
    const items = [item('t1', 'r1', exchange('a', 'one')), item('t1', 'r1', exchange('b', 'two'))];
    expect(weave({ history, items, turnIds: ['t1'] })).toEqual([
      'user: q t1',
      'call',
      'tool: result a',
      'assistant: first',
      'call',
      'tool: result b',
      'assistant: second',
    ]);
  });

  it('mixes items woven before a reply and items after the turn', () => {
    const history = [user('t1'), reply('t1', 'r1', 'one')];
    const items = [item('t1', 'r1', exchange('a', 'one')), item('t1', 'r2', exchange('b', 'scribe'))];
    expect(weave({ history, items, turnIds: ['t1'] })).toEqual([
      'user: q t1',
      'call',
      'tool: result a',
      'assistant: reply r1',
      'call',
      'tool: result b',
      'assistant: final b',
    ]);
  });
});

describe('weaveThread: older chats and alternatives', () => {
  it('leaves messages without a turn where they are and puts nothing near them', () => {
    const old: WeaveChatMessage[] = [
      { role: 'user', content: 'old q' },
      { role: 'assistant', content: 'old a' },
    ];
    const history = [...old, user('t1'), reply('t1', 'r1', 'llm')];
    expect(weave({ history, items: [item('t1', 'r1', exchange('a'))], turnIds: ['t1'] })).toEqual([
      'user: old q',
      'assistant: old a',
      'user: q t1',
      'call',
      'tool: result a',
      'assistant: reply r1',
    ]);
  });

  it('leaves out an item whose turn only has legacy messages without a turn', () => {
    const history: WeaveChatMessage[] = [
      { role: 'user', content: 'old q' },
      { role: 'assistant', content: 'old a' },
    ];
    expect(weave({ history, items: [item('t1', 'r1', exchange('a'))], turnIds: ['t1'] })).toEqual(history.map(label));
  });

  it('weaves a regenerated turn: its user message keeps the root turn id, its reply the new one', () => {
    // The root alternative is hidden: only the shown one's items exist. Its user message carries the root's id.
    const history = [user('root'), reply('alt', 'r-alt', 'llm', 'second try')];
    const items = [item('alt', 'r-alt', exchange('b'))];
    expect(weave({ history, items, turnIds: ['alt'] })).toEqual([
      'user: q root',
      'call',
      'tool: result b',
      'assistant: second try',
    ]);
  });

  it('is the history itself without items', () => {
    const history = [user('t1'), reply('t1', 'r1', 'llm')];
    const woven = weaveThread({ history, items: [], turnIds: ['t1'] });
    expect(woven).toEqual(history);
    expect(woven[0]).toBe(history[0]);
  });
});

describe('weaveThread: plain items', () => {
  it('is one assistant message holding the text, after the turn', () => {
    const history = [user('t1'), reply('t1', 'r1', 'llm'), user('t2')];
    const items = [item('t1', 'r1', undefined, 'a note'), item('t1', 'r1', [], 'another')];
    expect(weave({ history, items, turnIds: ['t1', 't2'] })).toEqual([
      'user: q t1',
      'assistant: reply r1',
      'assistant: a note',
      'assistant: another',
      'user: q t2',
    ]);
  });

  it('drops a plain item with no text', () => {
    const history = [user('t1')];
    expect(weave({ history, items: [item('t1', 'r1', undefined, '')], turnIds: ['t1'] })).toEqual(['user: q t1']);
  });
});

describe('weaveThread: the running turn', () => {
  it('goes after the history last message when the turn has no message in it', () => {
    const history = [user('t1'), reply('t1', 'r1', 'llm')];
    const items = [item('run', 'r2', exchange('a', 'scribe'))];
    expect(weave({ history, items, turnIds: ['t1'], runningTurnId: 'run' })).toEqual([
      'user: q t1',
      'assistant: reply r1',
      'call',
      'tool: result a',
      'assistant: final a',
    ]);
  });

  it('goes first in an empty history', () => {
    expect(
      weave({ history: [], items: [item('run', 'r1', undefined, 'note')], turnIds: [], runningTurnId: 'run' }),
    ).toEqual(['assistant: note']);
  });

  it('is ordered after the older turns whether or not turnIds holds it', () => {
    const history = [user('t1'), reply('t1', 'r1', 'llm')];
    const items = [item('t1', 'r1', exchange('a', 'scribe')), item('run', 'r2', exchange('b', 'scribe'))];
    for (const turnIds of [['t1'], ['t1', 'run']])
      expect(weave({ history, items, turnIds, runningTurnId: 'run' })).toEqual([
        'user: q t1',
        'assistant: reply r1',
        'call',
        'tool: result a',
        'assistant: final a',
        'call',
        'tool: result b',
        'assistant: final b',
      ]);
  });

  it('finds the answer in the chat when an earlier run of the turn replied', () => {
    const history = [user('run'), reply('run', 'r1', 'llm')];
    const items = [item('run', 'r1', exchange('a'))];
    expect(weave({ history, items, turnIds: [], runningTurnId: 'run' })).toEqual([
      'user: q run',
      'call',
      'tool: result a',
      'assistant: reply r1',
    ]);
  });
});

describe('weaveThread: the input is the chat', () => {
  it('never uses an item input', () => {
    const history = [user('t1'), reply('t1', 'r1')];
    const withInput = { ...item('t1', 'r1', exchange('a')), input: { role: 'user' as const, content: 'asked' } };
    expect(weave({ history, items: [withInput], turnIds: ['t1'] })).not.toContain('user: asked');
  });
});

describe('threadAlone', () => {
  const asked = { role: 'user' as const, content: 'asked' };
  const items = [
    { ...item('t1', 'r1', exchange('a')), input: asked },
    item('t2', 'r2', undefined, 'a note'),
    item('t3', 'r3', [], ''),
  ];

  it('is each input then each exchange, a plain item as one assistant message', () => {
    expect(threadAlone(items, { withInputs: true }).map(label)).toEqual([
      'user: asked',
      'call',
      'tool: result a',
      'assistant: final a',
      'assistant: a note',
    ]);
  });

  it('leaves the inputs out when asked', () => {
    expect(threadAlone(items, { withInputs: false }).map(label)).toEqual([
      'call',
      'tool: result a',
      'assistant: final a',
      'assistant: a note',
    ]);
  });
});

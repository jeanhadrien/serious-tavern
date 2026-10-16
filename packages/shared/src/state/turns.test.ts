import { describe, expect, it } from 'vitest';
import { sessionUsesDefinition, turnPresence } from './turns.js';
import { addWrite, DEF, deleteWrite, reply, setWrite, turnEntry, userMessage } from './test-fixtures.js';

const OTHER = '22222222-2222-4222-8222-222222222222';

describe('turnPresence', () => {
  it.each<[string, Parameters<typeof turnPresence>[0], Partial<Parameters<typeof turnEntry>[2]>, number | null]>([
    ['a final reply', [reply('t1', 'final')], {}, 1],
    ['a partial reply (stopped halfway)', [reply('t1', 'partial')], {}, 1],
    ['a reply without a status (non-streaming send)', [reply('t1')], {}, 1],
    ['only a reply that is still streaming', [reply('t1', 'streaming')], {}, null],
    ['a streaming and a final reply', [reply('t1', 'streaming'), reply('t1', 'final')], {}, 1],
    ['only the user message of the turn', [userMessage('t1')], {}, null],
    ['the user message and a final reply', [userMessage('t1'), reply('t1', 'final')], {}, 1],
    ['a reply of another execution', [reply('t2', 'final')], {}, null],
    ['no messages at all', [], {}, null],
    ['no reply made and the run completed', [], { replies: 0, completed: true }, 1],
    ['no reply made and the run did not complete', [], { replies: 0, completed: false }, null],
    ['no reply made, completed, although a stray user row exists', [userMessage('t1')], { replies: 0 }, 1],
    ['replies made but all deleted, although completed', [userMessage('t1')], { replies: 2, completed: true }, null],
    ['two replies made and one deleted', [reply('t1', 'final')], { replies: 2 }, 1],
    ['a failed run that kept a partial reply', [reply('t1', 'partial')], { completed: false }, 1],
    ['a failed run whose partial reply was deleted', [], { completed: false }, null],
  ])('%s', (_, messages, over, expected) => {
    expect(turnPresence(messages, [turnEntry('t1', [], over)]).map(({ turn }) => turn)).toEqual([expected]);
  });

  it('numbers the present turns 1..n in stored order and leaves gaps as null', () => {
    const entries = [
      turnEntry('a'),
      turnEntry('b'),
      turnEntry('c', [], { replies: 0, completed: false }),
      turnEntry('d'),
      turnEntry('e', [], { replies: 0 }),
    ];
    const messages = [reply('a', 'final'), reply('d', 'final')];
    expect(turnPresence(messages, entries).map(({ entry, turn }) => [entry.executionId, turn])).toEqual([
      ['a', 1],
      ['b', null],
      ['c', null],
      ['d', 2],
      ['e', 3],
    ]);
  });

  it('is empty without entries and keeps the entry objects', () => {
    expect(turnPresence([reply('a')], [])).toEqual([]);
    const entry = turnEntry('a');
    expect(turnPresence([reply('a')], [entry])[0]?.entry).toBe(entry);
  });
});

describe('sessionUsesDefinition', () => {
  const state = {
    turns: [
      turnEntry('a', [setWrite('n', 1)]),
      turnEntry('b', [addWrite('log', { id: 'i', text: 'x' }, OTHER), deleteWrite('n', OTHER)]),
      turnEntry('c', [setWrite('n', 2)], { replies: 0, completed: false }),
    ],
  };

  it('is true when a present turn writes the definition', () => {
    expect(sessionUsesDefinition({ messages: [reply('a', 'final')], state }, DEF)).toBe(true);
    expect(sessionUsesDefinition({ messages: [reply('b', 'final')], state }, OTHER)).toBe(true);
  });

  it('ignores turns that are no longer present', () => {
    expect(sessionUsesDefinition({ messages: [], state }, DEF)).toBe(false);
    expect(sessionUsesDefinition({ messages: [userMessage('a')], state }, DEF)).toBe(false);
    // Turn c never completed and made no reply.
    expect(sessionUsesDefinition({ messages: [reply('b', 'final')], state }, DEF)).toBe(false);
  });

  it('is false for a definition no turn wrote, and for sessions without readable state', () => {
    expect(sessionUsesDefinition({ messages: [reply('a', 'final')], state }, 'nope')).toBe(false);
    for (const garbage of [undefined, null, 'x', 5, [], { turns: {} }, { turns: ['x'] }])
      expect(sessionUsesDefinition({ messages: [reply('a')], state: garbage }, DEF)).toBe(false);
  });

  it('ignores writes of node targets', () => {
    const nodeOnly = {
      turns: [turnEntry('a', [{ ...setWrite('n', 1), target: { kind: 'node', nodeId: DEF, key: 'n' } }])],
    };
    expect(sessionUsesDefinition({ messages: [reply('a')], state: nodeOnly }, DEF)).toBe(false);
  });
});

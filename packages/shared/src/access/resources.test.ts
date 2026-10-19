import { describe, expect, it } from 'vitest';
import {
  describeResource,
  everythingAccess,
  mergeAccess,
  noAccess,
  overlaps,
  predecessors,
  simplify,
  waitReason,
  type Access,
  type Resource,
} from './resources.js';

const key = (definitionId: string, name: string): Resource => ({ kind: 'key', definitionId, key: name });
const definition = (definitionId: string): Resource => ({ kind: 'definition', definitionId });
const state: Resource = { kind: 'state' };
const messages: Resource = { kind: 'messages' };
const everything: Resource = { kind: 'everything' };

describe('overlaps', () => {
  const table: [string, Resource, Resource, boolean][] = [
    ['the same key', key('d', 'n'), key('d', 'n'), true],
    ['two keys of one definition', key('d', 'n'), key('d', 'mood'), false],
    ['the same key name of two definitions', key('d', 'n'), key('e', 'n'), false],
    ['a key and its definition', key('d', 'n'), definition('d'), true],
    ['a key and another definition', key('d', 'n'), definition('e'), false],
    ['two definitions', definition('d'), definition('d'), true],
    ['two other definitions', definition('d'), definition('e'), false],
    ['a key and all the state', key('d', 'n'), state, true],
    ['a definition and all the state', definition('d'), state, true],
    ['the messages and themselves', messages, messages, true],
    ['the messages and a key', messages, key('d', 'n'), false],
    ['the messages and a definition', messages, definition('d'), false],
    ['the messages and all the state', messages, state, false],
    ['everything and the messages', everything, messages, true],
    ['everything and a key', everything, key('d', 'n'), true],
    ['everything and the state', everything, state, true],
    ['everything and everything', everything, everything, true],
  ];
  it.each(table)('%s', (_name, a, b, expected) => {
    expect(overlaps(a, b)).toBe(expected);
    // Overlapping is the same from either side.
    expect(overlaps(b, a)).toBe(expected);
  });
});

describe('simplify and mergeAccess', () => {
  it('drops what a wider resource contains, and repeats', () => {
    expect(simplify([key('d', 'n'), definition('d'), key('e', 'n'), key('e', 'n'), messages, messages])).toEqual([
      definition('d'),
      key('e', 'n'),
      messages,
    ]);
    expect(simplify([key('d', 'n'), definition('d'), state, messages])).toEqual([state, messages]);
    expect(simplify([messages, key('d', 'n'), everything])).toEqual([everything]);
    expect(simplify([])).toEqual([]);
  });

  it('is the union of the accesses', () => {
    const merged = mergeAccess(
      { reads: [key('d', 'n')], writes: [messages] },
      { reads: [key('d', 'n'), key('d', 'mood')], writes: [] },
      noAccess(),
    );
    expect(merged).toEqual({ reads: [key('d', 'n'), key('d', 'mood')], writes: [messages] });
    expect(mergeAccess(everythingAccess(), { reads: [messages], writes: [key('d', 'n')] })).toEqual(everythingAccess());
    expect(mergeAccess()).toEqual(noAccess());
  });
});

describe('waiting', () => {
  const access = (reads: Resource[], writes: Resource[]): Access => ({ reads, writes });

  it('waits for the earlier runs whose writes overlap what a run reads, and for nothing else', () => {
    const runs = [
      access([], [messages]), // 0: replies
      access([messages], []), // 1: reads the chat
      access([key('d', 'n')], [key('d', 'n')]), // 2: increments n
      access([], [key('d', 'n')]), // 3: sets n, reads nothing
      access([key('d', 'n')], []), // 4: reads n
      access([key('d', 'mood')], []), // 5: reads another key
      access([], [messages]), // 6: replies too
    ];
    expect(predecessors(runs)).toEqual([[], [0], [], [], [2, 3], [], []]);
  });

  it('never waits for a run listed below, and read-only overlap orders nothing', () => {
    expect(predecessors([access([key('d', 'n')], []), access([], [key('d', 'n')])])).toEqual([[], []]);
    expect(predecessors([access([key('d', 'n')], []), access([key('d', 'n')], [])])).toEqual([[], []]);
    expect(predecessors([])).toEqual([]);
  });

  it('makes a run that does everything wait for every earlier writer, and every later reader wait for it', () => {
    const runs = [access([], [messages]), access([], [key('d', 'n')]), everythingAccess(), access([messages], [])];
    expect(predecessors(runs)).toEqual([[], [], [0, 1], [0, 2]]);
  });

  it('names the first write that makes a run wait', () => {
    expect(waitReason(access([], [key('d', 'n')]), access([definition('d')], []))).toEqual({
      write: key('d', 'n'),
      read: definition('d'),
    });
    expect(waitReason(access([], [messages]), access([key('d', 'n')], []))).toBeUndefined();
  });
});

describe('describeResource', () => {
  const definitions = [{ id: 'd', name: 'scene' }];
  it('names a resource in words', () => {
    expect(describeResource(key('d', 'tension'), definitions)).toBe('scene.tension');
    expect(describeResource(definition('d'), definitions)).toBe('everything in scene');
    expect(describeResource(key('gone', 'n'), definitions)).toBe('gone.n');
    expect(describeResource(state, definitions)).toBe('the story state');
    expect(describeResource(messages, definitions)).toBe('the chat history');
    expect(describeResource(everything, definitions)).toBe('everything');
  });
});

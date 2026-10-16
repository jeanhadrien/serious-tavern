import { describe, expect, it } from 'vitest';
import type { Collection, StateKeyView } from '@st/shared';
import type { Candidate } from './collections.js';
import { draw } from './nodes/draw/index.js';
import { entryKey, memoryText, recentEntryKeys } from './nodes/draw/recent.js';
import { collection, edge, graph, node, resourcesWith, runNode } from './test-collections.js';
import { deleteReplies, newChat, playTurn, snapshotOf } from './test-state.js';

const candidate = (collectionId: string, text: string, index = 0): Candidate => ({
  collectionId,
  index,
  entry: { text, weight: 1, enabled: true },
});
const view = (value: unknown, itemTurns?: number[]): StateKeyView => ({
  value,
  itemTurns,
  meta: { written: true, turnsSinceWrite: 1, writtenAtTurn: 1 },
});
const drawn = (entryKey_: string) => ({ id: entryKey_, text: 'x', entryKey: entryKey_ });

describe('entryKey', () => {
  it('is the collection and a fingerprint of the trimmed text', () => {
    expect(entryKey(candidate('c', 'A storm'))).toMatch(/^c:[0-9a-f]{16}$/);
    expect(entryKey(candidate('c', '  A storm \n'))).toBe(entryKey(candidate('c', 'A storm')));
  });

  it('does not depend on the position, which shifts when entries are reordered or removed', () => {
    expect(entryKey(candidate('c', 'A storm', 0))).toBe(entryKey(candidate('c', 'A storm', 7)));
  });

  it('differs between collections and between texts', () => {
    const base = entryKey(candidate('c', 'A storm'));
    expect(entryKey(candidate('other', 'A storm'))).not.toBe(base);
    expect(entryKey(candidate('c', 'A storm!'))).not.toBe(base);
    expect(entryKey(candidate('c', 'a storm'))).not.toBe(base);
  });
});

describe('memoryText', () => {
  it('keeps short text, trimmed, and the first 80 characters of long text', () => {
    expect(memoryText('  A storm \n')).toBe('A storm');
    expect(memoryText('')).toBe('');
    expect(memoryText('x'.repeat(80))).toBe('x'.repeat(80));
    expect(memoryText('x'.repeat(81))).toBe('x'.repeat(80));
    expect(memoryText(`${'ab'.repeat(300)}`)).toBe('ab'.repeat(40));
  });

  it('cuts whole characters, never half of an emoji', () => {
    const cut = memoryText('😀'.repeat(200));
    expect([...cut]).toHaveLength(80);
    expect(cut).toBe('😀'.repeat(80));
    // An emoji straddling the cut-off in UTF-16 units: 79 plain characters, then one emoji.
    expect(memoryText(`${'x'.repeat(79)}😀tail`)).toBe(`${'x'.repeat(79)}😀`);
    expect(memoryText(`${'x'.repeat(80)}😀tail`)).toBe('x'.repeat(80));
  });
});

describe('recentEntryKeys', () => {
  // Items newest first, drawn in turns 5, 4, 2.
  const memory = view([drawn('a'), drawn('b'), drawn('c')], [5, 4, 2]);

  it.each([
    // [turn being run, avoidRecent, recent keys]
    [6, 1, ['a']],
    [6, 2, ['a', 'b']],
    [6, 3, ['a', 'b']],
    [6, 4, ['a', 'b', 'c']],
    [7, 1, []],
    [7, 2, ['a']],
    [5, 1, ['a', 'b']],
    [5, 3, ['a', 'b', 'c']],
    [100, 3, []],
  ])('turn %s, window %s: %j', (turn, window, expected) => {
    expect([...recentEntryKeys(memory, turn, window)].sort()).toEqual(expected);
  });

  it('is empty without memory', () => {
    expect(recentEntryKeys(undefined, 3, 2).size).toBe(0);
    expect(recentEntryKeys(view([]), 3, 2).size).toBe(0);
    expect(recentEntryKeys(view('not a list', [1]), 3, 2).size).toBe(0);
  });

  it('ignores items without a turn or without an entry key', () => {
    expect(recentEntryKeys(view([drawn('a'), drawn('b')]), 3, 5).size).toBe(0);
    expect([...recentEntryKeys(view([drawn('a'), { id: 'x', text: 'x' }, null, drawn('b')], [2, 2, 2]), 3, 5)]).toEqual(
      ['a'],
    );
  });
});

describe('Draw avoidRecent config', () => {
  it('is off by default and takes a whole number from 0', () => {
    expect(draw.configSchema.parse({ collectionIds: ['a'] })).toMatchObject({ avoidRecent: 0 });
    expect(draw.defaultConfig.avoidRecent).toBe(0);
    for (const value of [0, 1, 12])
      expect(draw.configSchema.safeParse({ collectionIds: ['a'], avoidRecent: value }).success).toBe(true);
    for (const value of [-1, 1.5, '2'])
      expect(draw.configSchema.safeParse({ collectionIds: ['a'], avoidRecent: value }).success).toBe(false);
  });
});

describe('Draw avoidRecent in a node', () => {
  const deck = collection('deck', [{ text: 'storm' }, { text: 'fog' }, { text: 'calm' }]);
  const resources = resourcesWith(deck);
  const keyOf = (text: string) => entryKey(candidate('deck', text));
  const config = (extra: Record<string, unknown> = {}) => ({ collectionIds: ['deck'], avoidRecent: 2, ...extra });
  const remembering = (turn: number, ...recent: Array<[text: string, drawnAt: number]>) =>
    snapshotOf([], {
      turn,
      nodes: {
        draw: {
          draws: view(
            recent.map(([text]) => ({ id: text, text, entryKey: keyOf(text) })),
            recent.map(([, at]) => at),
          ),
        },
      },
    });

  it('leaves out the entries drawn within the window and says how many', async () => {
    const result = await runNode(draw, config(), {
      resources,
      state: remembering(5, ['storm', 4], ['fog', 2]),
      draws: [0],
    });
    // Storm (turn 4) is recent, fog (turn 2, three turns ago) is not.
    expect(result.output.text).toBe('fog');
    expect(result.output.reason).toBe('drew 1 of 2 eligible (1 recent excluded)');
  });

  it('remembers what it drew under its own key, with the entry text and key', async () => {
    const result = await runNode(draw, config(), { resources, state: remembering(5), draws: [0] });
    expect(result.writes).toEqual([
      {
        op: 'add',
        target: { kind: 'node', nodeId: 'draw', key: 'draws' },
        nodeId: 'draw',
        item: { id: 'run:draw:1', text: 'storm', entryKey: keyOf('storm') },
      },
    ]);
  });

  it('remembers only the start of a long entry, under the key of its whole text', async () => {
    const long = `${'The storm rolls in over the harbour. '.repeat(20)}`.trim();
    const longDeck = resourcesWith(collection('deck', [{ text: long }]));
    const result = await runNode(draw, config(), { resources: longDeck, state: remembering(5), draws: [0] });
    const write = result.writes[0]!;
    if (write.op !== 'add') throw new Error('expected an add');
    expect(write.item.text).toBe(long.slice(0, 80));
    expect((write.item.text as string).length).toBe(80);
    expect(write.item.entryKey).toBe(keyOf(long));
    // The output is the whole entry: only the memory is short.
    expect(result.output.text).toBe(long);
  });

  it('draws nothing when every eligible entry is recent', async () => {
    const result = await runNode(draw, config({ avoidRecent: 3 }), {
      resources,
      state: remembering(5, ['storm', 4], ['fog', 3], ['calm', 2]),
    });
    expect(result.output).toEqual({
      entries: [],
      reason: 'no eligible entry among 3 (3 recent excluded)',
    });
    expect(result.writes).toEqual([]);
    expect(result.drawn).toBe(0);
  });

  it('does not count entries the filters already removed as recent', async () => {
    const tagged = collection('deck', [{ text: 'storm', tags: ['sea'] }, { text: 'fog' }]);
    const result = await runNode(draw, config({ requireTags: ['sea'] }), {
      resources: resourcesWith(tagged),
      state: remembering(5, ['fog', 4]),
      draws: [0],
    });
    expect(result.output.reason).toBe('drew 1 of 1 eligible (tags: sea)');
  });

  it('writes one item per drawn entry when it draws several', async () => {
    const result = await runNode(draw, config({ count: 2 }), { resources, state: remembering(5), draws: [0, 0] });
    expect(result.writes.map((write) => write.op === 'add' && [write.item.id, write.item.text])).toEqual([
      ['run:draw:1', 'storm'],
      ['run:draw:2', 'fog'],
    ]);
  });

  it('reads and writes nothing when it is off', async () => {
    const result = await runNode(draw, config({ avoidRecent: 0 }), {
      resources,
      // Even with a memory, off means off.
      state: remembering(5, ['storm', 4]),
      draws: [0],
    });
    expect(result.output.text).toBe('storm');
    expect(result.output.reason).toBe('drew 1 of 3 eligible');
    expect(result.writes).toEqual([]);
    const without = await runNode(draw, { collectionIds: ['deck'] }, { resources, draws: [0] });
    expect(without.writes).toEqual([]);
  });

  it('works without any story state: nothing is recent, the draw is still remembered', async () => {
    const result = await runNode(draw, config(), { resources, draws: [0] });
    expect(result.output.text).toBe('storm');
    expect(result.writes).toHaveLength(1);
  });
});

describe('Draw avoidRecent across turns', () => {
  const entries = (...texts: string[]): Collection =>
    collection(
      'deck',
      texts.map((text) => ({ text })),
    );
  const drawing = (extra: Record<string, unknown> = {}, nodeId = 'pick') =>
    graph(
      [
        node('input', 'chat-input'),
        node(nodeId, 'draw', { collectionIds: ['deck'], avoidRecent: 1, ...extra }),
        node('output', 'chat-output'),
      ],
      [edge(nodeId, 'reason', 'output', 'value')],
    );
  const chatOf = (deck: () => Collection) =>
    newChat([], { collections: { get: async (id: string) => (id === 'deck' ? deck() : undefined) } });
  const reply = (result: { replies: Array<{ content: string }> }) => result.replies[0]!.content;

  it('skips the entry drawn last turn, and allows it again once the window has passed', async () => {
    const chat = chatOf(() => entries('storm'));
    const wf = drawing();
    expect(reply(await playTurn(chat, wf, 'e1'))).toBe('drew 1 of 1 eligible');
    expect(reply(await playTurn(chat, wf, 'e2'))).toBe('no eligible entry among 1 (1 recent excluded)');
    // Turn 3 is two turns after the draw, outside a window of 1.
    expect(reply(await playTurn(chat, wf, 'e3'))).toBe('drew 1 of 1 eligible');
    expect(reply(await playTurn(chat, wf, 'e4'))).toBe('no eligible entry among 1 (1 recent excluded)');
  });

  it('forgets a draw when the reply of its turn is deleted, even a later one', async () => {
    const chat = chatOf(() => entries('storm'));
    const wf = drawing();
    await playTurn(chat, wf, 'e1');
    await playTurn(chat, wf, 'e2');
    await playTurn(chat, wf, 'e3');
    deleteReplies(chat, 'e3');
    // Without the deletion the entry would be recent (drawn in turn 3, now turn 4).
    expect(reply(await playTurn(chat, wf, 'e4'))).toBe('drew 1 of 1 eligible');
  });

  it('forgets the draw when its own reply is deleted', async () => {
    const chat = chatOf(() => entries('storm'));
    const wf = drawing();
    await playTurn(chat, wf, 'e1');
    deleteReplies(chat, 'e1');
    expect(reply(await playTurn(chat, wf, 'e2'))).toBe('drew 1 of 1 eligible');
  });

  it('alternates between two entries whatever the seed', async () => {
    const chat = chatOf(() => entries('storm', 'fog'));
    const wf = graph(
      [
        node('input', 'chat-input'),
        node('pick', 'draw', { collectionIds: ['deck'], avoidRecent: 1 }),
        node('output', 'chat-output', { order: 0 }),
        node('why', 'chat-output', { order: 1 }),
      ],
      [edge('pick', 'text', 'output', 'value'), edge('pick', 'reason', 'why', 'value')],
    );
    const rows: string[][] = [];
    for (let turn = 1; turn <= 6; turn++)
      rows.push((await playTurn(chat, wf, `e${turn}`)).replies.map((item) => item.content));
    // Whatever the seed: the first turn has both entries to choose from, every later one only the other.
    expect(rows.map(([, why]) => why)).toEqual([
      'drew 1 of 2 eligible',
      ...Array(5).fill('drew 1 of 1 eligible (1 recent excluded)'),
    ]);
    const texts = rows.map(([text]) => text!);
    for (let turn = 1; turn < texts.length; turn++) expect(texts[turn]).not.toBe(texts[turn - 1]);
    expect(new Set(texts)).toEqual(new Set(['storm', 'fog']));
  });

  it('skips a long entry although only its start is remembered', async () => {
    const long = 'The storm rolls in over the harbour. '.repeat(20).trim();
    const chat = chatOf(() => entries(long));
    const wf = drawing();
    const first = await playTurn(chat, wf, 'e1');
    expect(reply(first)).toBe('drew 1 of 1 eligible');
    const remembered = first.writes[0]!;
    expect(remembered.op === 'add' && (remembered.item.text as string).length).toBe(80);
    expect(reply(await playTurn(chat, wf, 'e2'))).toBe('no eligible entry among 1 (1 recent excluded)');
  });

  it('identifies an entry by its text, so editing it makes it eligible again', async () => {
    let text = 'storm';
    const chat = chatOf(() => entries(text));
    const wf = drawing();
    await playTurn(chat, wf, 'e1');
    text = 'a different storm';
    expect(reply(await playTurn(chat, wf, 'e2'))).toBe('drew 1 of 1 eligible');
  });

  it('still skips an entry that moved to another position', async () => {
    let list = ['storm'];
    const chat = chatOf(() => entries(...list));
    const wf = drawing();
    await playTurn(chat, wf, 'e1');
    // Entry ids are positions: storm is now entry-2, but it is the same entry.
    list = ['new', 'storm'];
    expect(reply(await playTurn(chat, wf, 'e2'))).toBe('drew 1 of 1 eligible (1 recent excluded)');
  });

  it('keeps one memory per Draw node', async () => {
    const chat = chatOf(() => entries('storm'));
    const wf = graph(
      [
        node('input', 'chat-input'),
        node('one', 'draw', { collectionIds: ['deck'], avoidRecent: 1 }),
        node('two', 'draw', { collectionIds: ['deck'], avoidRecent: 0 }),
        node('out-one', 'chat-output', { order: 0 }),
        node('out-two', 'chat-output', { order: 1 }),
      ],
      [edge('one', 'reason', 'out-one', 'value'), edge('two', 'reason', 'out-two', 'value')],
    );
    const first = await playTurn(chat, wf, 'e1');
    expect(first.replies.map((item) => item.content)).toEqual(['drew 1 of 1 eligible', 'drew 1 of 1 eligible']);
    // `two` is off and wrote nothing; `one` has its own memory and now skips the entry.
    expect(first.writes.map((write) => write.nodeId)).toEqual(['one']);
    const second = await playTurn(chat, wf, 'e2');
    expect(second.replies.map((item) => item.content)).toEqual([
      'no eligible entry among 1 (1 recent excluded)',
      'drew 1 of 1 eligible',
    ]);
  });

  it('two Draw nodes that both avoid repeats do not share what they drew', async () => {
    const chat = chatOf(() => entries('storm', 'fog'));
    const wf = graph(
      [
        node('input', 'chat-input'),
        node('one', 'draw', { collectionIds: ['deck'], avoidRecent: 1, count: 2 }),
        node('two', 'draw', { collectionIds: ['deck'], avoidRecent: 1 }),
        node('out-one', 'chat-output', { order: 0 }),
        node('out-two', 'chat-output', { order: 1 }),
      ],
      [edge('one', 'reason', 'out-one', 'value'), edge('two', 'reason', 'out-two', 'value')],
    );
    const first = await playTurn(chat, wf, 'e1');
    // `one` drew both entries; `two` is not limited by that and drew one.
    expect(first.replies.map((item) => item.content)).toEqual(['drew 2 of 2 eligible', 'drew 1 of 2 eligible']);
    expect(first.writes.map((write) => write.nodeId)).toEqual(['one', 'one', 'two']);
    const second = await playTurn(chat, wf, 'e2');
    expect(second.replies.map((item) => item.content)).toEqual([
      'no eligible entry among 2 (2 recent excluded)',
      'drew 1 of 1 eligible (1 recent excluded)',
    ]);
  });
});

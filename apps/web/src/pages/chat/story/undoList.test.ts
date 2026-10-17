import { describe, expect, it } from 'vitest';
import type { ChatMessage, StateDefinition, StateWrite } from '@st/shared';
import { addWrite, buildView, drawWrite, entry, removeWrite, reply, scene, setWrite, userMessage } from './fixtures.js';
import { deleteConfirmText, undoneByDelete } from './undoList.js';

/** A chat of `turns` (the writes of each), every turn with one user message and one reply `m-e<n>`. */
function chat(turns: StateWrite[][], definitions: StateDefinition[] = [scene]) {
  const messages: ChatMessage[] = turns.flatMap((_, i) => [userMessage(`u${i + 1}`), reply(`e${i + 1}`)]);
  const entries = turns.map((writes, i) => entry(`e${i + 1}`, writes));
  const view = buildView({ definitions, messages, entries });
  const undo = (messageId: string, over: { messages?: ChatMessage[]; definitions?: StateDefinition[] } = {}) =>
    undoneByDelete({
      messageId,
      messages: over.messages ?? messages,
      view,
      definitions: over.definitions ?? definitions,
    });
  return { messages, view, undo };
}

describe('scalars', () => {
  it('goes back to the value before the turn', () => {
    const { undo } = chat([[setWrite('tension', 4)], [setWrite('tension', 6)]]);
    expect(undo('m-e2')).toEqual(['scene.tension (back to 4)']);
  });

  it('lists nothing when a later turn overwrote what the reply stored', () => {
    const { undo } = chat([[setWrite('tension', 4)], [setWrite('tension', 6)], [setWrite('tension', 8)]]);
    expect(undo('m-e2')).toBeUndefined();
    expect(undo('m-e3')).toEqual(['scene.tension (back to 6)']);
  });

  it('says "the default" when the key had never been written', () => {
    const { undo } = chat([[setWrite('level', 1)], [setWrite('tension', 6)]]);
    expect(undo('m-e2')).toEqual(['scene.tension (back to the default, 3)']);
    expect(undo('m-e1')).toEqual(['scene.level (back to the default, 0)']);
  });

  it('words enums, booleans and text', () => {
    const { undo } = chat([
      [setWrite('mood', 'calm'), setWrite('quiet', true), setWrite('place', 'old place')],
      [setWrite('mood', 'tense'), setWrite('quiet', false), setWrite('place', 'a new place')],
    ]);
    expect(undo('m-e2')).toEqual([
      "scene.mood (back to 'calm')",
      'scene.quiet (back to true)',
      "scene.place (back to 'old place')",
    ]);
    expect(undo('m-e1')).toBeUndefined();
  });

  it('cuts long text and names empty text and the default text', () => {
    const long = chat([[setWrite('place', 'x'.repeat(100))], [setWrite('place', 'short')]]);
    expect(long.undo('m-e2')).toEqual([`scene.place (back to '${'x'.repeat(39)}…')`]);
    const empty = chat([[setWrite('place', '')], [setWrite('place', 'short')]]);
    expect(empty.undo('m-e2')).toEqual(['scene.place (back to empty text)']);
    const first = chat([[setWrite('place', 'short')]]);
    expect(first.undo('m-e1')).toEqual(["scene.place (back to the default, 'a tavern')"]);
  });

  it('never shows the content of an object', () => {
    const { undo } = chat([[setWrite('flags', { secret: 'one' })], [setWrite('flags', { secret: 'two' })]]);
    expect(undo('m-e2')).toEqual(['scene.flags (restored to its earlier value)']);
    expect(undo('m-e1')).toBeUndefined();
    const first = chat([[setWrite('flags', { secret: 'one' })]]);
    expect(first.undo('m-e1')).toEqual(['scene.flags (back to its default)']);
  });

  it('lists nothing for a value set to what it already was', () => {
    const { undo } = chat([[setWrite('tension', 4)], [setWrite('tension', 4)]]);
    expect(undo('m-e2')).toBeUndefined();
  });

  it('does not leak a cut object, which the fold cannot read as an object', () => {
    const cut = `{"secret":"${'x'.repeat(200)}`;
    const { undo } = chat([[setWrite('flags', { a: 1 })], [setWrite('flags', cut)]]);
    const lines = undo('m-e2');
    expect(JSON.stringify(lines ?? [])).not.toContain('xxxx');
  });

  it('keeps the order of the writes and lists a key once however often the turn wrote it', () => {
    const { undo } = chat([
      [setWrite('tension', 4), setWrite('mood', 'calm')],
      [setWrite('mood', 'tense'), setWrite('tension', 5), setWrite('tension', 6)],
    ]);
    expect(undo('m-e2')).toEqual(["scene.mood (back to 'calm')", 'scene.tension (back to 4)']);
  });
});

describe('collections', () => {
  it('forgets the item the reply added', () => {
    const { undo } = chat([[addWrite('injected', 'a', 'a bell on a lost animal, ringing')]]);
    expect(undo('m-e1')).toEqual(["scene.injected (forgets 'a bell on a lost animal, ring…')"]);
  });

  it('lists three items and counts the rest', () => {
    const { undo } = chat([
      [addWrite('injected', 'x', 'old')],
      ['a', 'b', 'c', 'd'].map((text) => addWrite('injected', text, text)),
    ]);
    expect(undo('m-e2')).toEqual(["scene.injected (forgets 'd', 'c', 'b'; and 1 more)"]);
  });

  it('brings back an item a removal took away', () => {
    const { undo } = chat([
      [addWrite('injected', 'a', 'first'), addWrite('injected', 'b', 'second')],
      [removeWrite('injected', 'a')],
    ]);
    expect(undo('m-e2')).toEqual(["scene.injected (brings back 'first')"]);
  });

  it('reveals the item the cap had cut off', () => {
    const capped = { ...scene, keys: { ...scene.keys, injected: { type: 'collection' as const, cap: 2 } } };
    const { undo } = chat(
      [[addWrite('injected', 'a', 'a'), addWrite('injected', 'b', 'b')], [addWrite('injected', 'c', 'c')]],
      [capped],
    );
    expect(undo('m-e2')).toEqual(["scene.injected (forgets 'c'; brings back 'a')"]);
  });
});

describe('node memory', () => {
  it('names the node and the draws it forgets', () => {
    const { undo } = chat([[drawWrite('d1', 'resin smell')], [drawWrite('d2', 'wet stone'), setWrite('tension', 5)]]);
    expect(undo('m-e2')).toEqual(["Draw #1 (draw) forgets 'wet stone'", 'scene.tension (back to the default, 3)']);
  });

  it('names a node that is gone by its memory', () => {
    const messages = [userMessage(), reply('e1')];
    const view = buildView({ messages, entries: [entry('e1', [drawWrite('d1', 'resin smell')])], nodeLabels: {} });
    expect(undoneByDelete({ messageId: 'm-e1', messages, view, definitions: [scene] })).toEqual([
      "A node's memory forgets 'resin smell'",
    ]);
  });
});

describe('when no special confirmation is needed', () => {
  it('stays quiet while another reply of the turn survives, and speaks for the last one', () => {
    const entries = [entry('e1', [setWrite('tension', 6)], 2)];
    const both = [userMessage(), reply('e1', { nodeId: 'a' }), reply('e1', { nodeId: 'b' })];
    const view = buildView({ messages: both, entries });
    const ask = (messageId: string, messages: ChatMessage[]) =>
      undoneByDelete({ messageId, messages, view, definitions: [scene] });
    expect(ask('m-e1-a', both)).toBeUndefined();
    expect(ask('m-e1-b', both)).toBeUndefined();
    expect(ask('m-e1-b', [both[0] as ChatMessage, both[2] as ChatMessage])).toEqual([
      'scene.tension (back to the default, 3)',
    ]);
  });

  it('ignores a reply that is still streaming when counting the survivors', () => {
    const entries = [entry('e1', [setWrite('tension', 6)], 1)];
    const messages = [userMessage(), reply('e1', { nodeId: 'a' }), reply('e1', { nodeId: 'b', status: 'streaming' })];
    const view = buildView({ messages: [messages[1] as ChatMessage], entries });
    expect(undoneByDelete({ messageId: 'm-e1-a', messages, view, definitions: [scene] })).toEqual([
      'scene.tension (back to the default, 3)',
    ]);
  });

  it.each([
    ['a user message', 'u1'],
    ['an unknown message', 'nope'],
  ])('is undefined for %s', (_name, id) => {
    const { undo } = chat([[setWrite('tension', 6)]]);
    expect(undo(id)).toBeUndefined();
  });

  it('is undefined for a streaming reply, a reply without a run, a turn without writes or one that no longer counts', () => {
    const { messages, view } = chat([[setWrite('tension', 6)], []]);
    const ask = (list: ChatMessage[], id: string, v = view) =>
      undoneByDelete({ messageId: id, messages: list, view: v, definitions: [scene] });
    expect(
      ask(
        messages.map((m) => (m.id === 'm-e1' ? { ...m, status: 'streaming' as const } : m)),
        'm-e1',
      ),
    ).toBeUndefined();
    expect(
      ask(
        messages.map((m) => (m.id === 'm-e1' ? { ...m, executionId: undefined } : m)),
        'm-e1',
      ),
    ).toBeUndefined();
    expect(ask(messages, 'm-e2')).toBeUndefined();
    const gone = { ...view, turns: view.turns.map((turn) => ({ ...turn, turnNumber: null })) };
    expect(ask(messages, 'm-e1', gone)).toBeUndefined();
    expect(ask(messages, 'm-e1', { ...view, turns: [] })).toBeUndefined();
  });

  it('skips what belongs to a deleted definition', () => {
    const other = {
      ...scene,
      id: '5d9f7d0e-34a3-4c7b-9b1f-6a3f0f2bb0a2',
      name: 'zeta',
      createdAt: '2026-02-01T00:00:00.000Z',
    };
    const { undo } = chat([[setWrite('tension', 6)]]);
    expect(undo('m-e1', { definitions: [other] })).toBeUndefined();
  });

  it('skips a key the definition no longer has', () => {
    const { undo } = chat([[setWrite('tension', 6), setWrite('gone', 1)]]);
    expect(undo('m-e1')).toEqual(['scene.tension (back to the default, 3)']);
  });
});

it('words the confirmation', () => {
  expect(deleteConfirmText(['scene.tension (back to 4)', "scene.injected (forgets 'a bell')"])).toBe(
    "Deleting this reply also undoes what its turn stored:\n\n- scene.tension (back to 4)\n- scene.injected (forgets 'a bell')\n\nDelete the reply?",
  );
});

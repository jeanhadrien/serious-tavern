import { describe, expect, it } from 'vitest';
import { descriptors } from './registry.js';
import { unlinkedMessages } from './nodes/unlinked-messages/index.js';
import { runNode } from './test-collections.js';
import { idRange, linkedItem, MEMORY_ID, memoryDefinition, messagesOf, withEdit } from './test-links.js';
import { snapshotOf, stateResources } from './test-state.js';

const resources = stateResources(memoryDefinition);
const config = (key = 'summaries') => unlinkedMessages.configSchema.parse({ definitionId: MEMORY_ID, key });
type Item = ReturnType<typeof linkedItem> | { id: string; text: string };
const run = (history: ReturnType<typeof messagesOf>, items: Item[], input: unknown = history, key = 'summaries') =>
  runNode(unlinkedMessages, config(key), {
    resources,
    history,
    inputs: { messages: input },
    state: snapshotOf([memoryDefinition], { keys: { [`memory.${key}`]: { value: items } } }),
  });
const ids = (messages: unknown) => (messages as { id: string }[]).map((message) => message.id);

describe('Unlinked Messages', () => {
  const history = messagesOf(12);

  it('is a History node with a required messages input, and no dynamic ports', () => {
    const entry = descriptors().find((descriptor) => descriptor.type === 'unlinked-messages');
    expect(entry).toMatchObject({ category: 'History', label: 'Unlinked Messages' });
    expect(entry?.dynamicPorts).toBeFalsy();
    expect(entry?.inputs).toEqual([
      expect.objectContaining({ name: 'messages', dataType: 'messages', required: true }),
    ]);
    expect(entry?.outputs.map((port) => port.name)).toEqual(['messages', 'text']);
  });

  it('hides the messages an intact item links to and keeps the others in order', async () => {
    const { output } = await run(history, [linkedItem(history, idRange(1, 4)), linkedItem(history, idRange(5, 8))]);
    expect(ids(output.messages)).toEqual(idRange(9, 12));
    expect(output.text).toBe('user: text 9\nassistant: text 10\nuser: text 11\nassistant: text 12');
  });

  it('keeps everything when no item links anything, or the key is empty', async () => {
    expect(ids((await run(history, [])).output.messages)).toEqual(idRange(1, 12));
    expect(ids((await run(history, [{ id: 'x', text: 'plain' }])).output.messages)).toEqual(idRange(1, 12));
  });

  it.each<[string, (messages: typeof history) => typeof history]>([
    ['edited', (messages) => withEdit(messages, 'm3', 'edited')],
    ['partly deleted', (messages) => withEdit(messages, 'm3')],
    ['deleted', (messages) => messages.filter((message) => !idRange(1, 4).includes(message.id))],
  ])('does not hide the messages of an item that is %s', async (name, change) => {
    const item = linkedItem(history, idRange(1, 4));
    const now = change(history);
    const kept = ids((await run(now, [item])).output.messages);
    expect(kept).toEqual(now.map((message) => message.id));
    expect(name).toBeTruthy();
  });

  it('hides the messages of an item that is intact again after its edit was reverted', async () => {
    const item = linkedItem(history, idRange(1, 4));
    expect(ids((await run(withEdit(history, 'm2', 'x'), [item])).output.messages)).toContain('m2');
    expect(ids((await run(history, [item])).output.messages)).not.toContain('m2');
  });

  it('judges items against the whole chat, whatever list it is given', async () => {
    const item = linkedItem(history, idRange(1, 4));
    // Memory with a Last N would pass only the end of the chat: the item is still intact, and hides nothing there.
    expect(ids((await run(history, [item], history.slice(6))).output.messages)).toEqual(idRange(7, 12));
    // A list that holds some of the item's messages loses them.
    expect(ids((await run(history, [item], history.slice(2, 9))).output.messages)).toEqual(idRange(5, 9));
  });

  it('works for any collection key, and only counts the key it was given', async () => {
    const facts = linkedItem(history, idRange(1, 2), 'fact');
    const summaries = linkedItem(history, idRange(3, 4), 'sum');
    const state = snapshotOf([memoryDefinition], {
      keys: { 'memory.facts': { value: [facts] }, 'memory.summaries': { value: [summaries] } },
    });
    const result = await runNode(unlinkedMessages, config('facts'), {
      resources,
      history,
      inputs: { messages: history },
      state,
    });
    expect(ids(result.output.messages)).toEqual(idRange(3, 12));
  });

  it('logs how many messages it left out', async () => {
    const { logs } = await run(history, [linkedItem(history, idRange(1, 4))]);
    expect(logs).toEqual(['memory.summaries: 4 of 12 messages are linked by intact items and left out.']);
  });

  it('keeps messages that carry no id', async () => {
    const loose = [{ role: 'user', content: 'no id' }, ...history.slice(0, 2)];
    const item = linkedItem(history, idRange(1, 2));
    expect((await run(history, [item], loose)).output.messages).toEqual([loose[0]]);
  });

  it('gives an empty list and empty text when everything is linked', async () => {
    const { output } = await run(history.slice(0, 4), [linkedItem(history, idRange(1, 4))]);
    expect(output).toEqual({ messages: [], text: '' });
  });

  it('is an error at run time for a key that is unknown or not a collection', async () => {
    const attempt = (given: Record<string, unknown>) =>
      runNode(unlinkedMessages, given, {
        resources,
        history,
        inputs: { messages: history },
        state: snapshotOf([memoryDefinition]),
      });
    await expect(attempt({ definitionId: MEMORY_ID, key: 'note' })).rejects.toThrow(
      'memory.note is a text key; this node needs a collection key',
    );
    await expect(attempt({ definitionId: MEMORY_ID, key: 'nope' })).rejects.toThrow(
      'State definition "memory" has no key "nope"',
    );
    await expect(attempt({ definitionId: 'gone', key: 'summaries' })).rejects.toThrow(
      'State definition gone not found',
    );
  });

  it('is an error when what arrives is not a list of messages', async () => {
    await expect(run(history, [], 'text')).rejects.toThrow('needs a list of messages');
  });

  it('does not change the list it was given', async () => {
    const input = structuredClone(history);
    await run(history, [linkedItem(history, idRange(1, 4))], input);
    expect(input).toEqual(history);
  });
});

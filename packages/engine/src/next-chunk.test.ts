import { describe, expect, it } from 'vitest';
import { descriptors } from './registry.js';
import { nextChunk } from './nodes/next-chunk/index.js';
import { runNode } from './test-collections.js';
import { idRange, linkedItem, MEMORY_ID, memoryDefinition, messagesOf, withEdit } from './test-links.js';
import { snapshotOf, stateResources } from './test-state.js';

const resources = stateResources(memoryDefinition);
const config = (over: Record<string, unknown> = {}) =>
  nextChunk.configSchema.parse({ definitionId: MEMORY_ID, key: 'summaries', chunkSize: 4, rawWindow: 2, ...over });
type Item = ReturnType<typeof linkedItem> | { id: string; text: string };
const run = (history: ReturnType<typeof messagesOf>, items: Item[] = [], over: Record<string, unknown> = {}) =>
  runNode(nextChunk, config(over), {
    resources,
    history,
    state: snapshotOf([memoryDefinition], { keys: { 'memory.summaries': { value: items } } }),
  });
const idsOf = (messages: unknown) => (messages as { id: string }[]).map((message) => message.id);

describe('Next Chunk: ports and setup', () => {
  it('has the same ports whatever the key, once the key is a collection', async () => {
    const ports = await nextChunk.resolvePorts!(config(), resources);
    expect(ports.inputs).toEqual([]);
    expect(ports.outputs.map((port) => `${port.name}:${port.dataType}${port.optional ? '?' : ''}`)).toEqual([
      'messages:messages?',
      'text:text?',
      'link:object?',
      'replaces:text?',
    ]);
    expect(ports).toEqual({ inputs: nextChunk.inputs, outputs: nextChunk.outputs });
  });

  it.each([
    [{}, 'Select a state definition'],
    [{ definitionId: 'missing', key: 'summaries' }, 'State definition missing not found'],
    [{ definitionId: MEMORY_ID }, 'Select a key'],
    [{ definitionId: MEMORY_ID, key: 'nope' }, 'State definition "memory" has no key "nope"'],
    [{ definitionId: MEMORY_ID, key: 'note' }, 'memory.note is a text key; this node needs a collection key'],
  ])('is not set up for %j', async (given, message) => {
    await expect(nextChunk.resolvePorts!(given, resources)).rejects.toThrow(message);
  });

  it('refuses a config without a target and a chunk smaller than 2', () => {
    expect(nextChunk.configSchema.safeParse({}).success).toBe(false);
    expect(nextChunk.configSchema.safeParse({ definitionId: MEMORY_ID, key: 'summaries', chunkSize: 1 }).success).toBe(
      false,
    );
    expect(nextChunk.configSchema.parse({ definitionId: MEMORY_ID, key: 'summaries' })).toMatchObject({
      chunkSize: 20,
      rawWindow: 16,
    });
  });

  it('is a History node with dynamic ports', () => {
    expect(descriptors().find((entry) => entry.type === 'next-chunk')).toMatchObject({
      category: 'History',
      dynamicPorts: true,
      label: 'Next Chunk',
    });
  });

  it('fails when the node runs on a key that is not a collection', async () => {
    await expect(
      runNode(nextChunk, config({ key: 'note' }), {
        resources,
        history: messagesOf(9),
        state: snapshotOf([memoryDefinition]),
      }),
    ).rejects.toThrow('memory.note is a text key; this node needs a collection key');
  });
});

describe('Next Chunk: planning over a key', () => {
  it('outputs nothing, with the reason in the log, for a fresh short chat', async () => {
    const result = await run(messagesOf(2));
    expect(result.output).toEqual({});
    expect(result.logs).toEqual(['Nothing to link: the chat has 2 messages, all within the last 2 kept raw.']);
  });

  it('reports a partial chunk', async () => {
    const result = await run(messagesOf(5));
    expect(result.output).toEqual({});
    expect(result.logs[0]).toBe(
      'Nothing to link yet: 3 messages outside the last 2 are not linked, and a chunk needs 4.',
    );
  });

  it('outputs the first chunk: messages, transcript and link', async () => {
    const history = messagesOf(8);
    const { output, logs } = await run(history);
    expect(idsOf(output.messages)).toEqual(idRange(1, 4));
    expect(output.text).toBe('user: text 1\nassistant: text 2\nuser: text 3\nassistant: text 4');
    expect(output.link).toEqual({ ids: idRange(1, 4), fingerprint: expect.stringMatching(/^[0-9a-f]{32}$/) });
    expect(output).not.toHaveProperty('replaces');
    expect(logs).toEqual(['Next chunk: 4 messages that memory.summaries does not link yet.']);
  });

  it('the link fingerprint is the one State Write needs: the same as an item made for those messages', async () => {
    const history = messagesOf(8);
    const { output } = await run(history);
    expect((output.link as { fingerprint: string }).fingerprint).toBe(
      linkedItem(history, idRange(1, 4)).messages.fingerprint,
    );
  });

  it('respects the raw window: the newest messages are never planned', async () => {
    expect(idsOf((await run(messagesOf(6))).output.messages)).toEqual(idRange(1, 4));
    expect((await run(messagesOf(6), [], { rawWindow: 3 })).output).toEqual({});
  });

  it('moves on after an intact item', async () => {
    const history = messagesOf(12);
    const { output } = await run(history, [linkedItem(history, idRange(1, 4))]);
    expect(idsOf(output.messages)).toEqual(idRange(5, 8));
  });

  it('says every message is covered when nothing is left', async () => {
    const history = messagesOf(10);
    const result = await run(history, [linkedItem(history, idRange(1, 4)), linkedItem(history, idRange(5, 8))]);
    expect(result.output).toEqual({});
    expect(result.logs[0]).toBe(
      'Nothing to link: every message outside the last 2 is already linked by an intact item.',
    );
  });

  it('ignores items that link to nothing', async () => {
    const history = messagesOf(8);
    expect(idsOf((await run(history, [{ id: 'note', text: 'plain' }])).output.messages)).toEqual(idRange(1, 4));
  });

  it('re-plans a broken item over its surviving messages and names it in `replaces`', async () => {
    const original = messagesOf(12);
    const first = linkedItem(original, idRange(1, 4), 'first');
    const second = linkedItem(original, idRange(5, 8), 'second');
    const edited = withEdit(original, 'm2', 'edited');
    const result = await run(edited, [second, first]);
    expect(idsOf(result.output.messages)).toEqual(idRange(1, 4));
    expect(result.output.replaces).toBe('first');
    expect((result.output.link as { fingerprint: string }).fingerprint).not.toBe(first.messages.fingerprint);
    expect(result.logs[0]).toBe(
      'Next chunk: an item of memory.summaries no longer matches the chat; 4 of its messages are left to redo.',
    );
    const deleted = withEdit(original, 'm3');
    expect(idsOf((await run(deleted, [second, first])).output.messages)).toEqual(['m1', 'm2', 'm4']);
  });

  it('skips an item an intact replacement covers, and moves on', async () => {
    const original = messagesOf(14);
    const first = linkedItem(original, idRange(1, 4), 'first');
    const edited = withEdit(original, 'm2', 'edited');
    const redo = linkedItem(edited, idRange(1, 4), 'redo');
    const result = await run(edited, [redo, first]);
    expect(idsOf(result.output.messages)).toEqual(idRange(5, 8));
    expect(result.output).not.toHaveProperty('replaces');
  });

  it('plans again from the start when every linked message is gone', async () => {
    const original = messagesOf(12);
    const first = linkedItem(original, idRange(1, 4), 'first');
    const rest = original.filter((message) => !idRange(1, 4).includes(message.id));
    const result = await run(rest, [first]);
    expect(idsOf(result.output.messages)).toEqual(idRange(5, 8));
    expect(result.output).not.toHaveProperty('replaces');
  });

  it('works over a key of facts as well: it only looks at links', async () => {
    const history = messagesOf(12);
    const result = await runNode(nextChunk, config({ key: 'facts' }), {
      resources,
      history,
      state: snapshotOf([memoryDefinition], {
        keys: { 'memory.facts': { value: [linkedItem(history, idRange(1, 4), 'fact')] } },
      }),
    });
    expect(idsOf(result.output.messages)).toEqual(idRange(5, 8));
  });

  it('does not change the history it was given', async () => {
    const history = messagesOf(8);
    const before = structuredClone(history);
    const { output } = await run(history);
    (output.messages as { content: string }[])[0]!.content = 'changed';
    expect(history).toEqual(before);
  });
});

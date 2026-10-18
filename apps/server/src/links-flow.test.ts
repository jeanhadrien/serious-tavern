import { afterEach, describe, expect, it } from 'vitest';
import { errorEnvelopeSchema, stateDefinitionInUseDetailsSchema } from '@st/shared';
import { deleteMessage, makeWorkflow, node } from './test-support/story.js';
import { linkHarness, patchMessage, say, storedItems } from './test-support/links.js';

// Summaries, wired the way the README does: the reply shows the intact summaries and the messages no summary stands
// for; the after-reply run summarizes the next chunk.

const harness = linkHarness('links-flow');
afterEach(() => harness.cleanup());

describe('summaries as linked story state', () => {
  it('writes the first summary after turn 3, hides its messages from the next prompt and shows it in chat order', async () => {
    const { app, session } = await harness.chat();
    expect(await say(app, session, 'u1')).toBe('S[] H[]');
    await say(app, session, 'u2');
    await say(app, session, 'u3');
    const { items, session: stored } = await storedItems(app, session.id);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      text: 'S[user: u1]',
      messages: { ids: stored.messages.slice(0, 2).map((m) => m.id) },
    });
    const reply = await say(app, session, 'u4');
    // m1 and m2 are replaced by the summary: the raw messages start at the second exchange.
    expect(reply).toMatch(/^S\[S\[user: u1\];\] H\[user: u2\nassistant: /);
    expect(reply).toContain('user: u3');
  });

  it('summarizes the chunks one after the other, never twice', async () => {
    const { app, session } = await harness.chat();
    for (const text of ['u1', 'u2', 'u3', 'u4', 'u5', 'u6']) await say(app, session, text);
    const { items } = await storedItems(app, session.id);
    // A chunk of two messages is planned every turn once the raw window is passed, newest item first.
    expect(items.map((item) => item.text)).toEqual(['S[user: u4]', 'S[user: u3]', 'S[user: u2]', 'S[user: u1]']);
    const all = items.flatMap((item) => item.messages!.ids);
    expect(new Set(all).size).toBe(all.length);
    expect(await say(app, session, 'u7')).toMatch(/^S\[S\[user: u1\];S\[user: u2\];S\[user: u3\];S\[user: u4\];\] H\[/);
  });

  it('forgets the summary with the reply of the turn that wrote it, and the next turn summarizes the chunk again', async () => {
    const { app, session } = await harness.chat();
    for (const text of ['u1', 'u2', 'u3']) await say(app, session, text);
    const before = await storedItems(app, session.id);
    expect(before.items).toHaveLength(1);
    const writing = before.session.messages.filter(
      (m) => m.executionId === before.session.state!.turns[2]!.executionId,
    );
    for (const message of writing.filter((m) => m.role === 'assistant'))
      await deleteMessage(app, session.id, message.id);
    expect((await storedItems(app, session.id)).items).toEqual([]);
    // The reply of the next turn has no summary, the messages are raw again, and its post run redoes the chunk.
    const reply = await say(app, session, 'u4');
    expect(reply).toMatch(/^S\[\] H\[user: u1/);
    const after = await storedItems(app, session.id);
    expect(after.items.map((item) => item.text)).toEqual(['S[user: u1]']);
    expect(after.items[0]!.id).not.toBe(before.items[0]!.id);
  });
});

describe('an edit inside a summarized chunk', () => {
  async function editedChat() {
    const context = await harness.chat();
    for (const text of ['u1', 'u2', 'u3']) await say(context.app, context.session, text);
    const { session } = await storedItems(context.app, context.session.id);
    await patchMessage(context.app, context.session.id, session.messages[0]!.id, 'u1 edited');
    return context;
  }

  it('stops the summary being used, and the next post run redoes it without a remove', async () => {
    const { app, session } = await editedChat();
    const shown = (await storedItems(app, session.id)).view.definitions[0]!.values.summaries as { link?: unknown }[];
    expect(shown).toHaveLength(1);
    const reply = await say(app, session, 'u4');
    expect(reply).toMatch(/^S\[\] H\[user: u1 edited/);
    const { items } = await storedItems(app, session.id);
    expect(items.map((item) => item.text)).toEqual(['S[user: u1 edited]', 'S[user: u1]']);
    // Both are stored, but only the new one is intact: the next prompt uses it alone, and the old one is not redone
    // again (the plan moves on to the next chunk).
    expect(await say(app, session, 'u5')).toMatch(/^S\[S\[user: u1 edited\];\] H\[/);
    expect((await storedItems(app, session.id)).items.map((item) => item.text)).toEqual([
      'S[user: u2]',
      'S[user: u1 edited]',
      'S[user: u1]',
    ]);
  });

  it('plans the broken item again when the turn that wrote its replacement is deleted', async () => {
    const { app, session } = await editedChat();
    await say(app, session, 'u4');
    const { session: stored } = await storedItems(app, session.id);
    const redoTurn = stored.state!.turns[3]!.executionId;
    for (const message of stored.messages.filter((m) => m.executionId === redoTurn && m.role === 'assistant'))
      await deleteMessage(app, session.id, message.id);
    expect((await storedItems(app, session.id)).items.map((item) => item.text)).toEqual(['S[user: u1]']);
    await say(app, session, 'u5');
    expect((await storedItems(app, session.id)).items.map((item) => item.text)).toEqual([
      'S[user: u1 edited]',
      'S[user: u1]',
    ]);
  });

  it('plans nothing when the edit is reverted: the old summary is intact again', async () => {
    const { app, session } = await harness.chat();
    for (const text of ['u1', 'u2', 'u3']) await say(app, session, text);
    const first = (await storedItems(app, session.id)).session.messages[0]!;
    await patchMessage(app, session.id, first.id, 'u1 edited');
    await patchMessage(app, session.id, first.id, first.content);
    expect(await say(app, session, 'u4')).toMatch(/^S\[S\[user: u1\];\] H\[/);
    // Turn 4 planned the next chunk, not the first one again.
    expect((await storedItems(app, session.id)).items.map((item) => item.text)).toEqual(['S[user: u2]', 'S[user: u1]']);
  });
});

describe('a deleted message inside a summarized chunk', () => {
  it('re-plans the chunk over the messages that are left', async () => {
    const { app, session } = await harness.chat();
    for (const text of ['u1', 'u2', 'u3']) await say(app, session, text);
    const stored = (await storedItems(app, session.id)).session;
    await deleteMessage(app, session.id, stored.messages[1]!.id);
    await say(app, session, 'u4');
    const { items } = await storedItems(app, session.id);
    expect(items).toHaveLength(2);
    expect(items[0]!.messages!.ids).toEqual([stored.messages[0]!.id]);
  });
});

describe('definitions used by the link nodes', () => {
  it('cannot be deleted while a workflow has a Next Chunk or Unlinked Messages node on it', async () => {
    const { app, definition } = await harness.open();
    await makeWorkflow(
      app,
      [
        node('input', 'chat-input'),
        node('out', 'chat-output'),
        node('mem', 'memory', { all: true, format: 'messages' }),
        node('un', 'unlinked-messages', { definitionId: definition.id, key: 'summaries' }),
      ],
      [
        { id: 'a', source: 'mem', sourceHandle: 'history', target: 'un', targetHandle: 'messages' },
        { id: 'b', source: 'un', sourceHandle: 'text', target: 'out', targetHandle: 'value' },
      ],
      'Only unlinked',
    );
    const response = await app.inject({ method: 'DELETE', url: `/api/state-definitions/${definition.id}` });
    expect(response.statusCode).toBe(409);
    const { error } = errorEnvelopeSchema.parse(response.json());
    expect(error.code).toBe('STATE_DEFINITION_IN_USE');
    expect(stateDefinitionInUseDetailsSchema.parse(error.details).workflows).toEqual(['Only unlinked']);
  });

  it('shows the intact summaries through `linked` in the preset preview, and not a broken one', async () => {
    const { app, session } = await harness.chat();
    for (const text of ['u1', 'u2', 'u3']) await say(app, session, text);
    const preset = {
      id: '4c8f7d0e-34a3-4c7b-9b1f-6a3f0f2bb0a1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      name: 'p',
      inputs: [],
      entries: [
        {
          id: 'e',
          displayName: 'E',
          kind: 'message',
          role: 'system',
          enabled: true,
          content: '{{#each (linked state.memory.summaries)}}{{text}}:{{link.status}};{{/each}}',
        },
      ],
    };
    const preview = async () =>
      (
        await app.inject({ method: 'POST', url: '/api/presets/preview', payload: { preset, sessionId: session.id } })
      ).json().messages;
    expect(await preview()).toEqual([{ role: 'system', content: 'S[user: u1]:intact;' }]);
    const { session: stored } = await storedItems(app, session.id);
    await patchMessage(app, session.id, stored.messages[0]!.id, 'edited');
    // Nothing intact is left, so the entry renders empty and is dropped.
    expect(await preview()).toEqual([]);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { fingerprintMessages, WRITE_PREVIEW_LIMIT, type ChatMessage, type ItemLinkView } from '@st/shared';
import { withLinkViews } from './services/link-view.js';
import { linkHarness, patchMessage, say, storedItems } from './test-support/links.js';
import { deleteMessage } from './test-support/story.js';

const harness = linkHarness('session-state-link');
afterEach(() => harness.cleanup());

type Linked = { id: string; text: string; link?: ItemLinkView };
const linkedItems = async (app: Parameters<typeof storedItems>[0], sessionId: string) =>
  (await storedItems(app, sessionId)).view.definitions[0]!.values.summaries as Linked[];

describe('the state view of linked items', () => {
  async function chatWithSummary() {
    const context = await harness.chat();
    for (const text of ['u1', 'u2', 'u3']) await say(context.app, context.session, text);
    const { session, items } = await storedItems(context.app, context.session.id);
    return { ...context, messages: session.messages, items };
  }

  it('gives an intact item its range, first message and the messages it links to', async () => {
    const { app, session, messages } = await chatWithSummary();
    const [item] = await linkedItems(app, session.id);
    expect(item!.text).toBe('S[user: u1]');
    expect(item!.link).toEqual({
      status: 'intact',
      replaced: false,
      repeated: false,
      count: 2,
      missing: 0,
      firstIndex: 1,
      lastIndex: 2,
      firstMessageId: messages[0]!.id,
      lastMessageId: messages[1]!.id,
      messageIds: [messages[0]!.id, messages[1]!.id],
    });
  });

  it('follows an edit and a delete of a linked message', async () => {
    const { app, session, messages } = await chatWithSummary();
    await patchMessage(app, session.id, messages[1]!.id, 'edited reply');
    expect((await linkedItems(app, session.id))[0]!.link).toMatchObject({
      status: 'changed',
      missing: 0,
      lastIndex: 2,
    });
    await deleteMessage(app, session.id, messages[0]!.id);
    expect((await linkedItems(app, session.id))[0]!.link).toEqual({
      status: 'partial',
      replaced: false,
      repeated: false,
      count: 2,
      missing: 1,
      firstIndex: 1,
      lastIndex: 1,
      firstMessageId: messages[1]!.id,
      lastMessageId: messages[1]!.id,
      messageIds: [messages[1]!.id],
    });
    await deleteMessage(app, session.id, messages[1]!.id);
    const gone = (await linkedItems(app, session.id))[0]!.link!;
    expect(gone).toEqual({ status: 'gone', replaced: false, repeated: false, count: 2, missing: 2, messageIds: [] });
    expect(gone).not.toHaveProperty('firstIndex');
    expect(gone).not.toHaveProperty('firstMessageId');
  });

  it('counts positions among the history messages, so a deleted message before shifts them', async () => {
    const { app, session, messages } = await chatWithSummary();
    const stored = (await storedItems(app, session.id)).items;
    expect(stored).toHaveLength(1);
    // Add the second chunk (turn 4), then delete a message before it.
    await say(app, session, 'u4');
    const second = (await linkedItems(app, session.id))[0]!;
    expect(second.link).toMatchObject({ firstIndex: 3, lastIndex: 4, status: 'intact' });
    await deleteMessage(app, session.id, messages[0]!.id);
    expect((await linkedItems(app, session.id))[0]!.link).toMatchObject({ firstIndex: 2, lastIndex: 3 });
  });

  it('marks the broken item as replaced once an intact item covers what is left of it', async () => {
    const { app, session, messages } = await chatWithSummary();
    await patchMessage(app, session.id, messages[0]!.id, 'u1 edited');
    await say(app, session, 'u4');
    const items = await linkedItems(app, session.id);
    const byText = Object.fromEntries(items.map((item) => [item.text, item.link]));
    expect(byText['S[user: u1 edited]']).toMatchObject({ status: 'intact', replaced: false });
    expect(byText['S[user: u1]']).toMatchObject({ status: 'changed', replaced: true });
  });

  it('is not replaced while nothing covers it, and a replacement that is itself broken covers nothing', async () => {
    const { app, session, messages } = await chatWithSummary();
    await patchMessage(app, session.id, messages[0]!.id, 'u1 edited');
    expect((await linkedItems(app, session.id))[0]!.link).toMatchObject({ status: 'changed', replaced: false });
    await say(app, session, 'u4');
    await patchMessage(app, session.id, messages[1]!.id, 'edited again');
    const items = await linkedItems(app, session.id);
    expect(items.filter((item) => item.link?.replaced)).toEqual([]);
  });

  it('sends the text of a linked item whole, and a long one in the turn that wrote it too', async () => {
    const { app, session } = await harness.chat();
    const long = 'x'.repeat(WRITE_PREVIEW_LIMIT * 3);
    await say(app, session, long);
    await say(app, session, 'u2');
    await say(app, session, 'u3');
    const view = (await storedItems(app, session.id)).view;
    const text = `S[user: ${long}]`;
    expect((view.definitions[0]!.values.summaries as Linked[])[0]!.text).toBe(text);
    const written = view.turns.flatMap((turn) => turn.writes).find((write) => write.write.op === 'add')!;
    expect(written.truncated).toBeUndefined();
    expect(written.write).toMatchObject({ op: 'add', item: { text, messages: { ids: expect.any(Array) } } });
  });

  it('leaves the items of other keys and the stored fold alone', async () => {
    const { app, session } = await chatWithSummary();
    const view = (await storedItems(app, session.id)).view;
    expect(view.definitions[0]!.meta.summaries!.count).toBe(1);
    expect(view.nodes).toEqual([]);
  });
});

describe('withLinkViews', () => {
  const message = (id: string, content: string, over: Partial<ChatMessage> = {}): ChatMessage => ({
    id,
    role: 'user',
    content,
    createdAt: '',
    ...over,
  });
  const history = [message('a', 'one'), message('b', 'two'), message('c', 'three')];
  const item = (id: string, ids: string[], over: object = {}) => ({
    id,
    text: id,
    messages: { ids, fingerprint: fingerprintMessages(ids.flatMap((x) => history.filter((m) => m.id === x))), ...over },
  });

  it('adds nothing to items without a link and keeps them as they are', () => {
    const plain = { id: 'p', text: 'plain' };
    expect(withLinkViews([plain], history)[0]).toBe(plain);
    expect(withLinkViews([], history)).toEqual([]);
  });

  it('does not change the items it is given', () => {
    const linked = item('s', ['a', 'b']);
    const before = structuredClone(linked);
    withLinkViews([linked], history);
    expect(linked).toEqual(before);
  });

  it('does not count partial or streaming rows as positions', () => {
    const rows = [message('a', 'one'), message('p', 'half', { status: 'partial' }), message('b', 'two')];
    const [out] = withLinkViews(
      [{ id: 's', text: 's', messages: { ids: ['a', 'b'], fingerprint: fingerprintMessages([rows[0]!, rows[2]!]) } }],
      [rows[0]!, rows[2]!],
    );
    expect(out!.link).toMatchObject({ status: 'intact', firstIndex: 1, lastIndex: 2 });
  });

  it('reads a link without a fingerprint as changed', () => {
    const [out] = withLinkViews([{ id: 's', text: 's', messages: { ids: ['a'] } }], history);
    expect(out!.link).toMatchObject({ status: 'changed', count: 1, missing: 0 });
  });

  it('marks an intact item that links the same messages as an earlier one as a repeat, and nothing else', () => {
    const earlier = item('earlier', ['a', 'b']);
    const later = item('later', ['c']);
    // Newest first: `copy` was written after `earlier`, but the earlier one in the list comes first in a tie.
    const views = withLinkViews([later, item('copy', ['a', 'b']), earlier], history).map((entry) => [
      entry.id,
      entry.link?.repeated,
    ]);
    expect(views).toEqual([
      ['later', false],
      ['copy', false],
      ['earlier', true],
    ]);
    // A broken item is never a repeat: it is replaced or waiting, not a copy.
    const [broken] = withLinkViews([item('broken', ['a', 'b'], { fingerprint: 'stale' })], history);
    expect(broken!.link).toMatchObject({ status: 'changed', repeated: false });
  });
});

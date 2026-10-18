import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChatMessage } from '@st/shared';
import { messageLinks, changeNote } from './linkMarkers.js';
import { definitionBlocks } from './storyModel.js';
import { StorySection } from './StorySection.js';
import { buildView, entry, linkedWrite, linkTo, reply, userMessage } from './test-fixtures.js';

// A chat of four turns: turn 3 stored a linked item for the messages of turn 1, turn 4 one for turn 2's.
const chat = (): ChatMessage[] => [
  userMessage('u1'),
  reply('e1'),
  userMessage('u2'),
  reply('e2'),
  userMessage('u3'),
  reply('e3'),
  userMessage('u4'),
  reply('e4'),
];

function played(edit: (messages: ChatMessage[]) => ChatMessage[] = (messages) => messages) {
  const original = chat();
  return buildView({
    messages: edit(original),
    entries: [
      entry('e1'),
      entry('e2'),
      entry('e3', [linkedWrite('injected', 'e3:note:0', '**Turn one** summary', linkTo(original, ['u1', 'm-e1']))]),
      entry('e4', [linkedWrite('injected', 'e4:note:0', 'Turn two summary', linkTo(original, ['u2', 'm-e2']))]),
    ],
  });
}

const render = (view = played()) =>
  renderToStaticMarkup(<StorySection story={{ failed: false, view }} onJump={() => {}} onJumpMessage={() => {}} />);
const edited = (id: string) => (messages: ChatMessage[]) =>
  messages.map((message) => (message.id === id ? { ...message, content: 'something else' } : message));
const without = (id: string) => (messages: ChatMessage[]) => messages.filter((message) => message.id !== id);

describe('linked items in the Story state section', () => {
  it('shows the range, an intact badge, a jump to the first message and the text as markdown', () => {
    const html = render();
    expect(html).toContain('messages 1–2 (2)');
    expect(html).toContain('messages 3–4 (2)');
    expect(html).toContain('title="Scroll to the first linked message"');
    expect(html).toContain('>intact<');
    expect(html).toContain('<strong>Turn one</strong> summary');
    // Chat order: the chunk of turn one first although turn two's item was written later.
    expect(html.indexOf('messages 1–2')).toBeLessThan(html.indexOf('messages 3–4'));
    // The link bookkeeping is not an item field.
    expect(html).not.toContain('messages ·');
    expect(html).not.toContain('"ids"');
  });

  it('says what an edited message did to its item', () => {
    const html = render(played(edited('u2')));
    expect(html).toContain('covers an edited message');
    expect(html).toContain('Not used until its messages match again');
  });

  it('says what a deleted message did, and when all of them are gone', () => {
    expect(render(played(without('u2')))).toContain('some messages deleted');
    expect(render(played(without('u2')))).toContain('message 3 (1 of 2 left)');
    const none = render(played((messages) => messages.filter((message) => !['u2', 'm-e2'].includes(message.id))));
    expect(none).toContain('all messages deleted');
    expect(none).toContain('all 2 messages deleted');
  });

  it('keeps a broken item that an intact one replaced under "Replaced or repeated"', () => {
    const original = chat();
    const changed = edited('u1')(original);
    const view = buildView({
      messages: changed,
      entries: [
        entry('e1'),
        entry('e2'),
        entry('e3', [linkedWrite('injected', 'old', 'old summary', linkTo(original, ['u1', 'm-e1']))]),
        entry('e4', [linkedWrite('injected', 'new', 'new summary', linkTo(changed, ['u1', 'm-e1']))]),
      ],
    });
    const html = render(view);
    expect(html).toContain('Replaced or repeated (1)');
    expect(html).toContain('Replaced: intact items link every message of it that is left');
    const hidden = html.slice(html.indexOf('linked-hidden'));
    expect(hidden).toContain('old summary');
    expect(html.slice(0, html.indexOf('linked-hidden'))).toContain('new summary');
  });
});

describe('message links', () => {
  it('lists the items that link to each message, by id', () => {
    const links = messageLinks(played());
    expect(links.get('u1')?.map((note) => note.key)).toEqual(['scene.injected']);
    expect(links.get('u1')?.[0]).toMatchObject({ range: 'messages 1–2 (2)', status: 'intact' });
    expect(links.get('m-e2')?.[0]?.range).toBe('messages 3–4 (2)');
    expect(links.has('u3')).toBe(false);
  });

  it('lists a broken item with its status and leaves out the one an intact item replaced', () => {
    const links = messageLinks(played(edited('u2')));
    expect(links.get('m-e2')?.[0]?.status).toBe('changed');
    expect(messageLinks(undefined).size).toBe(0);
  });

  it('only warns before a change about items that are in use', () => {
    const intact = messageLinks(played()).get('u1');
    expect(changeNote(intact, 'edit')).toBe(
      '1 item of scene.injected links to this message. Changing this message stops it being used until it is made again.',
    );
    expect(changeNote(intact, 'delete')).toContain('Deleting this message stops it being used');
    expect(changeNote(messageLinks(played(edited('u2'))).get('m-e2'), 'edit')).toBeUndefined();
    expect(changeNote(undefined, 'edit')).toBeUndefined();
  });

  it('counts several items', () => {
    const note = (range: string) => ({ key: 'scene.injected', range, preview: '', status: 'intact' as const });
    expect(changeNote([note('a'), note('b')], 'edit')).toContain('2 items of scene.injected link to this message');
  });
});

describe('the model', () => {
  it('keeps unlinked items apart from linked ones in the same key', () => {
    const original = chat();
    const view = buildView({
      messages: original,
      entries: [
        entry('e1', [linkedWrite('injected', 'e1:note:0', 'linked', linkTo(original, ['u1']))]),
        entry('e2', [
          {
            ...linkedWrite('injected', 'e2:note:0', 'plain', { ids: ['u1'] }),
            item: { id: 'e2:note:0', text: 'plain' },
          },
        ]),
      ],
    });
    const row = definitionBlocks(view)[0]?.keys.find((key) => key.key === 'injected');
    expect(row?.plain.map((item) => item.text)).toEqual(['plain']);
    expect(row?.linked?.used.map((item) => item.text)).toEqual(['linked']);
    expect(row?.items).toHaveLength(2);
  });
});

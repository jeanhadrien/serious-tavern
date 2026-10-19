import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { activeMessages, forkPoints, type ChatMessage } from '@st/shared';
import { MessageList } from './MessageList.js';

// The Fork button: only on the replies `forkPoints` names, locked while the chat is.

const user = (id: string, executionId: string): ChatMessage => ({
  id,
  role: 'user',
  content: 'hi',
  createdAt: '',
  executionId,
});
const reply = (id: string, executionId: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  role: 'assistant',
  content: `text ${id}`,
  createdAt: '',
  executionId,
  ...extra,
});

function render(messages: ChatMessage[], props: { disabled?: boolean; withFork?: boolean } = {}) {
  const shown = activeMessages(messages);
  return renderToStaticMarkup(
    <MessageList
      sessionId="s"
      messages={shown}
      forkable={props.withFork === false ? undefined : new Set(forkPoints(shown))}
      onFork={() => {}}
      characters={[]}
      logs={{}}
      busy={false}
      disabled={props.disabled ?? false}
      onEdit={async () => true}
      onDelete={async () => true}
      onRegenerate={() => {}}
      onSwipe={async () => true}
    />,
  );
}

const LABEL = 'Fork chat from here';
const count = (html: string) => html.split(`aria-label="${LABEL}"`).length - 1;
/** The message ids of the articles that carry the Fork button. */
const forkedIds = (html: string) =>
  [...html.matchAll(/<article[^>]*data-message-id="([^"]+)"[\s\S]*?<\/article>/g)]
    .filter((match) => match[0].includes(`aria-label="${LABEL}"`))
    .map((match) => match[1]);

describe('fork button', () => {
  it('is on every reply when each turn has one, and never on a user message', () => {
    const html = render([user('u1', 'e1'), reply('a1', 'e1'), user('u2', 'e2'), reply('a2', 'e2')]);
    expect(forkedIds(html)).toEqual(['a1', 'a2']);
  });

  it('is on the last reply only of a turn with two replies', () => {
    const html = render([user('u1', 'e1'), reply('a1', 'e1'), reply('a2', 'e1')]);
    expect(forkedIds(html)).toEqual(['a2']);
  });

  it('is not on a streaming row, nor on a hidden alternative', () => {
    const html = render([
      user('u1', 'e1'),
      reply('a1', 'e1', { inactive: true }),
      reply('b1', 'e2', { alternativeOf: 'e1' }),
      user('u2', 'e3'),
      reply('s', 'e3', { status: 'streaming' }),
    ]);
    expect(forkedIds(html)).toEqual(['b1']);
    expect(html).not.toContain('text a1');
  });

  it('is absent when the list is given no fork points', () => {
    expect(count(render([user('u1', 'e1'), reply('a1', 'e1')], { withFork: false }))).toBe(0);
  });

  it('is disabled while a message change is saved', () => {
    const html = render([user('u1', 'e1'), reply('a1', 'e1')], { disabled: true });
    expect(html).toMatch(new RegExp(`aria-label="${LABEL}"[^>]*disabled=""|disabled=""[^>]*aria-label="${LABEL}"`));
  });

  it('is enabled otherwise', () => {
    const html = render([user('u1', 'e1'), reply('a1', 'e1')]);
    expect(count(html)).toBe(1);
    expect(html).not.toMatch(new RegExp(`disabled=""[^>]*aria-label="${LABEL}"|aria-label="${LABEL}"[^>]*disabled=""`));
  });
});

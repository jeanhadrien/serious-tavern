import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { activeMessages, alternativesOfLastTurn, type ChatMessage } from '@st/shared';
import { MessageList } from './MessageList.js';

// The regenerate and swipe controls: on the last reply of the last turn only, from the shared alternatives rules.

const user = (id: string, executionId?: string): ChatMessage => ({
  id,
  role: 'user',
  content: 'hi',
  createdAt: '',
  ...(executionId && { executionId }),
});
const reply = (id: string, executionId: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  role: 'assistant',
  content: `text ${id}`,
  createdAt: '',
  executionId,
  ...extra,
});

function render(messages: ChatMessage[], props: { busy?: boolean; disabled?: boolean } = {}) {
  return renderToStaticMarkup(
    <MessageList
      sessionId="s"
      messages={activeMessages(messages)}
      lastTurn={props.busy ? null : alternativesOfLastTurn(messages)}
      characters={[]}
      logs={{}}
      busy={props.busy ?? false}
      disabled={props.disabled ?? false}
      onEdit={async () => true}
      onDelete={async () => true}
      onRegenerate={() => {}}
      onSwipe={async () => true}
    />,
  );
}

const count = (html: string, label: string) => html.split(`aria-label="${label}"`).length - 1;

describe('regenerate and swipe controls', () => {
  it('offers Regenerate, and no swipe, on the last reply of a turn that was never regenerated', () => {
    const html = render([user('u', 'e1'), reply('a1', 'e1'), reply('a2', 'e1')]);
    expect(count(html, 'Regenerate reply')).toBe(1);
    expect(html).not.toContain('Previous alternative');
    // On the last of the turn's replies, not the first.
    expect(html.indexOf('Regenerate reply')).toBeGreaterThan(html.indexOf('text a2'));
  });

  it('shows n/N and both swipe buttons once there are two alternatives, for the shown one only', () => {
    const html = render([
      user('u', 'e1'),
      reply('a1', 'e1', { inactive: true }),
      reply('b1', 'e2', { alternativeOf: 'e1' }),
    ]);
    expect(html).toContain('2/2');
    expect(html).not.toContain('text a1');
    expect(count(html, 'Previous alternative')).toBe(1);
    expect(count(html, 'Next alternative')).toBe(1);
    // The newest alternative has no next one.
    expect(html).toMatch(/aria-label="Next alternative"[^>]*disabled=""|disabled=""[^>]*aria-label="Next alternative"/);
    expect(html).not.toMatch(
      /disabled=""[^>]*aria-label="Previous alternative"|aria-label="Previous alternative"[^>]*disabled=""/,
    );
  });

  it('counts the shown position when an older alternative is shown', () => {
    const html = render([
      user('u', 'e1'),
      reply('a1', 'e1'),
      reply('b1', 'e2', { alternativeOf: 'e1', inactive: true }),
      reply('c1', 'e3', { alternativeOf: 'e1', inactive: true }),
    ]);
    expect(html).toContain('1/3');
  });

  it('shows no controls once a message follows the turn, in an empty chat, or while a run is in flight', () => {
    const turn = [user('u', 'e1'), reply('a1', 'e1')];
    expect(render([...turn, user('next')])).not.toContain('Regenerate reply');
    expect(render([])).not.toContain('Regenerate reply');
    expect(render(turn, { busy: true })).not.toContain('Regenerate reply');
  });

  it('disables the buttons while a message change is being saved', () => {
    const html = render([user('u', 'e1'), reply('a1', 'e1')], { disabled: true });
    expect(html).toMatch(/aria-label="Regenerate reply"[^>]*disabled=""|disabled=""[^>]*aria-label="Regenerate reply"/);
  });
});

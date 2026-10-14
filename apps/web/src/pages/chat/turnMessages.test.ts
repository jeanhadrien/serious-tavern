import { expect, it } from 'vitest';
import type { ChatMessage } from '@st/shared';
import { applyDelta, settleTurn } from './turnMessages.js';

const user = (id: string): ChatMessage => ({ id, role: 'user', content: 'hi', createdAt: '' });
const assistant = (id: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  role: 'assistant',
  content: 'ok',
  createdAt: '',
  ...extra,
});

it('creates one streaming row per output and grows it with text and reasoning', () => {
  let messages = applyDelta([user('u')], 'out', undefined, 'think ');
  messages = applyDelta(messages, 'out', 'Hel');
  messages = applyDelta(messages, 'other', 'B');
  messages = applyDelta(messages, 'out', 'lo', 'more');
  expect(messages).toHaveLength(3);
  expect(messages[1]).toMatchObject({ nodeId: 'out', status: 'streaming', content: 'Hello', reasoning: 'think more' });
  expect(messages[2]).toMatchObject({ nodeId: 'other', content: 'B' });
  expect(messages[2]?.reasoning).toBeUndefined();
});

it('settles a turn by replacing local rows with the saved ones and keeping older history', () => {
  const live = assistant('live', { status: 'streaming', nodeId: 'out' });
  const messages = [assistant('old', { status: 'partial' }), user('optimistic'), live];
  const saved = { userMessage: user('saved'), assistantMessages: [assistant('final', { status: 'final' })] };
  expect(settleTurn(messages, 'optimistic', saved).map((message) => message.id)).toEqual(['old', 'saved', 'final']);
});

it('settles an empty send, which has no user message, without adding one', () => {
  const messages = [user('old'), assistant('live', { status: 'streaming', nodeId: 'out' })];
  const saved = { assistantMessages: [assistant('final', { status: 'final' })] };
  expect(settleTurn(messages, undefined, saved).map((message) => message.id)).toEqual(['old', 'final']);
});

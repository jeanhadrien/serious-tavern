import { expect, it } from 'vitest';
import type { ChatMessage } from '@st/shared';
import { replyIndex } from './reply-order.js';

const message = (id: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  role: 'assistant',
  content: id,
  createdAt: '',
  executionId: 't',
  ...extra,
});
const order = ['r0', 'r1', 'r2'];

it('goes at the end when no run listed below has a reply yet', () => {
  const messages = [message('u', { role: 'user' }), message('x', { runId: 'r0' })];
  expect(replyIndex(messages, 't', order, 1)).toBe(2);
  expect(replyIndex([], 't', order, 0)).toBe(0);
});

it('goes before the first reply of a run listed below it, settled or still streaming', () => {
  const messages = [
    message('u', { role: 'user' }),
    message('x', { runId: 'r0' }),
    message('y', { runId: 'r2', status: 'streaming' }),
    message('z', { runId: 'r1' }),
  ];
  expect(replyIndex(messages, 't', order, 0)).toBe(2);
  expect(replyIndex(messages, 't', order, 1)).toBe(2);
  expect(replyIndex(messages, 't', order, 2)).toBe(4);
});

it("ignores other turns, the user message, a run's own rows and replies whose run is not listed", () => {
  const messages = [
    message('old', { executionId: 'earlier', runId: 'r2' }),
    message('u', { role: 'user', runId: 'r2' }),
    message('own', { runId: 'r1' }),
    message('legacy'),
    message('stranger', { runId: 'nope' }),
  ];
  expect(replyIndex(messages, 't', order, 1)).toBe(5);
});

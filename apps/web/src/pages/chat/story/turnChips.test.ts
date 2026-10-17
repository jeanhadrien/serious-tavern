import { expect, it } from 'vitest';
import type { ChatMessage } from '@st/shared';
import { addWrite, buildView, drawWrite, entry, reply, setWrite, userMessage } from './test-fixtures.js';
import { chipsFor, describeTurns } from './turnChips.js';

const chips = (view: ReturnType<typeof buildView> | undefined, messages: ChatMessage[]) =>
  chipsFor(describeTurns(view), messages);

it('puts the chip on the reply of a turn that stored something', () => {
  const messages = [userMessage(), reply('e1')];
  const view = buildView({ messages, entries: [entry('e1', [setWrite('tension', 6)])] });
  expect(chips(view, messages)).toEqual(
    new Map([['m-e1', { turnNumber: 1, lines: ['scene.tension → 6'], editedAfter: false }]]),
  );
});

it('puts one chip on the last reply of a turn with several replies', () => {
  const messages = [userMessage(), reply('e1', { nodeId: 'a' }), reply('e1', { nodeId: 'b' })];
  const view = buildView({ messages, entries: [entry('e1', [setWrite('tension', 6)], 2)] });
  expect([...chips(view, messages).keys()]).toEqual(['m-e1-b']);
});

it('skips a reply that is still streaming', () => {
  const messages = [reply('e1', { nodeId: 'a' }), reply('e1', { nodeId: 'b', status: 'streaming' })];
  const view = buildView({
    messages: [messages[0] as ChatMessage],
    entries: [entry('e1', [setWrite('tension', 6)], 2)],
  });
  expect([...chips(view, messages).keys()]).toEqual(['m-e1-a']);
});

it('counts a stopped reply', () => {
  const messages = [reply('e1', { status: 'partial' })];
  const view = buildView({ messages, entries: [entry('e1', [setWrite('tension', 6)], 1, false)] });
  expect([...chips(view, messages).keys()]).toEqual(['m-e1']);
});

it('has no chip for a turn without writes, one whose replies were deleted, or an unknown turn', () => {
  const messages = [userMessage(), reply('e1'), reply('e3')];
  const view = buildView({
    messages: [reply('e1')],
    entries: [entry('e1'), entry('e2', [setWrite('tension', 6)]), entry('e3', [])],
  });
  expect(chips(view, messages).size).toBe(0);
  expect(chips(view, [reply('unknown')]).size).toBe(0);
});

it('has no chip for a turn whose replies are gone from the local list, or without a view', () => {
  const view = buildView({ messages: [reply('e1')], entries: [entry('e1', [setWrite('tension', 6)])] });
  expect(chips(view, [userMessage()]).size).toBe(0);
  expect(chips(undefined, [reply('e1')]).size).toBe(0);
});

it('never puts a chip on a user message', () => {
  const messages = [{ ...userMessage(), executionId: 'e1' }, reply('e1')];
  const view = buildView({ messages, entries: [entry('e1', [setWrite('tension', 6)])] });
  expect([...chips(view, messages).keys()]).toEqual(['m-e1']);
});

it('flags the chip when any reply of the turn was edited', () => {
  const messages = [reply('e1', { nodeId: 'a', editedAt: '2026-01-02T00:00:00.000Z' }), reply('e1', { nodeId: 'b' })];
  const view = buildView({ messages, entries: [entry('e1', [setWrite('tension', 6)], 2)] });
  expect(chips(view, messages).get('m-e1-b')?.editedAfter).toBe(true);
  const plain = [reply('e1', { nodeId: 'a' }), reply('e1', { nodeId: 'b' })];
  expect(chips(view, plain).get('m-e1-b')?.editedAfter).toBe(false);
});

it('numbers each turn and lists its writes in write order', () => {
  const messages = [reply('e1'), reply('e2')];
  const view = buildView({
    messages,
    entries: [
      entry('e1', [setWrite('tension', 5)]),
      entry('e2', [addWrite('injected', 'i1', 'a bell'), setWrite('tension', 7), drawWrite('d1', 'resin')]),
    ],
  });
  const result = chips(view, messages);
  expect(result.get('m-e2')).toEqual({
    turnNumber: 2,
    lines: ["scene.injected + 'a bell'", 'scene.tension → 7', "Draw #1 (draw): drew 'resin'"],
    editedAfter: false,
  });
  expect(result.get('m-e1')?.turnNumber).toBe(1);
});

it('follows a renumbering when an earlier turn lost its replies', () => {
  const messages = [reply('e2')];
  const view = buildView({
    messages,
    entries: [entry('e1', [setWrite('tension', 5)]), entry('e2', [setWrite('tension', 7)])],
  });
  expect(chips(view, messages).get('m-e2')?.turnNumber).toBe(1);
});

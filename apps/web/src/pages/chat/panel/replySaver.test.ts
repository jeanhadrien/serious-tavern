import { expect, it } from 'vitest';
import type { ReplyEntry } from '@st/shared';
import { createReplySaver } from './replySaver.js';

const list = (...ids: string[]): ReplyEntry[] => ids.map((workflowId) => ({ workflowId, enabled: true }));
const ids = (value: ReplyEntry[] | undefined) => value?.map((entry) => entry.workflowId).join('');

/** A save whose answers the test gives, one request at a time. */
function harness() {
  const sent: ReplyEntry[][] = [];
  const answers: ((saved: boolean) => void)[] = [];
  const shown: (ReplyEntry[] | undefined)[] = [];
  const saver = createReplySaver(
    (next) => {
      sent.push(next);
      return new Promise<boolean>((resolve) => answers.push(resolve));
    },
    (pending) => shown.push(pending),
  );
  const answer = async (saved = true) => {
    answers.shift()?.(saved);
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { saver, sent, shown, answer };
}

it('sends a change at once and clears the shown list when the answer is in', async () => {
  const { saver, sent, shown, answer } = harness();
  saver.change(list('a', 'b'));
  expect(sent.map(ids)).toEqual(['ab']);
  expect(ids(shown.at(-1))).toBe('ab');
  await answer();
  expect(shown.at(-1)).toBeUndefined();
});

it('keeps one request in flight and sends only the newest list meanwhile, so answers arrive in order', async () => {
  const { saver, sent, shown, answer } = harness();
  saver.change(list('a'));
  saver.change(list('a', 'b'));
  saver.change(list('a', 'b', 'c'));
  expect(sent.map(ids)).toEqual(['a']);
  expect(ids(shown.at(-1))).toBe('abc');
  await answer();
  // The list stays shown while a newer one is still to be confirmed.
  expect(sent.map(ids)).toEqual(['a', 'abc']);
  expect(shown.at(-1)).toBeDefined();
  await answer();
  expect(sent).toHaveLength(2);
  expect(shown.at(-1)).toBeUndefined();
});

it('drops what was waiting after a failed save and shows what the server holds', async () => {
  const { saver, sent, shown, answer } = harness();
  saver.change(list('a'));
  saver.change(list('a', 'b'));
  await answer(false);
  expect(sent).toHaveLength(1);
  expect(shown.at(-1)).toBeUndefined();
  // The next change starts a new request.
  saver.change(list('c'));
  expect(sent.map(ids)).toEqual(['a', 'c']);
});

it('treats a save that throws like a failed one', async () => {
  const shown: (ReplyEntry[] | undefined)[] = [];
  const saver = createReplySaver(
    () => Promise.reject(new Error('offline')),
    (pending) => shown.push(pending),
  );
  saver.change(list('a'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(shown.at(-1)).toBeUndefined();
});

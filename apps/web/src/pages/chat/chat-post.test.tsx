import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Composer } from './Composer.js';
import { ExecutionDetails } from './ExecutionDetails.js';
import { MessageList } from './MessageList.js';
import { afterRun, buildView, entry, reply, userMessage } from './story/test-fixtures.js';
import { watchResize } from './useStickToBottom.js';

// The chat's behaviour around runs after the reply: the waiting indicator, the composer's cancel, the thread watching its viewport.

it('says a message is waiting for the workflows after the reply while the previous turn’s run works', () => {
  const messages = [reply('e1'), userMessage('u2')];
  const render = (story: ReturnType<typeof buildView>, busy = true) =>
    renderToStaticMarkup(
      <MessageList
        sessionId="s"
        messages={messages}
        characters={[]}
        logs={{}}
        story={story}
        busy={busy}
        disabled
        onEdit={async () => true}
        onDelete={async () => true}
        onRegenerate={() => {}}
        onSwipe={async () => true}
      />,
    );
  const entries = (status: 'running' | 'completed') => [{ ...entry('e1'), ...afterRun(status) }];
  expect(render(buildView({ messages, entries: entries('running') }))).toContain(
    'Waiting for the workflows after the reply to finish',
  );
  const done = render(buildView({ messages, entries: entries('completed') }));
  expect(done).toContain('Preparing a reply');
  expect(done).not.toContain('Waiting for the workflows after the reply');
  // Not waiting for a reply at all: no indicator.
  expect(render(buildView({ messages, entries: entries('running') }), false)).not.toContain('typing-dots');
});

it('shows the label the caller gives an execution log', () => {
  const html = renderToStaticMarkup(<ExecutionDetails id="x" label="Run details" optional />);
  expect(html).toContain('<summary>Run details</summary>');
  expect(renderToStaticMarkup(<ExecutionDetails id="x" />)).toContain('<summary>Execution details</summary>');
});

it('watches every element it is given, skips missing ones, and stops watching on cleanup', () => {
  const observed: unknown[] = [];
  let disconnected = 0;
  let callback: () => void = () => {};
  class FakeObserver {
    constructor(onResize: () => void) {
      callback = onResize;
    }
    observe(element: unknown) {
      observed.push(element);
    }
    disconnect() {
      disconnected++;
    }
  }
  const content = {} as Element;
  const viewport = {} as Element;
  let resizes = 0;
  const stop = watchResize([content, null, viewport], () => resizes++, FakeObserver);
  // The thread's viewport is watched too, so a row that appears below it re-sticks the newest message.
  expect(observed).toEqual([content, viewport]);
  callback();
  expect(resizes).toBe(1);
  stop();
  expect(disconnected).toBe(1);
  expect(watchResize([content], () => {}, undefined)).toBeTypeOf('function');
});

it('labels the composer button for a message that waits behind a run after the reply', () => {
  const render = (queued: boolean) =>
    renderToStaticMarkup(
      <Composer content="" busy queued={queued} locked onChange={() => {}} onSend={async () => {}} onStop={() => {}} />,
    );
  expect(render(false)).toContain('aria-label="Stop generation"');
  expect(render(false)).toContain('Generating… Esc to stop');
  const queued = render(true);
  expect(queued).toContain('aria-label="Cancel queued message"');
  expect(queued).toContain('title="Cancel queued message"');
  expect(queued).toContain('Esc to cancel');
  expect(queued).not.toContain('Stop generation');
});

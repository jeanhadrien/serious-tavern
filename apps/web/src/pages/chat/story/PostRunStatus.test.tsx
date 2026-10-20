import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PostRunStatus } from './PostRunStatus.js';

const noop = () => {};

it('renders nothing without a running run after the reply', () => {
  expect(renderToStaticMarkup(<PostRunStatus sessionId="s" onStopped={noop} />)).toBe('');
});

it('is a polite status with the label and a stop button', () => {
  const html = renderToStaticMarkup(
    <PostRunStatus sessionId="s" run={{ executionId: 'p1', status: 'running', turnNumber: 3 }} onStopped={noop} />,
  );
  expect(html).toContain('role="status"');
  expect(html).toContain('aria-live="polite"');
  expect(html).toContain('Running after the reply… (turn 3)');
  const button = html.match(/<button[^>]*>/)?.[0] ?? '';
  expect(button).toContain('aria-label="Stop the workflows running after the reply"');
  expect(button).toContain('title="Stop the workflows running after the reply"');
});

it('leaves out the turn when the run does not know it', () => {
  const html = renderToStaticMarkup(
    <PostRunStatus sessionId="s" run={{ executionId: 'p1', status: 'running', turnNumber: null }} onStopped={noop} />,
  );
  expect(html).toContain('Running after the reply…<');
  expect(html).not.toContain('(turn');
});

it('says which workflow runs when the view knows it', () => {
  const html = renderToStaticMarkup(
    <PostRunStatus
      sessionId="s"
      run={{ executionId: 'p1', status: 'running', turnNumber: 3, workflowName: 'Memory' }}
      onStopped={noop}
    />,
  );
  expect(html).toContain('Running Memory after the reply… (turn 3)');
});

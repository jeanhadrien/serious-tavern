import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PostRunStatus } from './PostRunStatus.js';

const noop = () => {};

it('renders nothing without a running after-reply run', () => {
  expect(renderToStaticMarkup(<PostRunStatus sessionId="s" onStopped={noop} />)).toBe('');
});

it('is a polite status with the label and a stop button', () => {
  const html = renderToStaticMarkup(
    <PostRunStatus sessionId="s" run={{ status: 'running', turnNumber: 3 }} onStopped={noop} />,
  );
  expect(html).toContain('role="status"');
  expect(html).toContain('aria-live="polite"');
  expect(html).toContain('Running after-reply steps… (turn 3)');
  const button = html.match(/<button[^>]*>/)?.[0] ?? '';
  expect(button).toContain('aria-label="Stop after-reply steps"');
  expect(button).toContain('title="Stop after-reply steps"');
});

it('leaves out the turn when the run does not know it', () => {
  const html = renderToStaticMarkup(
    <PostRunStatus sessionId="s" run={{ status: 'running', turnNumber: null }} onStopped={noop} />,
  );
  expect(html).toContain('Running after-reply steps…<');
  expect(html).not.toContain('(turn');
});

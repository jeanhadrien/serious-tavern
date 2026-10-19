import { afterEach, expect, it, vi } from 'vitest';
import { alerts } from '../../alerts/index.js';
import { copyMessageText } from './copyText.js';

afterEach(() => alerts.clear());

it('copies the raw text and shows a short "Copied" toast', async () => {
  const writeText = vi.fn(async () => {});
  expect(await copyMessageText('**bold** `code`', { writeText })).toBe(true);
  expect(writeText).toHaveBeenCalledWith('**bold** `code`');
  const [toast] = alerts.getSnapshot();
  expect(toast).toMatchObject({ level: 'success', message: 'Copied', timeoutMs: 1500 });
});

it('shows an error toast when the clipboard refuses or is missing', async () => {
  const refusing = { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) };
  expect(await copyMessageText('x', refusing)).toBe(false);
  expect(alerts.getSnapshot()[0]).toMatchObject({ level: 'error', message: 'Could not copy the message' });
  alerts.clear();
  expect(await copyMessageText('x', undefined)).toBe(false);
  expect(alerts.getSnapshot()[0]).toMatchObject({ level: 'error', message: 'Could not copy the message' });
});

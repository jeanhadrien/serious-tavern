import { expect, it } from 'vitest';
import { formatLastSync, formatSyncResult } from './importConnectors.js';

it('summarises a sync with every count', () => {
  expect(formatSyncResult('SillyTavern', { created: 2, updated: 1, unchanged: 5, missing: 0 })).toBe(
    'SillyTavern synced: 2 created, 1 updated, 5 unchanged, 0 missing.',
  );
});

it('shows the last sync time or that the connector never synced', () => {
  expect(formatLastSync(undefined)).toBe('Never synced.');
  expect(formatLastSync('2026-10-12T10:00:00.000Z')).toContain('Last synced ');
});

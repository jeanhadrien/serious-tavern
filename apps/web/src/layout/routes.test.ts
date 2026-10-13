import { expect, it } from 'vitest';
import { isKnownPath, routeTarget } from './routes.js';

it('maps resource paths to resources and leaves the chat path alone', () => {
  expect(routeTarget('/presets', '')?.resource).toBe('presets');
  expect(routeTarget('/workflows', '')?.resource).toBe('workflows');
  expect(routeTarget('/', '')).toBeUndefined();
  expect(isKnownPath('/')).toBe(true);
  expect(isKnownPath('/settings')).toBe(true);
  expect(isKnownPath('/nope')).toBe(false);
});

it('opens the editor of a split resource only when the URL names an item', () => {
  expect(routeTarget('/workflows', '')).toEqual({ resource: 'workflows', openEditor: false });
  expect(routeTarget('/workflows', '?workflow=w1&edge=e1')).toEqual({ resource: 'workflows', openEditor: true });
  expect(routeTarget('/presets', '?id=p1')).toEqual({ resource: 'presets', openEditor: true });
  expect(routeTarget('/presets', '?workflow=w1')?.openEditor).toBe(false);
});

it('only shows the column content of resources whose URLs cannot name an item', () => {
  expect(routeTarget('/settings', '')).toEqual({ resource: 'settings', openEditor: false });
  expect(routeTarget('/characters', '')).toEqual({ resource: 'characters', openEditor: false });
  expect(routeTarget('/personas', '?id=p1')?.openEditor).toBe(false);
});

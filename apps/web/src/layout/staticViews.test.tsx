import { expect, it } from 'vitest';
import { LISTLESS, RESOURCE_IDS } from './state.js';
import { DIRTY_SOURCES, STATIC_VIEWS } from './staticViews.js';

it('shows a dirty dot for every resource editor except the settings page', () => {
  expect(Object.keys(DIRTY_SOURCES).sort()).toEqual(RESOURCE_IDS.filter((id) => id !== 'settings').sort());
});

it('has a list view for every listed resource and an editor view for every resource', () => {
  const lists = RESOURCE_IDS.filter((id) => !LISTLESS.includes(id)).map((id) => `list:${id}`);
  expect(Object.keys(STATIC_VIEWS).sort()).toEqual([...lists, ...RESOURCE_IDS.map((id) => `editor:${id}`)].sort());
});

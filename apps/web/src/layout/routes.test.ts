import { expect, it } from 'vitest';
import { legacySearch } from './routes.js';

it('maps legacy item links to a wide editor, edge highlight included', () => {
  expect(legacySearch('/workflows', '?workflow=w1&edge=e1')).toBe('wide=workflow:w1&edge=e1');
  expect(legacySearch('/presets', '?id=p1')).toBe('left=presets&wide=preset:p1');
});

it('maps legacy list paths to the column that holds them', () => {
  expect(legacySearch('/workflows', '')).toBe('');
  expect(legacySearch('/presets', '')).toBe('left=presets');
  expect(legacySearch('/characters', '')).toBe('right=characters');
  expect(legacySearch('/personas', '?id=x')).toBe('right=personas');
  expect(legacySearch('/settings', '')).toBe('left=settings');
  expect(legacySearch('/collections', '')).toBe('right=collections');
});

it("maps the node panels' collection link to the collection editor in R", () => {
  expect(legacySearch('/collections', '?id=k1')).toBe('right=collection:k1');
});

it('sends unknown paths to the default layout', () => {
  expect(legacySearch('/nope', '?id=p1')).toBe('');
});

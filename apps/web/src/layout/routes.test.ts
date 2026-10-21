import { expect, it } from 'vitest';
import { collectionLinkId, legacySearch, panelLinkTarget, stateDefinitionLinkId } from './routes.js';

it('maps legacy item links to a wide editor, edge highlight included', () => {
  expect(legacySearch('/workflows', '?workflow=w1&edge=e1')).toBe('wide=workflow:w1&edge=e1');
  expect(legacySearch('/presets', '?id=p1')).toBe('left=presets&wide=preset:p1');
  expect(legacySearch('/workflows', '?workflow=w1&node=n1')).toBe('wide=workflow:w1&node=n1');
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

it('finds the collection a link opens in R', () => {
  expect(collectionLinkId('/collections?id=k1')).toBe('k1');
  expect(collectionLinkId('/collections?id=a%2Fb')).toBe('a/b');
  expect(collectionLinkId('/?right=collection:k2')).toBe('k2');
  expect(collectionLinkId('/collections')).toBeUndefined();
  expect(collectionLinkId('/presets?id=x')).toBeUndefined();
});

it("maps the node panels' state definition link to the definition editor in L", () => {
  expect(legacySearch('/state-definitions', '?id=d1')).toBe('left=stateDefinition:d1');
  expect(legacySearch('/state-definitions', '')).toBe('left=stateDefinitions');
  expect(legacySearch('/state-definitions', '?id=a%2Fb')).toBe('left=stateDefinition:a%2Fb');
});

it('finds the state definition a link opens in L', () => {
  expect(stateDefinitionLinkId('/state-definitions?id=d1')).toBe('d1');
  expect(stateDefinitionLinkId('/state-definitions?id=a%2Fb')).toBe('a/b');
  expect(stateDefinitionLinkId('/?left=stateDefinition:d2')).toBe('d2');
  expect(stateDefinitionLinkId('/state-definitions')).toBeUndefined();
  expect(stateDefinitionLinkId('/collections?id=k1')).toBeUndefined();
  expect(stateDefinitionLinkId('/presets?id=x')).toBeUndefined();
  // A collection link is not a state definition link, and the other way round.
  expect(collectionLinkId('/state-definitions?id=d1')).toBeUndefined();
});

it('says what a link from a node panel opens in place', () => {
  expect(panelLinkTarget('/collections?id=k1')).toEqual({ kind: 'collection', id: 'k1' });
  expect(panelLinkTarget('/?right=collection:k2')).toEqual({ kind: 'collection', id: 'k2' });
  expect(panelLinkTarget('/state-definitions?id=d1')).toEqual({ kind: 'stateDefinition', id: 'd1' });
  expect(panelLinkTarget('/?left=stateDefinition:d2')).toEqual({ kind: 'stateDefinition', id: 'd2' });
  // Anything else follows its URL: a preset, or a list without an id.
  expect(panelLinkTarget('/presets?id=x')).toBeUndefined();
  expect(panelLinkTarget('/collections')).toBeUndefined();
  expect(panelLinkTarget('/state-definitions')).toBeUndefined();
});

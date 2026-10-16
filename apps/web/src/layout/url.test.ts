import { expect, it } from 'vitest';
import { viewSlots } from './derive.js';
import { DESIGN_KINDS, initialLayout, layoutReducer, type LayoutAction, type LayoutState } from './state.js';
import {
  formatLayoutUrl,
  layoutHref,
  layoutToUrl,
  parseLayoutUrl,
  phoneEditorLoading,
  sameContent,
  urlTarget,
  type LayoutUrl,
} from './url.js';

const run = (state: LayoutState, ...actions: LayoutAction[]) => actions.reduce(layoutReducer, state);
const start = () => initialLayout(DESIGN_KINDS);
/** URL -> layout -> URL, as a reload does. */
const reload = (search: string, ids: Parameters<typeof layoutToUrl>[1], session?: string) =>
  formatLayoutUrl(
    layoutToUrl(run(start(), { type: 'restore', target: urlTarget(parseLayoutUrl(search)) }), ids, session),
  );

it('writes the default layout as an empty query', () => {
  expect(formatLayoutUrl(layoutToUrl(start(), {}))).toBe('');
  expect(layoutHref({})).toBe('/');
});

it('round-trips layouts through the URL and the reducer', () => {
  const cases: [string, Parameters<typeof layoutToUrl>[1], string | undefined][] = [
    ['session=s1', {}, 's1'],
    ['left=presets&wide=preset:p1', { presets: 'p1' }, undefined],
    ['session=s1&wide=workflow:w1&right=characters', { workflows: 'w1' }, 's1'],
    ['right=character:c1', { characters: 'c1' }, undefined],
    ['left=settings&right=personas', {}, undefined],
    ['left=presets&wide=preset:p1&right=persona:x', { presets: 'p1', personas: 'x' }, undefined],
    ['left=providers', {}, undefined],
    ['left=provider:openrouter', { providers: 'openrouter' }, undefined],
    ['left=provider:x&right=character:c', { providers: 'x', characters: 'c' }, undefined],
    [
      'session=s1&left=provider:x&wide=workflow:w1&right=persona:p',
      { providers: 'x', workflows: 'w1', personas: 'p' },
      's1',
    ],
    ['left=stateDefinitions', {}, undefined],
    ['left=stateDefinition:abc', { stateDefinitions: 'abc' }, undefined],
    ['left=stateDefinition:x&right=character:c', { stateDefinitions: 'x', characters: 'c' }, undefined],
    [
      'session=s1&left=stateDefinition:x&wide=workflow:w1&right=persona:p',
      { stateDefinitions: 'x', workflows: 'w1', personas: 'p' },
      's1',
    ],
    ['right=collections', {}, undefined],
    ['right=collection:k1', { collections: 'k1' }, undefined],
    ['left=provider:x&right=collection:k', { providers: 'x', collections: 'k' }, undefined],
    ['left=presets&wide=preset:p1&right=collection:k', { presets: 'p1', collections: 'k' }, undefined],
  ];
  for (const [search, ids, session] of cases) expect(reload(search, ids, session)).toBe(search);
});

it('reflects what the reducer does, not just what was parsed', () => {
  const opened = run(start(), { type: 'openEditor', id: 'presets' }, { type: 'selectTab', id: 'presets' });
  expect(formatLayoutUrl(layoutToUrl(opened, { presets: 'p1' }))).toBe('left=presets&wide=preset:p1');
  // The editor has no item yet: the URL does not claim one.
  expect(formatLayoutUrl(layoutToUrl(opened, {}))).toBe('left=presets');
  const narrow = run(start(), { type: 'openEditor', id: 'characters' });
  expect(formatLayoutUrl(layoutToUrl(narrow, { characters: 'c1' }))).toBe('right=character:c1');
  expect(formatLayoutUrl(layoutToUrl(narrow, {}))).toBe('right=characters');
});

it('falls back to defaults on garbage', () => {
  const defaults = parseLayoutUrl('');
  for (const garbage of [
    'left=nope&right=%%&wide=&session=',
    'wide=chat:1&right=chat',
    'right=character&left=chat',
    'wide=preset:&right=persona:',
    'left=character:c1&right=provider:x',
    'right=collection:&left=collection:k',
    'left=stateDefinition:&right=stateDefinition:x',
    '%E0%A4%A&&===',
  ]) {
    const url = parseLayoutUrl(garbage);
    expect(url.left).toBe(defaults.left);
    expect(url.session).toBeUndefined();
    expect(url.wideId).toBeUndefined();
    expect(url.rightId).toBeUndefined();
    expect(url.leftId).toBeUndefined();
    expect(() => run(start(), { type: 'restore', target: urlTarget(url) })).not.toThrow();
  }
  expect(parseLayoutUrl('right=chat').right).toBe('chats');
  expect(parseLayoutUrl('wide=preset&right=chat').right).toBe('chat');
});

it('keeps ids with colons and special characters intact', () => {
  const url: LayoutUrl = { left: 'workflows', right: 'chat', wide: 'workflows', wideId: 'a:b&c d', session: 's/1' };
  expect(parseLayoutUrl(formatLayoutUrl(url))).toMatchObject({ wideId: 'a:b&c d', session: 's/1' });
});

it('restoring keeps hidden narrow editors and dirty flags', () => {
  const state = run(
    start(),
    { type: 'openEditor', id: 'characters' },
    { type: 'selectTab', id: 'personas' },
    { type: 'setDirty', id: 'characters', dirty: true },
  );
  const restored = run(state, { type: 'restore', target: urlTarget(parseLayoutUrl('left=presets')) });
  expect(restored.narrowOpen.characters).toBe(true);
  expect(restored.dirty.characters).toBe(true);
  expect(restored.tabs).toEqual({ L: 'presets', R: 'chats' });
});

it('restoring a URL without the wide editor returns the chat to M', () => {
  const state = run(start(), { type: 'openEditor', id: 'presets' });
  const restored = run(state, { type: 'restore', target: urlTarget(parseLayoutUrl('')) });
  expect(restored.wide).toBeUndefined();
  expect(restored.tabs.R).toBe('chats');
});

it('does not put the chat in R in compact mode', () => {
  const compact = initialLayout(DESIGN_KINDS, true);
  const restored = run(compact, { type: 'restore', target: urlTarget(parseLayoutUrl('wide=preset:p1')) });
  expect(restored.wide).toBe('presets');
  expect(restored.tabs.R).toBe('chats');
  expect(run(restored, { type: 'setCompact', compact: false }).tabs.R).toBe('chat');
});

it('opens the providers editor in compact mode, where L shows one view', () => {
  const compact = initialLayout(DESIGN_KINDS, true);
  const restored = run(compact, { type: 'restore', target: urlTarget(parseLayoutUrl('left=provider:x')) });
  expect(restored.narrowOpen.providers).toBe(true);
  expect(viewSlots(restored)['editor:providers']).toBe('L');
  expect(formatLayoutUrl(layoutToUrl(restored, { providers: 'x' }))).toBe('left=provider:x');
  // An editor open in R is shown first, as before.
  const both = run(compact, {
    type: 'restore',
    target: urlTarget(parseLayoutUrl('left=provider:x&right=character:c')),
  });
  expect(viewSlots(both)['editor:characters']).toBe('L');
});

it('opens the state definitions editor in compact mode, where L shows one view', () => {
  const compact = initialLayout(DESIGN_KINDS, true);
  const restored = run(compact, { type: 'restore', target: urlTarget(parseLayoutUrl('left=stateDefinition:x')) });
  expect(restored.narrowOpen.stateDefinitions).toBe(true);
  expect(viewSlots(restored)['editor:stateDefinitions']).toBe('L');
  expect(formatLayoutUrl(layoutToUrl(restored, { stateDefinitions: 'x' }))).toBe('left=stateDefinition:x');
});

it('tells content changes from tab switches', () => {
  expect(sameContent(parseLayoutUrl('left=presets'), parseLayoutUrl(''))).toBe(true);
  expect(sameContent(parseLayoutUrl('session=a'), parseLayoutUrl('session=b'))).toBe(false);
  expect(sameContent(parseLayoutUrl('wide=preset:a'), parseLayoutUrl('wide=preset:b'))).toBe(false);
  expect(sameContent(parseLayoutUrl('right=character:a'), parseLayoutUrl('right=characters'))).toBe(false);
  expect(sameContent(parseLayoutUrl('left=provider:a'), parseLayoutUrl('left=providers'))).toBe(false);
  expect(sameContent(parseLayoutUrl('left=stateDefinition:a'), parseLayoutUrl('left=stateDefinitions'))).toBe(false);
  expect(sameContent(parseLayoutUrl('left=stateDefinition:a'), parseLayoutUrl('left=stateDefinition:b'))).toBe(false);
  expect(sameContent(parseLayoutUrl('left=stateDefinition:a'), parseLayoutUrl('left=stateDefinition:a'))).toBe(true);
});

it('builds links for other parts of the app', () => {
  expect(layoutHref({ wide: 'workflows', wideId: 'w1', edge: 'e1' })).toBe('/?wide=workflow:w1&edge=e1');
  expect(layoutHref({ left: 'workflows' })).toBe('/');
});

const phone = () => initialLayout(DESIGN_KINDS, false, true);
/** URL -> phone layout -> URL. */
const phoneReload = (search: string, ids: Parameters<typeof layoutToUrl>[1]) =>
  formatLayoutUrl(layoutToUrl(run(phone(), { type: 'restore', target: urlTarget(parseLayoutUrl(search)) }), ids));

it('writes what a phone shows only when it is not what the rest of the URL opens', () => {
  expect(formatLayoutUrl(layoutToUrl(phone(), {}))).toBe('');
  expect(formatLayoutUrl(layoutToUrl(run(phone(), { type: 'selectTab', id: 'presets' }), {}))).toBe(
    'left=presets&view=presets',
  );
  const editing = run(phone(), { type: 'openEditor', id: 'presets' });
  // Compact layouts keep R's list, so `right` is written next to a wide editor.
  expect(formatLayoutUrl(layoutToUrl(editing, { presets: 'p1' }))).toBe('wide=preset:p1&right=chats');
  const chatting = run(editing, { type: 'showMiddle', chat: true });
  expect(formatLayoutUrl(layoutToUrl(chatting, { presets: 'p1' }))).toBe('wide=preset:p1&right=chats&view=chat');
  // Desktop never writes it.
  expect(formatLayoutUrl(layoutToUrl(run(start(), { type: 'selectTab', id: 'presets' }), {}))).toBe('left=presets');
});

it('round-trips what a phone shows', () => {
  for (const [search, ids] of [
    ['left=presets&view=presets', {}],
    ['right=characters&view=characters', {}],
    ['wide=preset:p1&right=chats&view=chat', { presets: 'p1' }],
    ['wide=preset:p1&right=chats', { presets: 'p1' }],
    ['right=character:c1', { characters: 'c1' }],
    ['right=character:c1&view=chat', { characters: 'c1' }],
    ['left=stateDefinition:s1', { stateDefinitions: 's1' }],
    ['left=stateDefinitions&view=stateDefinitions', {}],
  ] as const) {
    expect(phoneReload(search, ids)).toBe(search);
  }
  expect(parseLayoutUrl('view=nonsense').view).toBeUndefined();
});

it('makes a phone view switch a history step', () => {
  const chat = parseLayoutUrl('');
  expect(sameContent(chat, parseLayoutUrl('left=presets&view=presets'))).toBe(false);
  expect(sameContent(parseLayoutUrl('left=presets'), parseLayoutUrl('left=workflows'))).toBe(true);
});

it('holds the URL while a phone shows an editor that is still loading', () => {
  const wide = run(phone(), { type: 'selectTab', id: 'workflows' }, { type: 'openEditor', id: 'workflows' });
  expect(phoneEditorLoading(wide, {})).toBe(true);
  expect(phoneEditorLoading(wide, { workflows: 'w1' })).toBe(false);
  const narrow = run(phone(), { type: 'selectTab', id: 'characters' }, { type: 'openEditor', id: 'characters' });
  expect(phoneEditorLoading(narrow, {})).toBe(true);
  expect(phoneEditorLoading(narrow, { characters: 'c1' })).toBe(false);
  const lore = run(phone(), { type: 'selectTab', id: 'collections' }, { type: 'openEditor', id: 'collections' });
  expect(phoneEditorLoading(lore, {})).toBe(true);
  expect(phoneEditorLoading(lore, { collections: 'k1' })).toBe(false);
  const state = run(
    phone(),
    { type: 'selectTab', id: 'stateDefinitions' },
    { type: 'openEditor', id: 'stateDefinitions' },
  );
  expect(phoneEditorLoading(state, {})).toBe(true);
  expect(phoneEditorLoading(state, { stateDefinitions: 's1' })).toBe(false);
  expect(phoneEditorLoading(run(start(), { type: 'openEditor', id: 'workflows' }), {})).toBe(false);
});

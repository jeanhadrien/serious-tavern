import { expect, it } from 'vitest';
import { activeIcon, columnIcons, VIEW_KEYS, viewSlots, type ViewKey } from './derive.js';
import {
  DESIGN_KINDS,
  initialLayout,
  layoutReducer,
  type IconId,
  type LayoutAction,
  type LayoutState,
  type ResourceId,
} from './state.js';

const run = (state: LayoutState, ...actions: LayoutAction[]) => actions.reduce(layoutReducer, state);
const open = (id: ResourceId): LayoutAction => ({ type: 'openEditor', id });
const select = (id: IconId): LayoutAction => ({ type: 'selectTab', id });
const start = () => initialLayout(DESIGN_KINDS);
const slot = (state: LayoutState, key: ViewKey) => viewSlots(state)[key];

it('starts with the chat in M and the chats list in R', () => {
  const state = start();
  expect(slot(state, 'chat')).toBe('M');
  expect(slot(state, 'list:chats')).toBe('R');
  expect(slot(state, 'list:workflows')).toBe('L');
  expect(columnIcons(state, 'R')).toEqual(['chats', 'characters', 'personas']);
});

it('moves the chat to R when a wide editor opens and back when it closes', () => {
  const opened = run(start(), open('presets'));
  expect(slot(opened, 'editor:presets')).toBe('M');
  expect(slot(opened, 'chat')).toBe('R');
  expect(slot(opened, 'list:chats')).toBeNull();
  expect(columnIcons(opened, 'R')).toEqual(['chat', 'chats', 'characters', 'personas']);
  expect(activeIcon(opened, 'R')).toBe('chat');

  const closed = run(opened, { type: 'closeEditor', id: 'presets' });
  expect(slot(closed, 'chat')).toBe('M');
  expect(slot(closed, 'editor:presets')).toBeNull();
  expect(slot(closed, 'list:chats')).toBe('R');
});

it('shows only one wide editor at a time and ignores closing a hidden one', () => {
  const state = run(start(), open('presets'), open('workflows'));
  expect(slot(state, 'editor:workflows')).toBe('M');
  expect(slot(state, 'editor:presets')).toBeNull();
  expect(run(state, { type: 'closeEditor', id: 'presets' }).wide).toBe('workflows');
});

it('hides the chat behind a content list in R without closing the wide editor', () => {
  const state = run(start(), open('workflows'), select('characters'));
  expect(slot(state, 'list:characters')).toBe('R');
  expect(slot(state, 'chat')).toBeNull();
  expect(state.wide).toBe('workflows');
  const back = run(state, select('chat'));
  expect(slot(back, 'chat')).toBe('R');
  expect(slot(back, 'list:characters')).toBeNull();
});

it('returns R to what it showed before the chat took it', () => {
  const state = run(start(), select('personas'), open('workflows'), { type: 'closeEditor', id: 'workflows' });
  expect(state.tabs.R).toBe('personas');
});

it('opens narrow editors inside their column and replaces the list', () => {
  const state = run(start(), open('characters'));
  expect(slot(state, 'editor:characters')).toBe('R');
  expect(slot(state, 'list:characters')).toBeNull();
  expect(slot(state, 'chat')).toBe('M');
  const back = run(state, { type: 'closeEditor', id: 'characters' });
  expect(slot(back, 'editor:characters')).toBeNull();
  expect(slot(back, 'list:characters')).toBe('R');
});

it('shows settings, which has no list, as soon as its icon is picked', () => {
  const state = run(start(), select('settings'));
  expect(slot(state, 'editor:settings')).toBe('L');
  expect(slot(run(start(), select('presets')), 'editor:settings')).toBeNull();
  expect(slot(run(initialLayout(DESIGN_KINDS, true), select('settings')), 'editor:settings')).toBe('L');
});

it('hides a narrow editor in R when a wide editor opens, keeping its state', () => {
  const state = run(start(), open('characters'), { type: 'setDirty', id: 'characters', dirty: true }, open('presets'));
  expect(slot(state, 'chat')).toBe('R');
  expect(slot(state, 'editor:characters')).toBeNull();
  expect(state.narrowOpen.characters).toBe(true);
  expect(state.dirty.characters).toBe(true);
  // Closing the wide editor brings the narrow editor back.
  const closed = run(state, { type: 'closeEditor', id: 'presets' });
  expect(slot(closed, 'editor:characters')).toBe('R');
  expect(slot(closed, 'chat')).toBe('M');
});

it('keeps unrelated views where they were when switching tabs', () => {
  const state = run(start(), select('presets'), select('characters'));
  expect(slot(state, 'list:presets')).toBe('L');
  expect(slot(state, 'list:characters')).toBe('R');
  expect(slot(state, 'list:chats')).toBeNull();
});

it('ignores selecting the chat icon when the chat is in M', () => {
  const state = start();
  expect(run(state, select('chat'))).toBe(state);
});

it('collapses to L | M in compact mode', () => {
  const compact = initialLayout(DESIGN_KINDS, true);
  expect(columnIcons(compact, 'L')).toHaveLength(6);
  expect(columnIcons(compact, 'R')).toEqual([]);
  expect(slot(compact, 'chat')).toBe('M');
  expect(slot(compact, 'list:chats')).toBe('L');
  const characters = run(compact, select('characters'));
  expect(slot(characters, 'list:characters')).toBe('L');
  expect(slot(run(characters, open('characters')), 'editor:characters')).toBe('L');
});

it('lets the chat toggle in M when a wide editor opens in compact mode', () => {
  const editing = run(initialLayout(DESIGN_KINDS, true), open('workflows'));
  expect(slot(editing, 'editor:workflows')).toBe('M');
  expect(slot(editing, 'chat')).toBeNull();
  const chatting = run(editing, { type: 'toggleCompactChat' });
  expect(slot(chatting, 'chat')).toBe('M');
  expect(slot(chatting, 'editor:workflows')).toBeNull();
  expect(chatting.wide).toBe('workflows');
  const closed = run(chatting, { type: 'closeEditor', id: 'workflows' });
  expect(slot(closed, 'chat')).toBe('M');
  expect(closed.compactChat).toBe(false);
  // The toggle does nothing without a wide editor.
  expect(run(closed, { type: 'toggleCompactChat' })).toBe(closed);
});

it('re-places the chat when crossing the breakpoint with a wide editor open', () => {
  const wide = run(start(), open('presets'));
  const compact = run(wide, { type: 'setCompact', compact: true });
  expect(slot(compact, 'editor:presets')).toBe('M');
  expect(slot(compact, 'chat')).toBeNull();
  const back = run(compact, { type: 'setCompact', compact: false });
  expect(slot(back, 'chat')).toBe('R');
  expect(slot(back, 'editor:presets')).toBe('M');
  const plain = run(start(), { type: 'setCompact', compact: true }, { type: 'setCompact', compact: false });
  expect(slot(plain, 'chat')).toBe('M');
  expect(plain.tabs.R).toBe('chats');
});

it('supports any mix of editor kinds', () => {
  const interim = initialLayout({
    workflows: 'wide',
    presets: 'wide',
    settings: 'wide',
    characters: 'wide',
    personas: 'wide',
  });
  const state = run(interim, select('characters'), open('characters'));
  expect(slot(state, 'editor:characters')).toBe('M');
  expect(slot(state, 'chat')).toBe('R');
});

it('does not mutate the previous state', () => {
  const before = start();
  const snapshot = structuredClone(before);
  run(before, open('presets'), open('characters'), select('personas'), {
    type: 'setDirty',
    id: 'presets',
    dirty: true,
  });
  expect(before).toEqual(snapshot);
});

it('derives a slot for exactly the mounted views, in every mode', () => {
  for (const state of [start(), initialLayout(DESIGN_KINDS, true), run(start(), open('presets'))]) {
    expect(Object.keys(viewSlots(state)).sort()).toEqual([...VIEW_KEYS].sort());
  }
  expect(new Set(VIEW_KEYS).size).toBe(VIEW_KEYS.length);
});

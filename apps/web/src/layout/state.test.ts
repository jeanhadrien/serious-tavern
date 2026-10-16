import { expect, it } from 'vitest';
import { activeIcon, columnIcons, mobileView, VIEW_KEYS, viewSlots, type ViewKey } from './derive.js';
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
  expect(columnIcons(state, 'R')).toEqual(['chats', 'characters', 'personas', 'collections']);
});

it('moves the chat to R when a wide editor opens and back when it closes', () => {
  const opened = run(start(), open('presets'));
  expect(slot(opened, 'editor:presets')).toBe('M');
  expect(slot(opened, 'chat')).toBe('R');
  expect(slot(opened, 'list:chats')).toBeNull();
  expect(columnIcons(opened, 'R')).toEqual(['chat', 'chats', 'characters', 'personas', 'collections']);
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

it('opens the providers editor in L in place of its list', () => {
  const state = run(start(), select('providers'), open('providers'));
  expect(slot(state, 'editor:providers')).toBe('L');
  expect(slot(state, 'list:providers')).toBeNull();
  expect(slot(state, 'list:chats')).toBe('R');
  expect(columnIcons(state, 'L')).toEqual(['workflows', 'presets', 'providers', 'stateDefinitions', 'settings']);
  // Another L tab hides the editor (keeping it open); coming back shows it again.
  const away = run(state, select('presets'));
  expect(slot(away, 'editor:providers')).toBeNull();
  expect(slot(run(away, select('providers')), 'editor:providers')).toBe('L');
  const back = run(state, { type: 'closeEditor', id: 'providers' });
  expect(slot(back, 'list:providers')).toBe('L');
});

it('opens the state definitions editor in L in place of its list', () => {
  expect(DESIGN_KINDS.stateDefinitions).toBe('narrow');
  const state = run(start(), select('stateDefinitions'), open('stateDefinitions'));
  expect(slot(state, 'editor:stateDefinitions')).toBe('L');
  expect(slot(state, 'list:stateDefinitions')).toBeNull();
  expect(slot(state, 'list:chats')).toBe('R');
  expect(slot(state, 'chat')).toBe('M');
  // The icon sits between Providers and Settings.
  expect(columnIcons(state, 'L')).toEqual(['workflows', 'presets', 'providers', 'stateDefinitions', 'settings']);
  // Another L tab hides the editor (keeping it open); coming back shows it again.
  const away = run(state, select('providers'));
  expect(slot(away, 'editor:stateDefinitions')).toBeNull();
  expect(slot(away, 'editor:providers')).toBeNull();
  expect(slot(run(away, select('stateDefinitions')), 'editor:stateDefinitions')).toBe('L');
  const back = run(state, { type: 'closeEditor', id: 'stateDefinitions' });
  expect(slot(back, 'list:stateDefinitions')).toBe('L');
  expect(slot(back, 'editor:stateDefinitions')).toBeNull();
});

it('shows the state definitions editor in compact mode in L and on a phone as its own view', () => {
  const compact = run(initialLayout(DESIGN_KINDS, true), select('stateDefinitions'), open('stateDefinitions'));
  expect(slot(compact, 'editor:stateDefinitions')).toBe('L');
  expect(columnIcons(compact, 'L')).toHaveLength(9);
  const onPhone = run(phone(), select('stateDefinitions'), open('stateDefinitions'));
  expect(mobileView(onPhone)).toBe('stateDefinitions');
  expect(shownViews(onPhone)).toEqual(['editor:stateDefinitions']);
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

it('opens collections as a narrow editor in R, in place of their list', () => {
  const listed = run(start(), select('collections'));
  expect(slot(listed, 'list:collections')).toBe('R');
  const opened = run(listed, open('collections'));
  expect(slot(opened, 'editor:collections')).toBe('R');
  expect(slot(opened, 'list:collections')).toBeNull();
  const back = run(opened, { type: 'closeEditor', id: 'collections' });
  expect(back.narrowOpen.collections).toBe(false);
  expect(slot(back, 'list:collections')).toBe('R');
  // A wide editor sends the chat to R, hiding the collection editor; closing it brings the editor back.
  const wide = run(opened, open('presets'));
  expect(slot(wide, 'editor:collections')).toBeNull();
  expect(slot(wide, 'chat')).toBe('R');
  expect(slot(run(wide, { type: 'closeEditor', id: 'presets' }), 'editor:collections')).toBe('R');
  // Compact mode shows it in L; a phone shows L's pane.
  const compact = run(initialLayout(DESIGN_KINDS, true), select('collections'), open('collections'));
  expect(slot(compact, 'editor:collections')).toBe('L');
  const phoneOpened = run(initialLayout(DESIGN_KINDS, true, true), select('collections'), open('collections'));
  expect(phoneOpened.pane).toBe('L');
  expect(mobileView(phoneOpened)).toBe('collections');
  expect(slot(phoneOpened, 'editor:collections')).toBe('L');
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
  expect(columnIcons(compact, 'L')).toHaveLength(9);
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

const phone = () => initialLayout(DESIGN_KINDS, false, true);
const shownViews = (state: LayoutState) => VIEW_KEYS.filter((key) => slot(state, key) !== null);

it('shows one view at a time in phone mode, starting with the chat', () => {
  const state = phone();
  expect(state.compact).toBe(true);
  expect(shownViews(state)).toEqual(['chat']);
  expect(mobileView(state)).toBe('chat');
  const list = run(state, select('presets'));
  expect(shownViews(list)).toEqual(['list:presets']);
  expect(slot(list, 'list:presets')).toBe('L');
  expect(mobileView(list)).toBe('presets');
  expect(shownViews(run(list, { type: 'showMiddle', chat: true }))).toEqual(['chat']);
});

it('follows what a phone opens: narrow editors in L, wide editors in M', () => {
  const character = run(phone(), select('characters'), open('characters'));
  expect(shownViews(character)).toEqual(['editor:characters']);
  const preset = run(character, select('presets'), open('presets'));
  expect(shownViews(preset)).toEqual(['editor:presets']);
  expect(mobileView(preset)).toBe('editor');
  const chatting = run(preset, { type: 'showMiddle', chat: true });
  expect(shownViews(chatting)).toEqual(['chat']);
  expect(chatting.wide).toBe('presets');
  expect(shownViews(run(chatting, { type: 'showMiddle', chat: false }))).toEqual(['editor:presets']);
  // The header toggle still swaps the editor and the chat.
  expect(shownViews(run(chatting, { type: 'toggleCompactChat' }))).toEqual(['editor:presets']);
});

it('ignores showMiddle outside phone mode', () => {
  const compact = run(initialLayout(DESIGN_KINDS, true), open('presets'));
  expect(run(compact, { type: 'showMiddle', chat: true })).toBe(compact);
});

it('enters compact mode with phone mode and keeps it when leaving', () => {
  const wide = run(start(), open('presets'));
  const onPhone = run(wide, { type: 'setMobile', mobile: true });
  expect(onPhone.compact).toBe(true);
  expect(shownViews(onPhone)).toEqual(['editor:presets']);
  const tablet = run(onPhone, { type: 'setMobile', mobile: false });
  expect(slot(tablet, 'editor:presets')).toBe('M');
  expect(slot(tablet, 'list:chats')).toBe('L');
  const desktop = run(tablet, { type: 'setCompact', compact: false });
  expect(slot(desktop, 'chat')).toBe('R');
});

it('shows on a phone what a restored URL opens', () => {
  const target = { left: 'workflows', right: 'chats', leftEditorOpen: false, rightEditorOpen: false } as const;
  const wide = run(phone(), select('presets'), { type: 'restore', target: { ...target, wide: 'workflows' } });
  expect(shownViews(wide)).toEqual(['editor:workflows']);
  const narrow = run(phone(), {
    type: 'restore',
    target: { ...target, right: 'characters', rightEditorOpen: true },
  });
  expect(shownViews(narrow)).toEqual(['editor:characters']);
  // A plain tab change keeps what the phone shows.
  expect(shownViews(run(phone(), { type: 'restore', target: { ...target, left: 'presets' } }))).toEqual(['chat']);
});

it('supports any mix of editor kinds', () => {
  const interim = initialLayout({
    workflows: 'wide',
    presets: 'wide',
    providers: 'wide',
    stateDefinitions: 'wide',
    settings: 'wide',
    characters: 'wide',
    personas: 'wide',
    collections: 'wide',
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
  for (const state of [start(), initialLayout(DESIGN_KINDS, true), run(start(), open('presets')), phone()]) {
    expect(Object.keys(viewSlots(state)).sort()).toEqual([...VIEW_KEYS].sort());
  }
  expect(new Set(VIEW_KEYS).size).toBe(VIEW_KEYS.length);
});

// What the shell renders, derived from the layout state: where each view sits and
// which icons each column header offers.
import {
  chatInRight,
  LIST_COLUMN,
  LISTLESS,
  RESOURCE_IDS,
  type Column,
  type IconId,
  type LayoutState,
  type ListId,
  type MobileView,
  type ResourceId,
} from './state.js';

type ListedId = Exclude<ListId, 'settings'>;
export type ViewKey = 'chat' | `list:${ListedId}` | `editor:${ResourceId}`;

const LISTS = [...RESOURCE_IDS.filter((id) => !LISTLESS.includes(id)), 'chats'] as ListedId[];

/** Every view the shell mounts, in a fixed order so React never reorders or remounts them. */
export const VIEW_KEYS: readonly ViewKey[] = [
  'chat',
  ...LISTS.map((id): ViewKey => `list:${id}`),
  ...RESOURCE_IDS.map((id): ViewKey => `editor:${id}`),
];

/** In compact mode a wide editor owns M until the header toggle brings the chat back. */
function wideEditorShown(state: LayoutState): boolean {
  return state.wide !== undefined && !(state.compact && state.compactChat);
}

function listSlot(state: LayoutState, id: ListId): Column | null {
  if (state.compact) return state.compactTab === id ? 'L' : null;
  const column = LIST_COLUMN[id];
  return state.tabs[column] === id ? column : null;
}

function narrowEditorOpen(state: LayoutState, id: ListedId): boolean {
  return id !== 'chats' && state.kinds[id] === 'narrow' && state.narrowOpen[id];
}

function chatSlot(state: LayoutState): Column | null {
  if (state.compact) return wideEditorShown(state) ? null : 'M';
  if (state.wide === undefined) return 'M';
  return state.tabs.R === 'chat' ? 'R' : null;
}

/**
 * The column each view is displayed in, or null when it is hidden. Hidden views stay
 * mounted (the shell only changes where they sit), so they keep their state.
 */
export function viewSlots(state: LayoutState): Record<ViewKey, Column | null> {
  const slots = { chat: chatSlot(state) } as Record<ViewKey, Column | null>;
  for (const id of LISTS) slots[`list:${id}`] = narrowEditorOpen(state, id) ? null : listSlot(state, id);
  for (const id of RESOURCE_IDS) {
    if (state.kinds[id] === 'wide') slots[`editor:${id}`] = state.wide === id && wideEditorShown(state) ? 'M' : null;
    else slots[`editor:${id}`] = state.narrowOpen[id] || LISTLESS.includes(id) ? listSlot(state, id) : null;
  }
  // Phone mode is the compact layout with only one of its two columns on screen.
  if (state.mobile) for (const key of VIEW_KEYS) if (slots[key] !== state.pane) slots[key] = null;
  return slots;
}

/** What phone mode shows. */
export function mobileView(state: LayoutState): MobileView {
  if (state.pane === 'L') return state.compactTab;
  return wideEditorShown(state) ? 'editor' : 'chat';
}

const LEFT_ICONS: readonly IconId[] = ['workflows', 'presets', 'providers', 'stateDefinitions', 'settings'];
const RIGHT_ICONS: readonly IconId[] = ['chats', 'characters', 'personas', 'collections'];

/** The icons a column header shows. M has none. */
export function columnIcons(state: LayoutState, column: 'L' | 'R'): readonly IconId[] {
  if (state.compact) return column === 'L' ? [...LEFT_ICONS, ...RIGHT_ICONS] : [];
  if (column === 'L') return LEFT_ICONS;
  return chatInRight(state) ? ['chat', ...RIGHT_ICONS] : RIGHT_ICONS;
}

/** The icon of the view a column currently shows. */
export function activeIcon(state: LayoutState, column: 'L' | 'R'): IconId {
  return state.compact ? state.compactTab : state.tabs[column];
}

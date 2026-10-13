// Pure layout model for the three-column shell (see docs/FRONTEND-LAYOUT.md).
// Nothing here knows about React, the DOM or the URL: the shell renders whatever
// `viewSlots`/`columnIcons` derive from this state, and step 4 can serialize it.

export type ResourceId = 'workflows' | 'presets' | 'settings' | 'characters' | 'personas';
/** Something a column can list: a resource's list, or the chat history. */
export type ListId = ResourceId | 'chats';
/** Header icons also include the chat itself, which only appears while it sits in R. */
export type IconId = ListId | 'chat';
export type Column = 'L' | 'M' | 'R';
export type EditorKind = 'wide' | 'narrow';

/** Which side column owns each list in the three-column layout. */
export const LIST_COLUMN: Record<ListId, 'L' | 'R'> = {
  workflows: 'L',
  presets: 'L',
  settings: 'L',
  chats: 'R',
  characters: 'R',
  personas: 'R',
};

/** Narrow editors with no list in front of them: their icon shows the editor itself. */
export const LISTLESS: readonly ResourceId[] = ['settings'];

export const RESOURCE_IDS: readonly ResourceId[] = ['workflows', 'presets', 'settings', 'characters', 'personas'];

export interface LayoutState {
  /** Wide editors take M; narrow editors open inside their own column. */
  kinds: Record<ResourceId, EditorKind>;
  /** Two-column mode (below the width breakpoint): L | M only. */
  compact: boolean;
  /** What each side column shows. R is 'chat' while a wide editor owns M. */
  tabs: { L: ListId; R: ListId | 'chat' };
  /** What R goes back to when the chat leaves it. */
  rightReturn: ListId;
  /** The list L shows in compact mode, where it holds every list. */
  compactTab: ListId;
  /** The wide editor currently in M. */
  wide?: ResourceId;
  /** Narrow editors with an item open; they keep their state while hidden. */
  narrowOpen: Record<ResourceId, boolean>;
  /** Compact mode with a wide editor open: whether M shows the chat instead. */
  compactChat: boolean;
  /** Unsaved changes per editor, shown as a dot on its header icon. */
  dirty: Record<ResourceId, boolean>;
}

export type LayoutAction =
  | { type: 'selectTab'; id: IconId }
  | { type: 'openEditor'; id: ResourceId }
  | { type: 'closeEditor'; id: ResourceId }
  | { type: 'setCompact'; compact: boolean }
  | { type: 'toggleCompactChat' }
  | { type: 'setDirty'; id: ResourceId; dirty: boolean };

const noResources = (): Record<ResourceId, boolean> => ({
  workflows: false,
  presets: false,
  settings: false,
  characters: false,
  personas: false,
});

/** The editor kinds the design calls for. */
export const DESIGN_KINDS: Record<ResourceId, EditorKind> = {
  workflows: 'wide',
  presets: 'wide',
  settings: 'narrow',
  characters: 'narrow',
  personas: 'narrow',
};

export function initialLayout(kinds: Record<ResourceId, EditorKind>, compact = false): LayoutState {
  return {
    kinds,
    compact,
    tabs: { L: 'workflows', R: 'chats' },
    rightReturn: 'chats',
    compactTab: 'chats',
    narrowOpen: noResources(),
    compactChat: false,
    dirty: noResources(),
  };
}

/** True when the chat is displayed in the R column. */
export function chatInRight(state: LayoutState): boolean {
  return !state.compact && state.wide !== undefined;
}

// A wide editor takes M and the chat takes R, hiding whatever R showed (its state is kept).
function sendChatToRight(state: LayoutState): LayoutState {
  if (state.tabs.R === 'chat') return state;
  return { ...state, rightReturn: state.tabs.R, tabs: { ...state.tabs, R: 'chat' } };
}

function returnChatToMiddle(state: LayoutState): LayoutState {
  if (state.tabs.R !== 'chat') return state;
  return { ...state, tabs: { ...state.tabs, R: state.rightReturn } };
}

export function layoutReducer(state: LayoutState, action: LayoutAction): LayoutState {
  switch (action.type) {
    case 'selectTab': {
      if (action.id === 'chat') return chatInRight(state) ? { ...state, tabs: { ...state.tabs, R: 'chat' } } : state;
      const tabs = { ...state.tabs, [LIST_COLUMN[action.id]]: action.id };
      return { ...state, tabs, compactTab: action.id };
    }
    case 'openEditor': {
      if (state.kinds[action.id] === 'wide') {
        const opened = { ...state, wide: action.id, compactChat: false };
        return state.compact ? opened : sendChatToRight(opened);
      }
      const column = LIST_COLUMN[action.id];
      return {
        ...state,
        narrowOpen: { ...state.narrowOpen, [action.id]: true },
        tabs: { ...state.tabs, [column]: action.id },
        compactTab: action.id,
      };
    }
    case 'closeEditor': {
      if (state.kinds[action.id] === 'wide') {
        if (state.wide !== action.id) return state;
        return returnChatToMiddle({ ...state, wide: undefined, compactChat: false });
      }
      return { ...state, narrowOpen: { ...state.narrowOpen, [action.id]: false } };
    }
    case 'setCompact': {
      if (state.compact === action.compact) return state;
      const next = { ...state, compact: action.compact, compactChat: false };
      return action.compact || state.wide === undefined ? returnChatToMiddle(next) : sendChatToRight(next);
    }
    case 'toggleCompactChat':
      return state.compact && state.wide !== undefined ? { ...state, compactChat: !state.compactChat } : state;
    case 'setDirty':
      return { ...state, dirty: { ...state.dirty, [action.id]: action.dirty } };
  }
}

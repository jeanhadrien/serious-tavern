import { createContext, useContext } from 'react';
import type { IconId, ResourceId } from './state.js';

export interface LayoutActions {
  /** Shows a resource's editor (a wide editor takes M and sends the chat to R). */
  openEditor(id: ResourceId): void;
  /** Closes a resource's editor: a wide one gives M back to the chat, a narrow one returns to its list. */
  closeEditor(id: ResourceId): void;
  /** Shows a list in its side column (what clicking its header icon does), without touching the URL's other parts. */
  selectTab(id: IconId): void;
}

// The provider's value is created once, so reading it never re-renders a view.
const LayoutActionsContext = createContext<LayoutActions>({
  openEditor: () => {},
  closeEditor: () => {},
  selectTab: () => {},
});

export const LayoutActionsProvider = LayoutActionsContext.Provider;

/** Lets a view change the layout without receiving props (so the shell can keep its element constant). */
export const useLayoutActions = () => useContext(LayoutActionsContext);

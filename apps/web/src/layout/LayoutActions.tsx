import { createContext, useContext } from 'react';
import type { ResourceId } from './state.js';

export interface LayoutActions {
  /** Shows a resource's editor (a wide editor takes M and sends the chat to R). */
  openEditor(id: ResourceId): void;
}

// The provider's value is created once, so reading it never re-renders a view.
const LayoutActionsContext = createContext<LayoutActions>({ openEditor: () => {} });

export const LayoutActionsProvider = LayoutActionsContext.Provider;

/** Lets a view change the layout without receiving props (so the shell can keep its element constant). */
export const useLayoutActions = () => useContext(LayoutActionsContext);

import type { SessionStateView } from '@st/shared';
import type { StoryLoad } from './storyStateLoader.js';

// The state `useStoryState` keeps, as pure functions: which chat a loaded view belongs to, and when to load again.

/** A loaded (or failed) story state and the chat it was loaded for. */
export interface Slot {
  sessionId: string;
  view?: SessionStateView;
  failed: boolean;
}

/** The slot after a load of `sessionId`. A failure keeps the previous view, but only the one of the same chat. */
export function nextSlot(previous: Slot | undefined, sessionId: string, result: StoryLoad): Slot {
  if ('view' in result) return { sessionId, view: result.view, failed: false };
  const before = previous?.sessionId === sessionId ? previous : undefined;
  return { sessionId, view: before?.view, failed: true };
}

/** The slot to show for the open chat: one that was loaded for another chat is never shown. */
export const currentSlot = (slot: Slot | undefined, sessionId: string | undefined): Slot | undefined =>
  slot?.sessionId === sessionId ? slot : undefined;

/** The chat just stopped being busy (a turn or a message change finished): load once more, in case an event was missed. */
export const becameIdle = (wasIdle: boolean, idle: boolean): boolean => idle && !wasIdle;

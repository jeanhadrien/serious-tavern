import type { BlockedRename, SaveOutcome } from './stateDefinitionActions.js';

/** What the editor knows about the open definition's name from the server's answers to a save. */
export interface NameState {
  /** The server refused a rename because chats hold story state under the name: it stays read-only while open. */
  locked: boolean;
  /** The refused rename, for the banner that offers the ways forward. */
  blocked?: BlockedRename;
  /** The server's answer when another definition has the name. */
  taken?: string;
}

/** A definition was just opened (or closed): nothing is known yet. */
export const freshNameState: NameState = { locked: false };

/** After a save: the two 409s are kept (a refused rename locks the name), a saved or failed save changes nothing. */
export function afterSave(state: NameState, outcome: SaveOutcome, attemptedName: string): NameState {
  switch (outcome.kind) {
    case 'name-taken':
      return { ...state, taken: outcome.message };
    case 'in-use':
      return {
        ...state,
        locked: true,
        blocked: { name: attemptedName, message: outcome.message, sessions: outcome.sessions },
      };
    default:
      return state;
  }
}

/** After any edit: a refusal about the name is out of date. */
export const afterEdit = (state: NameState): NameState =>
  state.taken === undefined ? state : { ...state, taken: undefined };

/** "Keep the current name": the banner goes, the name stays locked. */
export const afterKeepName = (state: NameState): NameState =>
  state.blocked === undefined ? state : { ...state, blocked: undefined };

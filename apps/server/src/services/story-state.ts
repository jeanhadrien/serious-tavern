import {
  duplicateNameIssues,
  foldStoryState,
  oldestFirst,
  stateSnapshot,
  type ChatMessage,
  type FoldInput,
  type Session,
  type StateDefinition,
  type StateSnapshot,
  type StoryState,
  type StateWrite,
} from '@st/shared';
import type { StateDefinitionRepository } from '../storage/state-definition-repository.js';

export type SessionStory = {
  /** Oldest first, as the fold and the templates want them. */
  definitions: StateDefinition[];
  story: StoryState;
  /** What a run starts from: the folded values and meta, the definitions and the turn being run. */
  snapshot: StateSnapshot;
  /** Plain-language notes for the execution log: stored values that no longer fit, repeated names. */
  issues: string[];
};

/** Every state definition, oldest first. */
export async function listDefinitions(repository: Pick<StateDefinitionRepository, 'list'>): Promise<StateDefinition[]> {
  return oldestFirst(await repository.list());
}

/**
 * Folds a session's stored turns against `definitions`: what its state is right now, and the snapshot its
 * next turn runs on. Never throws and writes nothing; a stored value that doesn't fit its definition reads as
 * the default and shows up in `issues`. `history` is the history messages the run's nodes see: with it, items
 * that link to messages carry their computed `link` in the snapshot (the SAME history the nodes judge links by).
 * `scope` is for the run of one workflow: its `workflowId` scopes the nodes' own state (`FoldInput.workflowId`; a caller
 * that runs a workflow always gives it) and `including` is the turn being run (`FoldInput.including`), for the later
 * runs of a turn whose first run has settled; `pending` is the run's own unstored writes (`FoldInput.pending`).
 */
export function foldSession(
  definitions: StateDefinition[],
  session: Pick<Session, 'messages' | 'state'>,
  history?: readonly ChatMessage[],
  scope: Pick<FoldInput, 'workflowId' | 'including' | 'pending'> = {},
): SessionStory {
  const story = foldStoryState({
    definitions,
    messages: session.messages,
    state: session.state,
    ...scope,
  });
  return {
    definitions,
    story,
    snapshot: stateSnapshot(story, definitions, history),
    issues: [
      ...story.definitions.flatMap(({ warnings }) =>
        warnings.map(({ definition, key, message }) => `State "${definition}.${key}": ${message}.`),
      ),
      ...duplicateNameIssues(definitions),
    ],
  };
}

/**
 * `executeWorkflow`'s `foldWith` for a run whose snapshot came from `foldSession(definitions, session, history, scope)`:
 * the same fold over the same arguments plus the run's `pending` writes, giving the snapshot a node reads its own
 * writes from. The session's messages are copied now, so a write to the chat while the run goes on cannot make the
 * answer disagree with the run's own snapshot. The engine never sees the session, only this closure.
 */
export function foldWithOf(
  definitions: StateDefinition[],
  session: Pick<Session, 'messages' | 'state'>,
  history: readonly ChatMessage[] | undefined,
  scope: Pick<FoldInput, 'workflowId' | 'including'>,
): (pending: StateWrite[]) => StateSnapshot {
  const fixed = { messages: [...session.messages], state: session.state };
  return (pending) => foldSession(definitions, fixed, history, { ...scope, pending }).snapshot;
}

export async function loadStoryState(
  repository: Pick<StateDefinitionRepository, 'list'>,
  session: Pick<Session, 'messages' | 'state'>,
): Promise<SessionStory> {
  return foldSession(await listDefinitions(repository), session);
}

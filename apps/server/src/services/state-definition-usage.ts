import { sessionUsesDefinition, type StateDefinitionInUseDetails } from '@st/shared';
import type { AppContext } from '../context.js';

// The node types whose `definitionId` config reads or writes a definition.
const stateNodeTypes = new Set(['state-read', 'state-write']);

/**
 * Chats (sorted by title) that hold story state under the definition: those with a PRESENT turn that wrote it. Writes of turns
 * whose replies are gone can never come back, so they must not keep a definition from being renamed or deleted.
 * Only reads (`sessions.list()` takes no lock), so it is safe to call from inside the definitions lock.
 */
export async function sessionsUsing(
  { sessions }: AppContext,
  id: string,
): Promise<StateDefinitionInUseDetails['sessions']> {
  return (await sessions.list())
    .filter((session) => sessionUsesDefinition(session, id))
    .map(({ id: sessionId, title }) => ({ id: sessionId, title }))
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

/** Workflows with a State Read or State Write node that uses the definition (names, sorted). */
export async function workflowsUsing({ workflows }: AppContext, id: string): Promise<string[]> {
  return (await workflows.list())
    .filter((workflow) =>
      workflow.nodes.some((node) => stateNodeTypes.has(node.type) && node.config?.definitionId === id),
    )
    .map((workflow) => workflow.name)
    .sort((a, b) => a.localeCompare(b));
}

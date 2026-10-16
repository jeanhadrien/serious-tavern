import { registry } from '@st/engine';
import { nodeDisplayName, type ApiResponse, type FoldedKey, type StateWrite } from '@st/shared';
import type { AppContext } from '../context.js';
import { requireEntity } from '../errors.js';
import { loadStoryState } from './story-state.js';

type View = ApiResponse<'getSessionState'>;

/** The folded keys as the three parallel records of the API. */
function keyViews(keys: Record<string, FoldedKey>) {
  const entries = Object.entries(keys);
  return {
    values: Object.fromEntries(entries.map(([key, folded]) => [key, folded.value])),
    meta: Object.fromEntries(entries.map(([key, folded]) => [key, folded.meta])),
    history: Object.fromEntries(entries.map(([key, folded]) => [key, folded.history])),
  };
}

/**
 * A chat's computed story state, for the web: the values every key reads as right now, which stored turns still
 * count, and what each turn wrote. Read-only: it is the same fold the next turn starts from.
 */
export async function sessionStateView(context: AppContext, sessionId: string): Promise<View> {
  const session = await requireEntity(context.sessions, sessionId, 'Session');
  const { definitions, story } = await loadStoryState(context.stateDefinitions, session);
  const workflow = await context.workflows.get(session.workflowId);
  // Names only for nodes the chat's workflow still has; a deleted node's writes keep their data, not a name.
  const nodeLabel = (nodeId: string) =>
    workflow?.nodes.some((node) => node.id === nodeId)
      ? nodeDisplayName(workflow.nodes, (type) => registry.get(type)?.label ?? type, nodeId)
      : undefined;
  const names = new Map(definitions.map((definition) => [definition.id, definition.name]));
  const view = (write: StateWrite) => {
    const definitionName = write.target.kind === 'definition' ? names.get(write.target.definitionId) : undefined;
    const label = nodeLabel(write.nodeId);
    return {
      write,
      ...(definitionName !== undefined && { definitionName }),
      ...(label !== undefined && { nodeLabel: label }),
    };
  };
  return {
    turn: story.turn,
    definitions: story.definitions.map((folded) => ({
      definitionId: folded.definitionId,
      name: folded.name,
      ...keyViews(folded.keys),
      warnings: folded.warnings,
    })),
    nodes: story.nodes.map((folded) => {
      const label = nodeLabel(folded.nodeId);
      return { nodeId: folded.nodeId, ...(label !== undefined && { label }), ...keyViews(folded.keys) };
    }),
    turns: story.turns.map(({ entry, turn }) => ({
      executionId: entry.executionId,
      at: entry.at,
      completed: entry.completed,
      replies: entry.replies,
      turnNumber: turn,
      writes: entry.writes.map(view),
    })),
  };
}

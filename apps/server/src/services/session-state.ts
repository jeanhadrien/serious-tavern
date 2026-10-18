import { registry } from '@st/engine';
import {
  effectivePostRun,
  NODE_ITEMS_LIMIT,
  nodeDisplayName,
  previewWrite,
  readTurnEntries,
  type ApiResponse,
  type FoldedKey,
  type StateWrite,
} from '@st/shared';
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
 * A node's keys: a collection grows with every write and has no cap, so only its newest `NODE_ITEMS_LIMIT` items
 * are sent, with the number left out (the fold itself keeps them all: Draw's window needs what it needs).
 */
function nodeKeyViews(keys: Record<string, FoldedKey>) {
  const views = keyViews(keys);
  const omitted: Record<string, number> = {};
  for (const [key, folded] of Object.entries(keys)) {
    if (folded.meta.count === undefined || !Array.isArray(folded.value) || folded.value.length <= NODE_ITEMS_LIMIT)
      continue;
    views.values[key] = folded.value.slice(0, NODE_ITEMS_LIMIT);
    omitted[key] = folded.value.length - NODE_ITEMS_LIMIT;
  }
  return { ...views, omitted };
}

/**
 * The session, and which of its post-turn runs the server holds, judged right when the session was read. A run
 * commits its result to the entry before the server lets go of it, so a `running` entry the server does not hold
 * can only be a lost run, or a run that finished after this read: then read again. Deciding liveness later than the
 * read (while the view is still being built) would let a run that finishes meanwhile show up as interrupted.
 */
async function readSessionWithLiveRuns(context: AppContext, sessionId: string) {
  for (let attempt = 1; ; attempt++) {
    const session = await requireEntity(context.sessions, sessionId, 'Session');
    const entries = readTurnEntries(session.state);
    const live = new Set(
      entries
        .filter(
          (entry) => entry.postExecutionId !== undefined && context.turns.hasPostRun(sessionId, entry.postExecutionId),
        )
        .map((entry) => entry.executionId),
    );
    const lost = entries.some((entry) => entry.postStatus === 'running' && !live.has(entry.executionId));
    // Each read is an event-loop turn apart: a run that was only finishing has settled by the next one.
    if (!lost || attempt === 3) return { session, live };
  }
}

/**
 * A chat's computed story state, for the web: the values every key reads as right now, which stored turns still
 * count, and what each turn wrote. Read-only: it is the same fold the next turn starts from.
 */
export async function sessionStateView(context: AppContext, sessionId: string): Promise<View> {
  const { session, live } = await readSessionWithLiveRuns(context, sessionId);
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
    const preview = previewWrite(write);
    return {
      write: preview.write,
      ...(preview.truncated && { truncated: true }),
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
      return { nodeId: folded.nodeId, ...(label !== undefined && { label }), ...nodeKeyViews(folded.keys) };
    }),
    turns: story.turns.map(({ entry, turn }) => {
      // A run stored as `running` that this server does not hold is one a restart cut short: it reads as an error.
      const post = effectivePostRun(entry, live.has(entry.executionId));
      return {
        executionId: entry.executionId,
        at: entry.at,
        completed: entry.completed,
        replies: entry.replies,
        turnNumber: turn,
        writes: entry.writes.map(view),
        ...(post && { postStatus: post.status }),
        ...(post?.executionId !== undefined && { postExecutionId: post.executionId }),
        ...(post?.error !== undefined && { postError: post.error }),
        ...(entry.linkWarnings?.length && { linkWarnings: entry.linkWarnings }),
      };
    }),
  };
}

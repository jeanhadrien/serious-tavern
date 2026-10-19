import { registry } from '@st/engine';
import {
  effectiveRuns,
  NODE_ITEMS_LIMIT,
  nodeDisplayName,
  postOfEntry,
  previewWrite,
  readTurnEntries,
  replyWorkflows,
  type ApiResponse,
  type ChatMessage,
  type FoldedKey,
  type StateWrite,
  type TurnEntry,
  type Workflow,
} from '@st/shared';
import type { AppContext } from '../context.js';
import { requireEntity } from '../errors.js';
import { withLinkViews } from './link-view.js';
import { historyMessages } from './settle-turn.js';
import { loadStoryState } from './story-state.js';

type View = ApiResponse<'getSessionState'>;

/**
 * The folded keys as the three parallel records of the API. With `history`, the items of a collection key that link to
 * messages carry their `link` (see `itemLinkViewSchema`).
 */
function keyViews(keys: Record<string, FoldedKey>, history?: readonly ChatMessage[]) {
  const entries = Object.entries(keys);
  const viewOf = ({ value, meta }: FoldedKey) =>
    history && meta.count !== undefined && Array.isArray(value) ? withLinkViews(value, history) : value;
  return {
    values: Object.fromEntries(entries.map(([key, folded]) => [key, viewOf(folded)])),
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

// The execution ids of the runs of an entry's after section.
const postRunIds = (entry: TurnEntry): string[] =>
  entry.runs?.filter((run) => run.part === 'post').map((run) => run.executionId) ?? [];

// Whether the entry lists a run stored as `running` that the server does not hold.
const hasRunning = (entry: TurnEntry, isLive: (executionId: string) => boolean) =>
  entry.runs?.some((run) => run.status === 'running' && !isLive(run.executionId)) ?? false;

/**
 * The session, and which of its runs after the reply the server holds, judged right when the session was read. A run
 * commits its result to the entry before the server lets go of it, so a `running` run the server does not hold can
 * only be a lost run, or a run that finished after this read: then read again. Deciding liveness later than the
 * read (while the view is still being built) would let a run that finishes meanwhile show up as interrupted.
 */
async function readSessionWithLiveRuns(context: AppContext, sessionId: string) {
  for (let attempt = 1; ; attempt++) {
    const session = await requireEntity(context.sessions, sessionId, 'Session');
    const entries = readTurnEntries(session.state);
    const live = new Set(
      entries.flatMap(postRunIds).filter((executionId) => context.turns.hasPostRun(sessionId, executionId)),
    );
    const isLive = (executionId: string) => live.has(executionId);
    const lost = entries.some((entry) => hasRunning(entry, isLive));
    // Each read is an event-loop turn apart: a run that was only finishing has settled by the next one.
    if (!lost || attempt === 3) return { session, entries, isLive };
  }
}

/**
 * A chat's computed story state, for the web: the values every key reads as right now, which stored turns still
 * count, and what each turn wrote. Read-only: it is the same fold the next turn starts from.
 */
export async function sessionStateView(context: AppContext, sessionId: string): Promise<View> {
  const { session, isLive } = await readSessionWithLiveRuns(context, sessionId);
  const { definitions, story } = await loadStoryState(context.stateDefinitions, session);
  // The workflows the view names: the chat's own, and any a turn's runs or a node's own state came from.
  const listed = replyWorkflows(session).map((entry) => entry.workflowId);
  const ids = new Set([
    ...listed,
    ...story.turns.flatMap(({ entry }) => [
      ...(entry.runs?.map((run) => run.workflowId) ?? []),
      ...entry.writes.flatMap(({ target }) => (target.kind === 'node' && target.workflowId ? [target.workflowId] : [])),
    ]),
  ]);
  const found = await Promise.all([...ids].map((id) => context.workflows.get(id)));
  const workflows = new Map(
    found.flatMap((workflow): [string, Workflow][] => (workflow ? [[workflow.id, workflow]] : [])),
  );
  // Names only for nodes the node's workflow still has; a deleted node's writes keep their data, not a name. `workflowId`
  // is the workflow it is known to belong to; without one (a write from before chats ran several workflows, or a State
  // Write's) the first of `candidates` that has a node with that id names it.
  const nodeLabel = (nodeId: string, workflowId: string | undefined, candidates: readonly string[]) => {
    const workflow = (workflowId === undefined ? candidates : [workflowId])
      .map((id) => workflows.get(id))
      .find((item) => item?.nodes.some((node) => node.id === nodeId));
    return workflow ? nodeDisplayName(workflow.nodes, (type) => registry.get(type)?.label ?? type, nodeId) : undefined;
  };
  const names = new Map(definitions.map((definition) => [definition.id, definition.name]));
  const history = historyMessages(session.messages);
  const view = (write: StateWrite, candidates: readonly string[]) => {
    const definitionName = write.target.kind === 'definition' ? names.get(write.target.definitionId) : undefined;
    const label = nodeLabel(
      write.nodeId,
      write.target.kind === 'node' ? write.target.workflowId : undefined,
      candidates,
    );
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
      ...keyViews(folded.keys, history),
      warnings: folded.warnings,
    })),
    nodes: story.nodes.map((folded) => {
      const label = nodeLabel(folded.nodeId, folded.workflowId, listed);
      return {
        nodeId: folded.nodeId,
        ...(folded.workflowId !== undefined && { workflowId: folded.workflowId }),
        ...(label !== undefined && { label }),
        ...nodeKeyViews(folded.keys),
      };
    }),
    turns: story.turns.map(({ entry, turn }) => {
      // The workflows of the turn's runs come first: the entry's own are the likeliest writers of its writes.
      const candidates = [...new Set([...(entry.runs?.map((run) => run.workflowId) ?? []), ...listed])];
      // A run stored as `running` that this server does not hold is one a restart cut short: it reads as an error.
      const runs = effectiveRuns(entry, isLive);
      const post = postOfEntry(entry, isLive);
      return {
        executionId: entry.executionId,
        at: entry.at,
        completed: entry.completed,
        replies: entry.replies,
        turnNumber: turn,
        writes: entry.writes.map((write) => view(write, candidates)),
        ...(runs && {
          runs: runs.map((run) => {
            const workflow = workflows.get(run.workflowId);
            return { ...run, ...(workflow && { workflowName: workflow.name }) };
          }),
        }),
        ...(post && { postStatus: post.status }),
        ...(post?.executionId !== undefined && { postExecutionId: post.executionId }),
        ...(post?.error !== undefined && { postError: post.error }),
        ...(entry.linkWarnings?.length && { linkWarnings: entry.linkWarnings }),
      };
    }),
  };
}

import { z } from 'zod';
import { registry } from '@st/engine';
import { apiContract, type Session } from '@st/shared';
import { define, edge, makeSession, makeWorkflow, node, send, tempApps, type App } from './story.js';
import { stateView, waitForPostRun } from './post.js';

// Helpers of the message link tests: a workflow that wires summaries the way the README does, stand-ins for the
// summarizing LLM and for nodes that fail or hold a run, and checks over the items a chat's summaries key holds.

const SUMMARIZER = 'link-test-llm';
const FAILER = 'link-test-fail';
const HOLDER = 'link-test-hold';

const memoryBody = { name: 'memory', keys: { summaries: { type: 'collection' } } };

/** Resolved by the holder node when it starts (see `holdStarted`). */
const holding: { resolve?: () => void } = {};
/** Resolves when the next holder node begins executing. */
export function holdStarted(): Promise<void> {
  return new Promise((resolve) => {
    holding.resolve = resolve;
  });
}

/** Registers the test node types; call `dispose` in `afterEach`. */
function linkNodes() {
  const base = { label: '', description: '', category: 'Tests', configSchema: z.object({}), defaultConfig: {} };
  registry.set(SUMMARIZER, {
    ...base,
    type: SUMMARIZER,
    inputs: [{ name: 'value', label: 'Value', dataType: 'any' }],
    outputs: [{ name: 'value', label: 'Value', dataType: 'any' }],
    // "S[<first line of the transcript>]": enough to tell which chunk a summary is of.
    async execute(ctx) {
      return { value: `S[${String(ctx.inputs.value).split('\n')[0]}]` };
    },
  });
  registry.set(FAILER, {
    ...base,
    type: FAILER,
    sink: true,
    inputs: [{ name: 'value', label: 'Value', dataType: 'any' }],
    outputs: [],
    async execute() {
      throw new Error('the failer failed');
    },
  });
  // A sink that holds the run until it is aborted (stopped).
  registry.set(HOLDER, {
    ...base,
    type: HOLDER,
    sink: true,
    inputs: [{ name: 'value', label: 'Value', dataType: 'any' }],
    outputs: [],
    async execute(ctx) {
      await new Promise<void>((resolve) => {
        holding.resolve?.();
        if (ctx.signal.aborted) resolve();
        ctx.signal.addEventListener('abort', () => resolve(), { once: true });
      });
      return {};
    },
  });
  return {
    dispose() {
      for (const type of [HOLDER, SUMMARIZER, FAILER]) registry.delete(type);
    },
  };
}

export type LinkWorkflowOptions = {
  /** Where the chunk's text goes on its way to State Write (default: the test summarizer). */
  via?: { type: string; id?: string };
  /** Run Next Chunk and State Write in the reply part instead of after the reply. */
  inReply?: boolean;
  /** Link the item to After Reply's replies (no fingerprint) instead of Next Chunk's link; after the reply only. */
  linkToReplies?: boolean;
  /** A node that fails once State Write has completed (in the part that holds it). */
  failAfterSave?: boolean;
  /** A sink that holds the run (until it is stopped) once State Write has completed. */
  holdAfterSave?: boolean;
};

/**
 * input; Memory (all) -> Unlinked Messages (memory.summaries) -> Chat Output replying
 * `S[<intact summaries in chat order>] H[<messages no summary stands for>]`; Next Chunk (chunks of 2, raw window 2) ->
 * summarizer -> State Write (add to memory.summaries, linked), after the reply unless `inReply`. At turn k the
 * history has 2(k-1) messages, so turn 3 is the first with a chunk to link.
 */
function linkWorkflow(definitionId: string, options: LinkWorkflowOptions = {}) {
  const via = options.via ?? { type: SUMMARIZER };
  const viaId = via.id ?? 'llm';
  const target = { definitionId, key: 'summaries' };
  return {
    nodes: [
      node('input', 'chat-input'),
      node('mem', 'memory', { all: true, format: 'messages' }),
      node('un', 'unlinked-messages', target),
      node('output', 'chat-output', {
        template: 'S[{{#each (linked state.memory.summaries)}}{{text}};{{/each}}] H[{{input.value}}]',
      }),
      ...(options.inReply ? [] : [node('after', 'after-reply')]),
      node('next', 'next-chunk', { ...target, chunkSize: 2, rawWindow: 2 }),
      node(viaId, via.type),
      node('save', 'state-write', { ...target, op: 'add' }),
      ...(options.failAfterSave ? [node('fail', FAILER)] : []),
      ...(options.holdAfterSave ? [node('hold', HOLDER)] : []),
    ],
    edges: [
      edge('mem', 'history', 'un', 'messages'),
      edge('un', 'text', 'output', 'value'),
      ...(options.inReply ? [] : [edge('after', 'turn', 'next', 'after')]),
      edge('next', 'text', viaId, 'value'),
      edge(options.linkToReplies ? 'after' : 'next', options.linkToReplies ? 'replies' : 'link', 'save', 'messages'),
      edge(viaId, 'value', 'save', 'value'),
      ...(options.failAfterSave ? [edge('save', 'value', 'fail', 'value')] : []),
      ...(options.holdAfterSave ? [edge('save', 'value', 'hold', 'value')] : []),
    ],
  };
}

export function linkHarness(prefix: string) {
  const apps = tempApps(prefix);
  const opened: App[] = [];
  let nodes: ReturnType<typeof linkNodes> | undefined;
  return {
    async open() {
      nodes ??= linkNodes();
      const { app, directory } = await apps.open();
      opened.push(app);
      return { app, directory, definition: await define(app, memoryBody) };
    },
    async chat(options: LinkWorkflowOptions = {}) {
      const { app, directory, definition } = await this.open();
      const { nodes: graphNodes, edges } = linkWorkflow(definition.id, options);
      const workflow = await makeWorkflow(app, graphNodes, edges);
      return { app, directory, definition, workflow, session: await makeSession(app, workflow.id) };
    },
    async cleanup() {
      nodes?.dispose();
      nodes = undefined;
      await Promise.all(opened.splice(0).map((app) => app.close()));
      await apps.cleanup();
    },
  };
}

/** Sends a message, and waits for the turn's after-reply run when it has one. Returns the reply text. */
export async function say(app: App, session: Session, content: string, post = true): Promise<string> {
  const response = await send(app, session.id, content);
  if (response.statusCode !== 200) throw new Error(`turn failed: ${response.statusCode} ${response.body}`);
  if (post) await waitForPostRun(app, session.id, 'completed');
  return apiContract.sendMessage.response.parse(response.json()).assistantMessages[0]!.content;
}

type SummaryItem = { id: string; text: string; messages?: { ids: string[]; fingerprint?: string } };

/** The items of `memory.summaries` as the chat holds them now (newest first), and the stored session. */
export async function storedItems(app: App, sessionId: string) {
  const session = apiContract.getSession.response.parse(
    (await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}` })).json(),
  );
  const view = await stateView(app, sessionId);
  const items = (view.definitions.find((definition) => definition.name === 'memory')?.values.summaries ??
    []) as SummaryItem[];
  return { session, items, view };
}

export const patchMessage = (app: App, sessionId: string, messageId: string, content: string) =>
  app.inject({ method: 'PATCH', url: `/api/sessions/${sessionId}/messages/${messageId}`, payload: { content } });

import { z } from 'zod';
import { registry } from '@st/engine';
import { apiContract, readSummaries, type Session } from '@st/shared';
import { edge, makeSession, makeWorkflow, node, send, tempApps, type App } from './story.js';
import { waitForPostRun } from './post.js';

// Helpers of the history summary tests: a workflow whose reply shows what Memory produced, a stand-in for the
// summarizing LLM, and the checks over the chat's stored summaries.

const SUMMARIZER = 'summary-test-llm';
const FAILER = 'summary-test-fail';

/** Registers the test node types; call `dispose` in `afterEach`. */
function summaryNodes() {
  registry.set(SUMMARIZER, {
    type: SUMMARIZER,
    label: 'Summarizer',
    description: '',
    category: 'Tests',
    inputs: [{ name: 'value', label: 'Value', dataType: 'any' }],
    outputs: [{ name: 'value', label: 'Value', dataType: 'any' }],
    configSchema: z.object({}),
    defaultConfig: {},
    // "S[<first line of the transcript>]": enough to tell which chunk a summary is of.
    async execute(ctx) {
      return { value: `S[${String(ctx.inputs.value).split('\n')[0]}]` };
    },
  });
  registry.set(FAILER, {
    type: FAILER,
    label: 'Failer',
    description: '',
    category: 'Tests',
    sink: true,
    inputs: [{ name: 'value', label: 'Value', dataType: 'any' }],
    outputs: [],
    configSchema: z.object({}),
    defaultConfig: {},
    async execute() {
      throw new Error('the failer failed');
    },
  });
  return {
    dispose() {
      registry.delete(SUMMARIZER);
      registry.delete(FAILER);
    },
  };
}

export type SummaryWorkflowOptions = {
  /** Where the chunk's text goes on its way to Save Summary (default: the test summarizer). */
  via?: { type: string; id?: string };
  /** Run Next Chunk and Save Summary in the reply part instead of after the reply. */
  inReply?: boolean;
  /** A node that fails once Save Summary has completed (after-reply only). */
  failAfterSave?: boolean;
};

/**
 * input; Memory (set `main`, last 2, text) -> Chat Output replying `H[<history>]`; Next Chunk (chunks of 2, raw
 * window 2) -> summarizer -> Save Summary, after the reply unless `inReply`. At turn k the history has 2(k-1)
 * messages, so turn 3 is the first with a chunk to summarize.
 */
function summaryWorkflow(options: SummaryWorkflowOptions = {}) {
  const via = options.via ?? { type: SUMMARIZER };
  const viaId = via.id ?? 'llm';
  return {
    nodes: [
      node('input', 'chat-input'),
      node('mem', 'memory', { summarySet: 'main', lastN: 2, format: 'text' }),
      node('output', 'chat-output', { template: 'H[{{input.value}}]' }),
      ...(options.inReply ? [] : [node('after', 'after-reply')]),
      node('next', 'next-chunk', { chunkSize: 2, rawWindow: 2 }),
      node(viaId, via.type),
      node('save', 'save-summary'),
      ...(options.failAfterSave ? [node('fail', FAILER)] : []),
    ],
    edges: [
      edge('mem', 'history', 'output', 'value'),
      ...(options.inReply ? [] : [edge('after', 'turn', 'next', 'after')]),
      edge('next', 'text', viaId, 'value'),
      edge('next', 'chunk', 'save', 'chunk'),
      edge(viaId, 'value', 'save', 'text'),
      ...(options.failAfterSave ? [edge('save', 'summary', 'fail', 'value')] : []),
    ],
  };
}

export function summaryHarness(prefix: string) {
  const apps = tempApps(prefix);
  const opened: App[] = [];
  let nodes: ReturnType<typeof summaryNodes> | undefined;
  return {
    async open() {
      nodes ??= summaryNodes();
      const { app, directory } = await apps.open();
      opened.push(app);
      return { app, directory };
    },
    async chat(options: SummaryWorkflowOptions = {}) {
      const { app, directory } = await this.open();
      const { nodes: graphNodes, edges } = summaryWorkflow(options);
      const workflow = await makeWorkflow(app, graphNodes, edges);
      return { app, directory, workflow, session: await makeSession(app, workflow.id) };
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

export async function storedSummaries(app: App, sessionId: string) {
  const session = apiContract.getSession.response.parse(
    (await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}` })).json(),
  );
  return { session, summaries: readSummaries(session.summaries).main ?? [] };
}

export const patchMessage = (app: App, sessionId: string, messageId: string, content: string) =>
  app.inject({ method: 'PATCH', url: `/api/sessions/${sessionId}/messages/${messageId}`, payload: { content } });

import { join } from 'node:path';
import { vi } from 'vitest';
import { z } from 'zod';
import { registry } from '@st/engine';
import { noAccess, apiContract, type RunStatus } from '@st/shared';
import { ChangeHub } from '../services/change-events.js';
import { TurnRegistry } from '../services/turns.js';
import { define, edge, makeWorkflow, node, tempApps, type App } from './story.js';
import { makeListSession } from './triggers.js';

// Helpers of the tests of the workflows that run after the reply: a node that holds the run, the workflows around it,
// and waiting.

const GATE_TYPE = 'post-gate-test';
const REPLIES_TEXT_TYPE = 'replies-text-test';

/**
 * A normal node (`value` in, `value` out) that holds whatever run executes it until `release` or `fail`, and stops
 * at once when the run is aborted. Registers itself in the engine registry: call `dispose` in `afterEach`.
 */
export function gateNode() {
  let runs = 0;
  let open!: (value: unknown) => void;
  let close!: (error: Error) => void;
  let begin!: () => void;
  const settled = new Promise<unknown>((resolve, reject) => {
    open = resolve;
    close = reject;
  });
  settled.catch(() => undefined);
  const started = new Promise<void>((resolve) => {
    begin = resolve;
  });
  registry.set(GATE_TYPE, {
    type: GATE_TYPE,
    access: () => noAccess(),
    label: 'Post Gate',
    description: '',
    category: 'Tests',
    inputs: [{ name: 'value', label: 'Value', dataType: 'any' }],
    outputs: [{ name: 'value', label: 'Value', dataType: 'any' }],
    configSchema: z.object({}),
    defaultConfig: {},
    async execute(ctx) {
      runs++;
      begin();
      const aborted = new Promise<never>((_resolve, reject) => {
        if (ctx.signal.aborted) reject(ctx.signal.reason);
        ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason), { once: true });
      });
      const released = await Promise.race([settled, aborted]);
      return { value: released ?? ctx.inputs.value };
    },
  });
  return {
    /** Resolves when the node began executing for the first time. */
    started,
    /** How many times the node has been executed. */
    get runs() {
      return runs;
    },
    /** Lets the held run (and every later one) pass; `value` replaces the node's input. */
    release: (value?: unknown) => open(value),
    /** Fails the held run (and every later one). */
    fail: (message: string) => close(new Error(message)),
    dispose: () => {
      open(undefined);
      registry.delete(GATE_TYPE);
    },
  };
}

/**
 * Registers a node that turns Chat Input's `replies` (or `history`) into the text of the messages, so a workflow after
 * the reply can store what was said. Removed by the harness's `cleanup`.
 */
function registerRepliesText() {
  registry.set(REPLIES_TEXT_TYPE, {
    type: REPLIES_TEXT_TYPE,
    access: () => noAccess(),
    label: 'Replies Text',
    description: '',
    category: 'Tests',
    inputs: [{ name: 'value', label: 'Value', dataType: 'messages' }],
    outputs: [{ name: 'value', label: 'Value', dataType: 'text' }],
    configSchema: z.object({}),
    defaultConfig: {},
    async execute(ctx) {
      const replies = ctx.inputs.value as { content: string }[];
      return { value: replies.map((reply) => reply.content).join('\n\n') };
    },
  });
}

/**
 * The workflow that replies: input -> output ("n=<n> turn=<turn>") and a State Write `bump` that adds 1 to `counter.n`.
 */
export function replyWorkflow(definitionId: string) {
  return {
    nodes: [
      node('input', 'chat-input'),
      node('output', 'chat-output', { template: 'n={{state.counter.n}} turn={{trigger.turn}}' }),
      node('bump', 'state-write', { definitionId, key: 'n', op: 'increment' }),
    ],
    edges: [edge('input', 'message', 'output', 'value')],
  };
}

/**
 * A workflow with no Chat Output, listed below the one that replies, so it runs after the reply: an increment
 * `postBump` of `counter.n` (it completes at once, gated by Chat Input's `turn`) and `postAdd`, which adds the text of
 * the turn's replies (Chat Input's `replies`) to `counter.log`. With `gated`, a Post Gate node sits between the text and
 * `postAdd`, so `postAdd` waits for the gate.
 */
export function trailingWorkflow(definitionId: string, gated = false) {
  const write = (id: string, key: string, op: string) => node(id, 'state-write', { definitionId, key, op });
  return {
    nodes: [
      node('input', 'chat-input'),
      node('text', REPLIES_TEXT_TYPE),
      write('postBump', 'n', 'increment'),
      write('postAdd', 'log', 'add'),
      ...(gated ? [node('gate', GATE_TYPE)] : []),
    ],
    edges: [
      edge('input', 'replies', 'text', 'value'),
      edge('input', 'turn', 'postBump', 'when'),
      ...(gated
        ? [edge('text', 'value', 'gate', 'value'), edge('gate', 'value', 'postAdd', 'value')]
        : [edge('text', 'value', 'postAdd', 'value')]),
    ],
  };
}

export async function waitFor<T>(read: () => Promise<T | undefined>, attempts = 200): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for the condition');
}

/**
 * Whether `self` (the `this` of a spied repository method) is the repository `name` ('sessions', 'workflows') of the
 * app whose data directory is `directory`. Spies on the repository class are global to the process, so a test that
 * makes writes fail scopes them to its own app's repository: nothing else can use up the failures.
 */
export const isRepository = (self: unknown, directory: string, name: string): boolean =>
  (self as { directory?: string }).directory === join(directory, name);

/** Counts the jobs sent to the turn queue, so a test can wait until a request has really reached it. */
export function watchQueue() {
  const run = vi.spyOn(TurnRegistry.prototype, 'run');
  return { reached: (jobs: number) => waitFor(async () => (run.mock.calls.length >= jobs ? true : undefined)) };
}

/**
 * Watches the chat's `sessions.changed`, which the server publishes right after it has written a settled turn or
 * post run: `first` resolves with the next one, so a test can wait for the settle itself rather than poll for what it
 * left behind, and `count` is how many there were. Install it BEFORE what is to settle.
 */
export function watchSettles(sessionId: string) {
  const publish = ChangeHub.prototype.publish;
  let count = 0;
  let announce!: () => void;
  const first = new Promise<void>((resolve) => {
    announce = resolve;
  });
  vi.spyOn(ChangeHub.prototype, 'publish').mockImplementation(function (this: ChangeHub, event) {
    publish.call(this, event);
    if (event.type !== 'sessions.changed' || event.id !== sessionId) return;
    count++;
    announce();
  });
  return { first, count: () => count };
}

/** Waits until the server has no open client connection, so it has also seen every client that left. */
export async function clientsGone(app: App) {
  await waitFor(async () =>
    (await new Promise<number>((resolve) => app.server.getConnections((_error, count) => resolve(count)))) === 0
      ? true
      : undefined,
  );
  await new Promise((resolve) => setImmediate(resolve));
}

/** The state view of a chat (what the web reads). */
export async function stateView(app: App, sessionId: string) {
  const response = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}/state` });
  return apiContract.getSessionState.response.parse(response.json());
}

/** The after-section fields the state view reports for the chat's newest turn. */
export async function postRunOf(app: App, sessionId: string) {
  const turn = (await stateView(app, sessionId)).turns.at(-1);
  return { postStatus: turn?.postStatus, postExecutionId: turn?.postExecutionId, postError: turn?.postError };
}

/** Waits until the newest turn's runs after the reply stand at this status (the state view is what the web sees). */
export const waitForPostRun = (app: App, sessionId: string, status: RunStatus) =>
  waitFor(async () => {
    const run = await postRunOf(app, sessionId);
    return run.postStatus === status ? run : undefined;
  });

/**
 * The setup every test file of the after section needs: temp apps that are closed (draining any run after the reply)
 * before their directories are removed, and the gate that holds the run. Call `cleanup` from `afterEach`.
 */
export function postHarness(prefix: string) {
  const apps = tempApps(prefix);
  const opened: App[] = [];
  const held: { gate?: Gate } = {};
  /** An app with the `counter` definition. */
  async function bare() {
    registerRepliesText();
    const { app, directory } = await apps.open();
    opened.push(app);
    return { app, directory, definition: await define(app) };
  }
  /** The gate node, registered for the test (disposed by `cleanup`); `setup` wires one into the work after the reply. */
  function gate() {
    held.gate?.dispose();
    held.gate = gateNode();
    return held.gate;
  }
  return {
    bare,
    gate,
    /**
     * A chat that lists the replying workflow and, below it, the trailing one (`replyWorkflow`, `trailingWorkflow`): the
     * run after the reply is held at the gate until `gate.release()`. `workflow` is the replying one.
     */
    async setup() {
      const context = await bare();
      const hold = gate();
      const { definition } = context;
      const reply = replyWorkflow(definition.id);
      const workflow = await makeWorkflow(context.app, reply.nodes, reply.edges, 'Reply');
      const trailing = trailingWorkflow(definition.id, true);
      const after = await makeWorkflow(context.app, trailing.nodes, trailing.edges, 'After');
      const session = await makeListSession(context.app, [{ workflowId: workflow.id }, { workflowId: after.id }]);
      return { ...context, gate: hold, workflow, after, session };
    },
    async cleanup() {
      registry.delete(REPLIES_TEXT_TYPE);
      held.gate?.dispose();
      held.gate = undefined;
      await Promise.all(opened.splice(0).map((app) => app.close()));
      await apps.cleanup();
    },
  };
}

type Gate = ReturnType<typeof gateNode>;

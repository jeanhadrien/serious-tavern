import { z } from 'zod';
import { registry } from '@st/engine';
import { apiContract, type PostStatus } from '@st/shared';
import { define, edge, makeSession, makeWorkflow, node, tempApps, type App } from './story.js';

// Helpers of the after-reply (post-turn run) tests: a node that holds the run, the workflow it sits in, and waiting.

const GATE_TYPE = 'post-gate-test';

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
 * input -> output ("n=<n> turn=<turn>"), a reply-part increment `bump` of `counter.n`, After Reply, an increment
 * `postBump` of `counter.n` (it completes at once) and `postAdd`, which adds After Reply's text to `counter.log`.
 * With `gated`, a Post Gate node sits between After Reply's text and `postAdd`, so `postAdd` waits for the gate.
 */
export function afterReplyWorkflow(definitionId: string, gated = false) {
  const write = (id: string, key: string, op: string) => node(id, 'state-write', { definitionId, key, op });
  return {
    nodes: [
      node('input', 'chat-input'),
      node('output', 'chat-output', { template: 'n={{state.counter.n}} turn={{trigger.turn}}' }),
      write('bump', 'n', 'increment'),
      node('after', 'after-reply'),
      write('postBump', 'n', 'increment'),
      write('postAdd', 'log', 'add'),
      ...(gated ? [node('gate', GATE_TYPE)] : []),
    ],
    edges: [
      edge('input', 'message', 'output', 'value'),
      edge('after', 'turn', 'postBump', 'when'),
      ...(gated
        ? [edge('after', 'text', 'gate', 'value'), edge('gate', 'value', 'postAdd', 'value')]
        : [edge('after', 'text', 'postAdd', 'value')]),
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

/** The state view of a chat (what the web reads). */
export async function stateView(app: App, sessionId: string) {
  const response = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}/state` });
  return apiContract.getSessionState.response.parse(response.json());
}

/** The post-run fields the state view reports for the chat's newest turn. */
export async function postRunOf(app: App, sessionId: string) {
  const turn = (await stateView(app, sessionId)).turns.at(-1);
  return { postStatus: turn?.postStatus, postExecutionId: turn?.postExecutionId, postError: turn?.postError };
}

/** Waits until the newest turn's post run has this status (the state view is what the web sees). */
export const waitForPostRun = (app: App, sessionId: string, status: PostStatus) =>
  waitFor(async () => {
    const run = await postRunOf(app, sessionId);
    return run.postStatus === status ? run : undefined;
  });

/**
 * The setup every after-reply test file needs: temp apps that are closed (draining any post run) before their
 * directories are removed, and the gate that holds the post run. Call `cleanup` from `afterEach`.
 */
export function postHarness(prefix: string) {
  const apps = tempApps(prefix);
  const opened: App[] = [];
  const held: { gate?: Gate } = {};
  /** An app with the `counter` definition. */
  async function bare() {
    const { app, directory } = await apps.open();
    opened.push(app);
    return { app, directory, definition: await define(app) };
  }
  return {
    bare,
    /** A chat on the After Reply workflow; its post run is held at the gate until `gate.release()`. */
    async setup() {
      const context = await bare();
      const gate = gateNode();
      held.gate = gate;
      const { nodes, edges } = afterReplyWorkflow(context.definition.id, true);
      const workflow = await makeWorkflow(context.app, nodes, edges);
      return { ...context, gate, workflow, session: await makeSession(context.app, workflow.id) };
    },
    async cleanup() {
      held.gate?.dispose();
      held.gate = undefined;
      await Promise.all(opened.splice(0).map((app) => app.close()));
      await apps.cleanup();
    },
  };
}

type Gate = ReturnType<typeof gateNode>;

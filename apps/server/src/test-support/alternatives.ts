import { z } from 'zod';
import { registry } from '@st/engine';
import { noAccess, apiContract, type Session } from '@st/shared';
import { define, edge, makeSession, makeWorkflow, node, tempApps, type App } from './story.js';

// Helpers of the regenerate and swipe tests.

const ALT_TYPE = 'alt-test';

/**
 * A node with no inputs whose `value` is the number of times it has executed, so every run of a chat is told apart.
 * `hold()` makes the next execution wait until the run is aborted (it resolves once the node has started). Registers
 * itself in the engine registry: call `dispose` in `afterEach`.
 */
function altNode() {
  let calls = 0;
  let begin: (() => void) | undefined;
  registry.set(ALT_TYPE, {
    type: ALT_TYPE,
    access: () => noAccess(),
    label: 'Alt',
    description: '',
    category: 'Tests',
    inputs: [],
    outputs: [{ name: 'value', label: 'Value', dataType: 'number' }],
    configSchema: z.object({}),
    defaultConfig: {},
    async execute(ctx) {
      calls++;
      if (begin) {
        const started = begin;
        begin = undefined;
        started();
        await new Promise<never>((_resolve, reject) => {
          if (ctx.signal.aborted) reject(ctx.signal.reason);
          ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason), { once: true });
        });
      }
      return { value: calls };
    },
  });
  return {
    hold: () => new Promise<void>((resolve) => (begin = resolve)),
    dispose: () => registry.delete(ALT_TYPE),
  };
}

/** The reply tells which run made it: `alt` (the run's number), the turn-start `n`, `trigger.turn`, the message and the history size. */
export const REPLY =
  'alt={{input.value}} n={{state.counter.n}} turn={{trigger.turn}} msg={{trigger.message}} hist={{history.length}}';

/** input, `alt`, a State Write that sets `counter.n` to `alt`'s value, and an output that shows `REPLY`. */
function altWorkflow(definitionId: string) {
  return {
    nodes: [
      node('input', 'chat-input'),
      node('alt', ALT_TYPE),
      node('write', 'state-write', { definitionId, key: 'n', op: 'set' }),
      node('output', 'chat-output', { template: REPLY }),
    ],
    edges: [edge('alt', 'value', 'write', 'value'), edge('alt', 'value', 'output', 'value')],
  };
}

/** A temp app with the `counter` definition and a chat on the alt workflow. Close what it opens with `cleanup`. */
export function altHarness(prefix: string) {
  const apps = tempApps(prefix);
  const opened: App[] = [];
  const held: { alt?: ReturnType<typeof altNode> } = {};
  return {
    /** `build` replaces the workflow (it gets the `counter` definition's id). */
    async setup(build: (definitionId: string) => { nodes: object[]; edges: object[] } = altWorkflow) {
      held.alt?.dispose();
      const alt = altNode();
      held.alt = alt;
      const { app, directory } = await apps.open();
      opened.push(app);
      const definition = await define(app);
      const { nodes, edges } = build(definition.id);
      const workflow = await makeWorkflow(app, nodes, edges);
      return { app, directory, alt, definition, workflow, session: await makeSession(app, workflow.id) };
    },
    async cleanup() {
      held.alt?.dispose();
      await Promise.all(opened.splice(0).map((app) => app.close()));
      await apps.cleanup();
    },
  };
}

export const regenerate = (app: App, sessionId: string) =>
  app.inject({ method: 'POST', url: `/api/sessions/${sessionId}/regenerate` });
export const regenerateStream = (app: App, sessionId: string) =>
  app.inject({ method: 'POST', url: `/api/sessions/${sessionId}/regenerate/stream` });
export const swipe = (app: App, sessionId: string, executionId: string) =>
  app.inject({ method: 'PATCH', url: `/api/sessions/${sessionId}/alternative`, payload: { executionId } });

/** The value of `counter.n` as the state view of the chat reads it. */
export async function counterN(app: App, sessionId: string): Promise<unknown> {
  const view = apiContract.getSessionState.response.parse(
    (await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}/state` })).json(),
  );
  return view.definitions.find((definition) => definition.name === 'counter')?.values.n;
}

/** The assistant rows of the chat with their alternative bookkeeping, in stored order. */
export const altRows = (session: Session) =>
  session.messages
    .filter((message) => message.role === 'assistant')
    .map((message) => ({
      content: message.content,
      executionId: message.executionId,
      alternativeOf: message.alternativeOf,
      inactive: message.inactive,
    }));

import { z } from 'zod';
import { emptyStateSnapshot, type ChatMessage } from '@st/shared';
import { registry } from './registry.js';
import { edge, graph, node } from './test-collections.js';
import { SCENE_ID, sceneDefinition, stateResources } from './test-state.js';
import type { NodeDefinition } from './types.js';

// Fixtures for the After Reply tests: ad-hoc node types, State Write shortcuts and the options every run needs.

/** A plain node type for tests: one `value` in, one `value` out, passing the input on. */
export const testType = (type: string, extra: Partial<NodeDefinition> = {}): NodeDefinition => ({
  type,
  label: type,
  description: '',
  category: '',
  inputs: [{ name: 'value', label: 'Value', dataType: 'any' }],
  outputs: [{ name: 'value', label: 'Value', dataType: 'any' }],
  configSchema: z.object({}),
  defaultConfig: {},
  execute: async (ctx) => ({ value: ctx.inputs.value }),
  ...extra,
});

/** Registers test node types; call `unregister()` in `afterEach`. */
const registered = new Set<string>();
export function register(...definitions: NodeDefinition[]): void {
  for (const definition of definitions) {
    registered.add(definition.type);
    registry.set(definition.type, definition);
  }
}
export function unregister(): void {
  for (const type of registered) registry.delete(type);
  registered.clear();
}

/** State Write nodes on the scene definition. */
export const write = (id: string, key: string, op: string, value?: unknown) =>
  node(id, 'state-write', { definitionId: SCENE_ID, key, op, ...(value === undefined ? {} : { value }) });
export const bump = (id: string) => write(id, 'tension', 'increment');

export const run = {
  message: 'hello',
  sessionId: 'session',
  history: [] as ChatMessage[],
  secrets: { get: async () => undefined },
};

const assistant = (content: string, executionId = 'e1'): ChatMessage => ({
  id: `m-${content}`,
  role: 'assistant',
  content,
  createdAt: '',
  executionId,
});

export const scene = sceneDefinition;
export const resources = stateResources(scene);
export const key = (name: string) => ({ kind: 'definition' as const, definitionId: SCENE_ID, key: name });

/** What the after-reply run of a turn that replied "Hello there" is given. */
export const payload = { replies: [assistant('Hello there')], text: 'Hello there', turn: 1 };
export const postOptions = {
  ...run,
  resources,
  part: 'post' as const,
  afterReply: payload,
  state: emptyStateSnapshot([scene]),
};

const TEMPLATE = 'n={{state.scene.tension}} turn={{trigger.turn}}';

/**
 * input -> output ("n=<tension> turn=<turn>"), a reply-part increment `bump`, and three after-reply nodes: `after`,
 * an increment `postBump` (gated by `after.turn`) and a note `postNote` (set to `after.text`). With `probe`, a node of
 * that type sits between `after.text` and `postNote`.
 */
export const standard = (probe?: string) =>
  graph(
    [
      node('input', 'chat-input'),
      node('output', 'chat-output', { template: TEMPLATE }),
      bump('bump'),
      node('after', 'after-reply'),
      bump('postBump'),
      write('postNote', 'note', 'set'),
      ...(probe ? [node('probe', probe)] : []),
    ],
    [
      edge('input', 'message', 'output', 'value'),
      edge('after', 'turn', 'postBump', 'when'),
      ...(probe
        ? [edge('after', 'text', 'probe', 'value'), edge('probe', 'value', 'postNote', 'value')]
        : [edge('after', 'text', 'postNote', 'value')]),
    ],
  );

/** The same workflow without its after-reply nodes. */
export const withoutPost = () =>
  graph(
    [node('input', 'chat-input'), node('output', 'chat-output', { template: TEMPLATE }), bump('bump')],
    [edge('input', 'message', 'output', 'value')],
  );

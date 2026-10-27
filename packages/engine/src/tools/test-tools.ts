import { vi } from 'vitest';
import {
  foldStoryState,
  presetSchema,
  stateSnapshot,
  type Edge,
  type StateDefinition,
  type StateSnapshot,
  type StateWrite,
  type ToolCall,
  type Workflow,
} from '@st/shared';
import { StateRun } from '../state-writes.js';
import type { ChatOptions, ChatRequest, ChatResponse } from '../providers/index.js';
import { chatResponse, providerRecord, providerResources } from '../test-providers.js';
import type { ExecutionContext } from '../types.js';

// Fixtures of the tool loop tests: a story state with a key of every type, a scripted model and hand-built contexts.

const SCENE = '11111111-1111-4111-8111-111111111111';
export const scene: StateDefinition = {
  id: SCENE,
  name: 'scene',
  description: 'The scene so far',
  keys: {
    tension: { type: 'number', default: 3, min: 0, max: 10, description: 'How tense the scene is' },
    mood: { type: 'enum', options: ['calm', 'uneasy', 'tense'] },
    alarm: { type: 'boolean' },
    note: { type: 'text', default: 'none' },
    data: { type: 'object' },
    log: { type: 'collection', fields: { level: 'number' }, description: 'What happened' },
  },
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

/** The caller's fold, over a chat with no turns: the run's snapshot, or the snapshot plus the node's pending writes. */
const foldWith = (pending: StateWrite[] = [], definitions: StateDefinition[] = [scene]): StateSnapshot =>
  stateSnapshot(foldStoryState({ definitions, messages: [], state: { turns: [] }, pending }), definitions);

export const target = (key: string, definitionId = SCENE) => ({ definitionId, key });

/** An assistant reply that calls tools: `calls` are `[name, arguments]` pairs; arguments are sent as given when text. */
export function callsReply(...calls: Array<[name: string, args: unknown]>): ChatResponse {
  const tool_calls: ToolCall[] = calls.map(([name, args], index) => ({
    id: `call_${index + 1}`,
    type: 'function',
    function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) },
  }));
  return chatResponse('', { message: { role: 'assistant', content: '', tool_calls } });
}

/**
 * A model that answers its calls from `script`, in order (a function sees the request). Every call reports one wire
 * entry, like a real adapter, and the requests are kept as they were sent.
 */
export function scriptedModel(...script: Array<ChatResponse | ((request: ChatRequest) => ChatResponse)>) {
  const requests: ChatRequest[] = [];
  const chat = vi.fn(async (request: ChatRequest, options: ChatOptions): Promise<ChatResponse> => {
    requests.push(structuredClone(request));
    options.onWire?.({ url: 'https://fake.test', method: 'POST', headers: {}, body: { call: requests.length } });
    const next = script[requests.length - 1];
    if (!next) throw new Error('The scripted model has no more answers');
    return typeof next === 'function' ? next(request) : next;
  });
  return { adapter: { chat }, requests };
}

export const prompt = presetSchema.parse({
  id: '2b041793-416b-4c94-a541-99ab866230b7',
  name: 'P',
  createdAt: '',
  updatedAt: '',
  inputs: [{ id: 'history', key: 'history', dataType: 'messages' }],
  entries: [
    { id: 'sys', displayName: 'System', kind: 'message', role: 'system', enabled: true, content: 'Be brief.' },
    { kind: 'slot', id: 'history', displayName: 'History', enabled: true, inputKey: 'history', role: 'user' },
  ],
});

/** The resources an LLM node needs to run: the prompt, the `fake` provider, the scene definition. */
export const resources = {
  presets: { get: async () => prompt },
  providers: providerResources(providerRecord('fake')),
  stateDefinitions: { get: async (id: string) => (id === SCENE ? scene : undefined) },
};

/** chat-input -> llm -> chat-output, the llm node with `config` on top of the fake provider and prompt. */
export function llmWorkflow(config: Record<string, unknown>): Workflow {
  const node = (id: string, type: string, nodeConfig: Record<string, unknown> = {}) => ({
    id,
    type,
    config: nodeConfig,
    position: { x: 0, y: 0 },
  });
  const edges: Edge[] = [{ id: 'e', source: 'llm', sourceHandle: 'text', target: 'output', targetHandle: 'value' }];
  return {
    id: 'w',
    name: 'W',
    nodes: [
      node('input', 'chat-input'),
      node('llm', 'llm', { presetId: prompt.id, provider: 'fake', model: 'm', ...config }),
      node('output', 'chat-output'),
    ],
    edges,
    createdAt: '',
    updatedAt: '',
  };
}

export const runOptions = {
  message: 'hi',
  sessionId: 's',
  history: [],
  secrets: { get: async () => 'key' },
  resources,
  state: foldWith(),
  foldWith,
};

/** A hand-built context for code that talks to the tools directly; it shares a run's write buffer and fold. */
export function toolContext(options: { withFold?: boolean } = {}) {
  const logs: string[] = [];
  const run = new StateRun(
    foldWith(),
    { id: 'run', warnings: [] },
    'w',
    options.withFold === false ? undefined : foldWith,
  );
  const ctx: ExecutionContext = {
    nodeId: 'llm',
    inputs: {},
    config: {},
    trigger: { message: '', sessionId: 's' },
    history: [],
    settings: {},
    snippets: {},
    secrets: { get: async () => undefined },
    resources,
    replies: [],
    signal: new AbortController().signal,
    log: (line) => logs.push(line),
    random: () => 0,
    recordWire: () => {},
    beginWire: () => {},
    emit: () => {},
    ...run.context('llm', () => true),
  };
  return { ctx, logs, run };
}

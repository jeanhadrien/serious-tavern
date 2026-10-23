import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  apiContract,
  readTurnEntries,
  type Edge,
  type ExecutionLog,
  type Session,
  type StateDefinition,
  type Workflow,
} from '@st/shared';
import { createApp } from '../app.js';

// Helpers of the story state tests: temp apps, definitions, workflows, sessions and turns over the HTTP API.

export type App = Awaited<ReturnType<typeof createApp>>;

/** Temp data directories under `.test-data`, removed by `cleanup` (call it from `afterEach`). */
export function tempApps(prefix: string) {
  const directories: string[] = [];
  return {
    async open() {
      const directory = join(process.cwd(), '.test-data', `${prefix}-${randomUUID()}`);
      directories.push(directory);
      return { app: await createApp(directory, { seed: false }), directory };
    },
    async cleanup() {
      await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
    },
  };
}

export const node = (id: string, type: string, config: Record<string, unknown> = {}) => ({
  id,
  type,
  config,
  position: { x: 0, y: 0 },
});
export const edge = (source: string, sourceHandle: string, target: string, targetHandle: string): Edge => ({
  id: `${source}-${sourceHandle}-${target}-${targetHandle}`,
  source,
  sourceHandle,
  target,
  targetHandle,
});

/** `counter`: a number 0..5, an enum and a capped collection with a number field. */
const counterBody = {
  name: 'counter',
  keys: {
    n: { type: 'number', min: 0, max: 5 },
    mood: { type: 'enum', options: ['calm', 'tense'] },
    log: { type: 'collection', cap: 3, fields: { level: 'number' } },
  },
};

export async function define(app: App, body: object = counterBody): Promise<StateDefinition> {
  const response = await app.inject({ method: 'POST', url: '/api/state-definitions', payload: body });
  if (response.statusCode !== 201) throw new Error(`define failed: ${response.body}`);
  return response.json() as StateDefinition;
}

export async function makeWorkflow(app: App, nodes: object[], edges: object[], name = 'Story'): Promise<Workflow> {
  const created = (await app.inject({ method: 'POST', url: '/api/workflows', payload: { name } })).json();
  return putWorkflow(app, created.id, nodes, edges, name);
}

export async function putWorkflow(
  app: App,
  id: string,
  nodes: object[],
  edges: object[],
  name = 'Story',
): Promise<Workflow> {
  const response = await app.inject({ method: 'PUT', url: `/api/workflows/${id}`, payload: { name, nodes, edges } });
  if (response.statusCode !== 200) throw new Error(`workflow save failed: ${response.body}`);
  // The save report (dropped edges, issues) is not part of the stored workflow.
  const { droppedEdgeIds: _dropped, issues: _issues, ...workflow } = response.json();
  return workflow as Workflow;
}

/** input -> output ("n=<n> turn=<turn>"), plus an unconnected State Write that adds 1 to `counter.n`. */
export const counting = (definitionId: string, bump = true) => ({
  nodes: [
    node('input', 'chat-input'),
    ...(bump ? [node('bump', 'state-write', { definitionId, key: 'n', op: 'increment' })] : []),
    node('output', 'chat-output', { template: 'n={{state.counter.n}} turn={{trigger.turn}}' }),
  ],
  edges: [edge('input', 'message', 'output', 'value')],
});

export async function makeSession(app: App, workflowId: string, title?: string): Promise<Session> {
  const response = await app.inject({ method: 'POST', url: '/api/sessions', payload: { workflowId, title } });
  return apiContract.createSession.response.parse(response.json());
}

export const send = (app: App, sessionId: string, content = 'go') =>
  app.inject({ method: 'POST', url: `/api/sessions/${sessionId}/messages`, payload: { content } });

export async function readSession(app: App, id: string): Promise<Session> {
  return apiContract.getSession.response.parse(
    (await app.inject({ method: 'GET', url: `/api/sessions/${id}` })).json(),
  );
}

export async function readExecution(app: App, id: string): Promise<ExecutionLog> {
  return apiContract.getExecution.response.parse(
    (await app.inject({ method: 'GET', url: `/api/executions/${id}` })).json(),
  );
}

export const assistantRows = (session: Session) => session.messages.filter((message) => message.role === 'assistant');
export const entriesOf = (session: Session) => readTurnEntries(session.state);

/** Sends a message and returns the assistant reply texts of that turn. */
export async function turn(app: App, sessionId: string, content = 'go'): Promise<string[]> {
  const response = await send(app, sessionId, content);
  if (response.statusCode !== 200) throw new Error(`turn failed: ${response.statusCode} ${response.body}`);
  return apiContract.sendMessage.response.parse(response.json()).assistantMessages.map((m) => m.content);
}

export const deleteMessage = (app: App, sessionId: string, messageId: string) =>
  app.inject({ method: 'DELETE', url: `/api/sessions/${sessionId}/messages/${messageId}` });

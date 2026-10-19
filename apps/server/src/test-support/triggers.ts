import { apiContract, type Session, type Workflow } from '@st/shared';
import { type App, edge, makeWorkflow, node } from './story.js';

// Helpers of the reply-list tests: workflows to put in a chat's list, and chats and patches over the API.

/** A workflow that says `template` (a Chat Output on the chat input), with chat settings when given. */
export async function sayingWorkflow(
  app: App,
  name: string,
  template: string,
  settings?: unknown[],
): Promise<Workflow> {
  const workflow = await makeWorkflow(
    app,
    [node('input', 'chat-input'), node('output', 'chat-output', { template })],
    [edge('input', 'message', 'output', 'value')],
    name,
  );
  if (!settings) return workflow;
  const response = await app.inject({
    method: 'PUT',
    url: `/api/workflows/${workflow.id}`,
    payload: { name, nodes: workflow.nodes, edges: workflow.edges, settings },
  });
  return apiContract.updateWorkflow.response.parse(response.json());
}

/** A chat whose reply list is `entries` (`enabled` defaults to true), in order. */
export async function makeListSession(
  app: App,
  entries: Array<{ workflowId: string; enabled?: boolean }>,
  title?: string,
): Promise<Session> {
  const reply = entries.map(({ workflowId, enabled = true }) => ({ workflowId, enabled }));
  const response = await app.inject({ method: 'POST', url: '/api/sessions', payload: { triggers: { reply }, title } });
  if (response.statusCode !== 201) throw new Error(`create failed: ${response.statusCode} ${response.body}`);
  return apiContract.createSession.response.parse(response.json());
}

export const patchSession = (app: App, id: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'PATCH', url: `/api/sessions/${id}`, payload });

/** `send` that parses the answer of a turn that succeeded. */
export async function sendTurn(app: App, sessionId: string, content = 'go') {
  const response = await app.inject({
    method: 'POST',
    url: `/api/sessions/${sessionId}/messages`,
    payload: { content },
  });
  if (response.statusCode !== 200) throw new Error(`turn failed: ${response.statusCode} ${response.body}`);
  return apiContract.sendMessage.response.parse(response.json());
}

/** input -> output (`template`), plus an unconnected State Write that adds 1 to `counter.n`. */
export const bumpingWorkflow = (app: App, definitionId: string, name: string, template: string) =>
  makeWorkflow(
    app,
    [
      node('input', 'chat-input'),
      node('bump', 'state-write', { definitionId, key: 'n', op: 'increment' }),
      node('output', 'chat-output', { template }),
    ],
    [edge('input', 'message', 'output', 'value')],
    name,
  );

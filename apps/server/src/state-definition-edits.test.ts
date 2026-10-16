import { afterEach, describe, expect, it } from 'vitest';
import { errorEnvelopeSchema, workflowInvalidDetailsSchema, type Workflow } from '@st/shared';
import {
  counting,
  define,
  edge,
  makeSession,
  makeWorkflow,
  node,
  readSession,
  send,
  tempApps,
  turn,
  type App,
} from './test-support/story.js';

// What editing a definition does to the workflows whose State nodes use it.

const apps = tempApps('state-definition-edits');
afterEach(() => apps.cleanup());

const edit = (app: App, id: string, keys: object) =>
  app.inject({ method: 'PUT', url: `/api/state-definitions/${id}`, payload: { name: 'counter', keys } });
const getWorkflow = async (app: App, id: string) =>
  (await app.inject({ method: 'GET', url: `/api/workflows/${id}` })).json() as Workflow;
const validate = (app: App, id: string) => app.inject({ method: 'POST', url: `/api/workflows/${id}/validate` });

const NODE_NAME = '"State Write #1 (state-write)"';

describe('editing a definition used by workflows', () => {
  it('drops connections to ports that vanished, in the workflows using it and no others', async () => {
    const { app } = await apps.open();
    try {
      const definition = await define(app, {
        name: 'counter',
        keys: { log: { type: 'collection' }, n: { type: 'number' } },
      });
      const base = [node('input', 'chat-input'), node('output', 'chat-output')];
      const using = await makeWorkflow(
        app,
        [...base, node('size', 'state-read', { definitionId: definition.id, key: 'log', read: 'meta' })],
        [edge('size', 'count', 'output', 'value'), edge('size', 'written', 'output', 'value')],
        'Using',
      );
      const unrelated = await makeWorkflow(app, base, [edge('input', 'message', 'output', 'value')], 'Unrelated');
      const before = await getWorkflow(app, unrelated.id);

      // A key edit that keeps `count`: nothing to prune, the workflow is not even rewritten.
      await edit(app, definition.id, { log: { type: 'collection', cap: 5 }, n: { type: 'number' } });
      expect(await getWorkflow(app, using.id)).toEqual(using);

      // `log` stops being a collection: `count` is gone, `written` stays.
      expect((await edit(app, definition.id, { log: { type: 'number' }, n: { type: 'number' } })).statusCode).toBe(200);
      const after = await getWorkflow(app, using.id);
      expect(after.edges.map((item) => item.sourceHandle)).toEqual(['written']);
      expect(after.nodes).toEqual(using.nodes);
      expect(await getWorkflow(app, unrelated.id)).toEqual(before);
    } finally {
      await app.close();
    }
  });

  it('keeps the connections of a node whose key or operation no longer fits, and validation names the node', async () => {
    const { app } = await apps.open();
    try {
      const definition = await define(app);
      const { nodes, edges } = counting(definition.id);
      const workflow = await makeWorkflow(app, nodes, edges);
      const session = await makeSession(app, workflow.id);
      expect(await turn(app, session.id)).toEqual(['n=0 turn=1']);
      const stored = (await readSession(app, session.id)).state;

      // `increment` does not exist on a text key.
      const retyped = { n: { type: 'text' }, mood: { type: 'enum', options: ['calm'] }, log: { type: 'collection' } };
      expect((await edit(app, definition.id, retyped)).statusCode).toBe(200);
      const validation = await validate(app, workflow.id);
      expect(validation.statusCode).toBe(422);
      const details = workflowInvalidDetailsSchema.parse(errorEnvelopeSchema.parse(validation.json()).error.details);
      expect(details.issues).toEqual([
        {
          message: `${NODE_NAME} could not resolve its ports: Operation "increment" can't be used on a text key; use set or delete`,
          nodeIds: ['bump'],
        },
      ]);
      const refused = await send(app, session.id);
      expect(refused.statusCode).toBe(400);
      expect(errorEnvelopeSchema.parse(refused.json()).error).toMatchObject({ code: 'WORKFLOW_INVALID' });
      expect(await getWorkflow(app, workflow.id)).toEqual(workflow);

      // The key is gone altogether.
      await edit(app, definition.id, { mood: { type: 'enum', options: ['calm'] } });
      const gone = await validate(app, workflow.id);
      expect(gone.json().error.details.issues[0].message).toBe(
        `${NODE_NAME} could not resolve its ports: State definition "counter" has no key "n"`,
      );

      // Stored data is untouched, so restoring the key brings the chat back as it was.
      expect((await readSession(app, session.id)).state).toEqual(stored);
      await edit(app, definition.id, { n: { type: 'number', min: 0, max: 5 } });
      expect((await validate(app, workflow.id)).statusCode).toBe(200);
      expect(await turn(app, session.id)).toEqual(['n=1 turn=2']);
    } finally {
      await app.close();
    }
  });
});

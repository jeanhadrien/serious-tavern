import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { apiContract, errorEnvelopeSchema } from '@st/shared';
import { define, edge, makeWorkflow, node, tempApps, type App } from './test-support/story.js';
import { bumpingWorkflow, makeListSession, patchSession, sayingWorkflow } from './test-support/triggers.js';

// GET /api/sessions/:id/reply-plan: what each enabled workflow of the list waits for, from the access sets a turn uses.

const apps = tempApps('triggers-plan');
afterEach(() => apps.cleanup());

async function open() {
  const { app, directory } = await apps.open();
  return { app, directory, definition: await define(app) };
}
const planOf = async (app: App, sessionId: string) => {
  const response = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}/reply-plan` });
  expect(response.statusCode).toBe(200);
  return apiContract.getReplyPlan.response.parse(response.json()).entries;
};

describe('the reply plan', () => {
  it('lists independent workflows as waiting for nothing', async () => {
    const { app } = await open();
    try {
      const one = await sayingWorkflow(app, 'One', 'one');
      const two = await sayingWorkflow(app, 'Two', 'two');
      const session = await makeListSession(app, [{ workflowId: one.id }, { workflowId: two.id }]);
      expect(await planOf(app, session.id)).toEqual([
        { workflowId: one.id, waitsFor: [] },
        { workflowId: two.id, waitsFor: [] },
      ]);
    } finally {
      await app.close();
    }
  });

  it('says which workflows a reader waits for, and why', async () => {
    const { app, definition } = await open();
    try {
      const pacing = await bumpingWorkflow(app, definition.id, 'Pacing', 'p');
      const chat = await sayingWorkflow(app, 'Chat reader', 'saw {{history.length}}');
      const state = await sayingWorkflow(app, 'State reader', 'n={{state.counter.n}}');
      const other = await sayingWorkflow(app, 'Other', 'x={{state.counter.mood}}');
      const session = await makeListSession(
        app,
        [pacing, chat, state, other].map((workflow) => ({ workflowId: workflow.id })),
      );
      const plan = await planOf(app, session.id);
      expect(plan.map((entry) => entry.waitsFor)).toEqual([[], [pacing.id], [pacing.id], []]);
      // Pacing increments counter.n, so it reads it too: both readers of the chat or of n wait for it.
      expect(plan[1]!.reason).toBe('reads the chat history Pacing writes');
      expect(plan[2]!.reason).toBe('reads counter.n, which Pacing writes');
      expect(plan[3]!.reason).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('follows the saved list: order, switches and what is added', async () => {
    const { app, definition } = await open();
    try {
      const pacing = await bumpingWorkflow(app, definition.id, 'Pacing', 'p');
      const reader = await sayingWorkflow(app, 'Reader', 'n={{state.counter.n}}');
      const session = await makeListSession(app, [{ workflowId: pacing.id }, { workflowId: reader.id }]);
      expect((await planOf(app, session.id))[1]!.waitsFor).toEqual([pacing.id]);
      // Reader above Pacing: nothing above it to wait for. Pacing, which reads and writes n, never waits for a run below.
      await patchSession(app, session.id, {
        triggers: {
          reply: [
            { workflowId: reader.id, enabled: true },
            { workflowId: pacing.id, enabled: true },
          ],
        },
      });
      expect((await planOf(app, session.id)).map((entry) => [entry.workflowId, entry.waitsFor])).toEqual([
        [reader.id, []],
        [pacing.id, []],
      ]);
      // A switched-off workflow is not in the plan.
      await patchSession(app, session.id, {
        triggers: {
          reply: [
            { workflowId: pacing.id, enabled: false },
            { workflowId: reader.id, enabled: true },
          ],
        },
      });
      expect((await planOf(app, session.id)).map((entry) => entry.workflowId)).toEqual([reader.id]);
    } finally {
      await app.close();
    }
  });

  it("reads what a template reads through the preset of an LLM node and the fields of the chat's character", async () => {
    const { app, definition } = await open();
    try {
      const pacing = await bumpingWorkflow(app, definition.id, 'Pacing', 'p');
      const plain = await sayingWorkflow(app, 'Plain', 'hello');
      const character = (
        await app.inject({
          method: 'POST',
          url: '/api/characters',
          payload: { name: 'Ann', description: 'Tension {{state.counter.n}}' },
        })
      ).json();
      const session = await makeListSession(app, [{ workflowId: pacing.id }, { workflowId: plain.id }]);
      expect((await planOf(app, session.id))[1]!.waitsFor).toEqual([]);
      await patchSession(app, session.id, { characterId: character.id });
      // The session's character renders anywhere: its description reads counter.n.
      expect((await planOf(app, session.id))[1]!.waitsFor).toEqual([pacing.id]);
    } finally {
      await app.close();
    }
  });

  it("gives a workflow that is invalid or gone a reason and no waiting, and leaves it out of the others' waiting", async () => {
    const { app, directory } = await open();
    try {
      const writer = await sayingWorkflow(app, 'Writer', 'w');
      const broken = await makeWorkflow(app, [node('input', 'chat-input')], [], 'Broken');
      const reader = await sayingWorkflow(app, 'Reader', '{{history.length}}');
      const gone = await sayingWorkflow(app, 'Gone', 'g');
      const session = await makeListSession(
        app,
        [writer, broken, gone, reader].map((workflow) => ({ workflowId: workflow.id })),
      );
      // A chat's workflow cannot be deleted through the API; its file going missing is what "gone" is.
      await rm(join(directory, 'workflows', `${gone.id}.json`));
      const plan = await planOf(app, session.id);
      expect(plan.map((entry) => entry.workflowId)).toEqual([writer.id, broken.id, gone.id, reader.id]);
      expect(plan[1]).toMatchObject({ waitsFor: [], reason: expect.stringContaining('invalid') });
      expect(plan[2]).toMatchObject({ waitsFor: [], reason: 'This workflow no longer exists.' });
      expect(plan[3]).toMatchObject({ waitsFor: [writer.id] });
    } finally {
      await app.close();
    }
  });

  it('answers 404 for an unknown chat', async () => {
    const { app } = await open();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/sessions/00000000-0000-4000-8000-000000000000/reply-plan',
      });
      expect(response.statusCode).toBe(404);
      expect(errorEnvelopeSchema.parse(response.json()).error.code).toBe('NOT_FOUND');
    } finally {
      await app.close();
    }
  });

  it('matches what a turn waits for', async () => {
    const { app, definition } = await open();
    try {
      const pacing = await bumpingWorkflow(app, definition.id, 'Pacing', 'p');
      const reader = await sayingWorkflow(app, 'Reader', 'n={{state.counter.n}}');
      const solo = await makeWorkflow(
        app,
        [node('input', 'chat-input'), node('output', 'chat-output', { template: 'solo' })],
        [edge('input', 'message', 'output', 'value')],
        'Solo',
      );
      const session = await makeListSession(
        app,
        [pacing, reader, solo].map((workflow) => ({ workflowId: workflow.id })),
      );
      const plan = await planOf(app, session.id);
      const response = await app.inject({
        method: 'POST',
        url: `/api/sessions/${session.id}/messages`,
        payload: { content: 'go' },
      });
      const { executions } = apiContract.sendMessage.response.parse(response.json());
      // Each run's log names the runs it waited for, which are the plan's workflows.
      const workflowOf = new Map(executions!.map((log) => [log.id, log.workflowId]));
      expect(executions!.map((log) => (log.waitedFor ?? []).map((id) => workflowOf.get(id)))).toEqual(
        plan.map((entry) => entry.waitsFor),
      );
    } finally {
      await app.close();
    }
  });
});

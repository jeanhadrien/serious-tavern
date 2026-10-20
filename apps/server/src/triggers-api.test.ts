import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { apiContract, errorEnvelopeSchema } from '@st/shared';
import { makeSession, readSession, send, tempApps } from './test-support/story.js';
import { makeListSession, patchSession, sayingWorkflow, sendTurn } from './test-support/triggers.js';

// The reply list over the API: creating a chat with one, patching it, deleting workflows it names, and its settings.

const apps = tempApps('triggers-api');
afterEach(() => apps.cleanup());

const tone = { key: 'tone', type: 'text' };
const pace = { key: 'pace', type: 'enum', options: ['slow', 'fast'], default: 'slow' };

async function open() {
  const { app } = await apps.open();
  const one = await sayingWorkflow(app, 'One', 'tone={{settings.tone}} pace={{settings.pace}}', [tone]);
  const two = await sayingWorkflow(app, 'Two', 'tone={{settings.tone}} pace={{settings.pace}}', [pace]);
  const three = await sayingWorkflow(app, 'Three', 'three');
  return { app, one, two, three };
}
const code = (response: { json(): unknown }) => errorEnvelopeSchema.parse(response.json()).error.code;
const entries = (...ids: string[]) => ids.map((workflowId) => ({ workflowId, enabled: true }));

describe('creating a chat', () => {
  it('takes a reply list: stored as given, with workflowId mirroring its first entry', async () => {
    const { app, one, two } = await open();
    try {
      const session = await makeListSession(app, [{ workflowId: two.id, enabled: false }, { workflowId: one.id }]);
      expect(session.triggers).toEqual({
        reply: [
          { workflowId: two.id, enabled: false },
          { workflowId: one.id, enabled: true },
        ],
      });
      expect(session.workflowId).toBe(two.id);
      expect((await readSession(app, session.id)).triggers).toEqual(session.triggers);
    } finally {
      await app.close();
    }
  });

  it('keeps the legacy shape for a chat created on one workflow, which reads as a list of that workflow', async () => {
    const { app, one } = await open();
    try {
      const session = await makeSession(app, one.id);
      expect(session).not.toHaveProperty('triggers');
      expect((await sendTurn(app, session.id)).execution!.workflowId).toBe(one.id);
    } finally {
      await app.close();
    }
  });

  it.each([
    ['neither', {}],
    ['both', { workflowId: randomUUID(), triggers: { reply: entries(randomUUID()) } }],
  ])('refuses %s of workflowId and triggers', async (_, payload) => {
    const { app } = await open();
    try {
      const response = await app.inject({ method: 'POST', url: '/api/sessions', payload });
      expect(response.statusCode).toBe(400);
      expect(code(response)).toBe('VALIDATION_ERROR');
    } finally {
      await app.close();
    }
  });

  it('refuses an empty list or a repeated workflow, and answers 404 for an unknown one, storing nothing', async () => {
    const { app, one } = await open();
    try {
      const create = (reply: unknown) =>
        app.inject({ method: 'POST', url: '/api/sessions', payload: { triggers: { reply } } });
      const empty = await create([]);
      expect([empty.statusCode, code(empty)]).toEqual([400, 'TRIGGERS_INVALID']);
      const twice = await create(entries(one.id, one.id));
      expect([twice.statusCode, code(twice)]).toEqual([400, 'TRIGGERS_INVALID']);
      const unknown = await create(entries(one.id, randomUUID()));
      expect([unknown.statusCode, code(unknown)]).toEqual([404, 'NOT_FOUND']);
      const listed = apiContract.listSessions.response.parse(
        (await app.inject({ method: 'GET', url: '/api/sessions' })).json(),
      );
      expect(listed).toEqual([]);
    } finally {
      await app.close();
    }
  });
});

describe('patching the reply list', () => {
  it('replaces the whole list, mirrors the first entry into workflowId and leaves updatedAt alone', async () => {
    const { app, one, two, three } = await open();
    try {
      const session = await makeListSession(app, [{ workflowId: one.id }]);
      await sendTurn(app, session.id);
      const before = (await readSession(app, session.id)).updatedAt;
      const reply = [
        { workflowId: three.id, enabled: true },
        { workflowId: one.id, enabled: false },
        { workflowId: two.id, enabled: true },
      ];
      const response = await patchSession(app, session.id, { triggers: { reply } });
      expect(response.statusCode).toBe(200);
      const patched = apiContract.updateSession.response.parse(response.json());
      expect(patched.triggers).toEqual({ reply });
      expect(patched.workflowId).toBe(three.id);
      const saved = await readSession(app, session.id);
      expect(saved.triggers).toEqual({ reply });
      expect(saved.updatedAt).toBe(before);
      expect(saved.messages).toHaveLength(2);
      // It applies from the next turn.
      expect((await sendTurn(app, session.id)).assistantMessages.map((message) => message.content)).toEqual([
        'three',
        'tone= pace=slow',
      ]);
    } finally {
      await app.close();
    }
  });

  it('answers TRIGGERS_INVALID for an empty list, a repeated workflow, or both workflowId and triggers, changing nothing', async () => {
    const { app, one, two } = await open();
    try {
      const session = await makeListSession(app, [{ workflowId: one.id }]);
      const bad = [
        { triggers: { reply: [] } },
        { triggers: { reply: entries(one.id, two.id, one.id) } },
        { triggers: { reply: entries(two.id) }, workflowId: two.id },
      ];
      for (const payload of bad) {
        const response = await patchSession(app, session.id, payload);
        expect([response.statusCode, code(response)]).toEqual([400, 'TRIGGERS_INVALID']);
      }
      expect(await readSession(app, session.id)).toEqual(session);
    } finally {
      await app.close();
    }
  });

  it('answers 404 for an unknown workflow and for a missing chat', async () => {
    const { app, one } = await open();
    try {
      const session = await makeListSession(app, [{ workflowId: one.id }]);
      const unknown = await patchSession(app, session.id, { triggers: { reply: entries(one.id, randomUUID()) } });
      expect(unknown.statusCode).toBe(404);
      expect(await readSession(app, session.id)).toEqual(session);
      expect((await patchSession(app, randomUUID(), { triggers: { reply: entries(one.id) } })).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('turns the legacy workflowId into a list of that workflow alone, enabled', async () => {
    const { app, one, two } = await open();
    try {
      const session = await makeListSession(app, [{ workflowId: one.id }, { workflowId: two.id, enabled: false }]);
      const patched = apiContract.updateSession.response.parse(
        (await patchSession(app, session.id, { workflowId: two.id })).json(),
      );
      expect(patched.workflowId).toBe(two.id);
      expect(patched.triggers).toEqual({ reply: [{ workflowId: two.id, enabled: true }] });
    } finally {
      await app.close();
    }
  });

  it('is not gated by anything but the lock: it applies while the list is in use and keeps the chat’s messages', async () => {
    const { app, one, two } = await open();
    try {
      const session = await makeListSession(app, [{ workflowId: one.id }]);
      await sendTurn(app, session.id);
      await patchSession(app, session.id, { triggers: { reply: entries(two.id) } });
      expect((await readSession(app, session.id)).messages).toHaveLength(2);
    } finally {
      await app.close();
    }
  });
});

describe('deleting a workflow a chat lists', () => {
  it('is refused while any chat lists it, wherever, and allowed once it is taken out', async () => {
    const { app, one, two, three } = await open();
    try {
      const session = await makeListSession(app, [{ workflowId: one.id }, { workflowId: two.id, enabled: false }]);
      const legacy = await makeSession(app, three.id);
      for (const id of [one.id, two.id, three.id]) {
        const refused = await app.inject({ method: 'DELETE', url: `/api/workflows/${id}` });
        expect([refused.statusCode, code(refused)]).toEqual([409, 'WORKFLOW_IN_USE']);
      }
      await patchSession(app, session.id, { triggers: { reply: entries(one.id) } });
      expect((await app.inject({ method: 'DELETE', url: `/api/workflows/${two.id}` })).statusCode).toBe(204);
      expect((await app.inject({ method: 'DELETE', url: `/api/workflows/${three.id}` })).statusCode).toBe(409);
      await app.inject({ method: 'DELETE', url: `/api/sessions/${legacy.id}` });
      expect((await app.inject({ method: 'DELETE', url: `/api/workflows/${three.id}` })).statusCode).toBe(204);
    } finally {
      await app.close();
    }
  });
});

describe('chat settings of a list', () => {
  it('checks values against every listed workflow’s declarations together, as the list will be after the patch', async () => {
    const { app, one, two } = await open();
    try {
      const session = await makeListSession(app, [{ workflowId: one.id }]);
      const undeclared = await patchSession(app, session.id, { settings: { pace: 'fast' } });
      expect([undeclared.statusCode, code(undeclared)]).toEqual([400, 'CHAT_SETTING_INVALID']);
      expect(undeclared.json().error.message).toBe('Workflow "One" has no chat setting "pace".');
      // The same patch that adds the workflow declares it.
      const together = await patchSession(app, session.id, {
        triggers: { reply: entries(one.id, two.id) },
        settings: { pace: 'fast', tone: 'warm' },
      });
      expect(together.statusCode).toBe(200);
      expect(together.json().settings).toEqual({ pace: 'fast', tone: 'warm' });
      const wrong = await patchSession(app, session.id, { settings: { pace: 'sideways' } });
      expect(wrong.json().error.message).toBe('Chat setting "pace": "sideways" is not one of: slow, fast.');
      const ghost = await patchSession(app, session.id, { settings: { ghost: 1 } });
      expect(ghost.json().error.message).toBe(
        'None of the chat\'s workflows (One, Two) declares the chat setting "ghost".',
      );
    } finally {
      await app.close();
    }
  });

  it('resolves each run against its own workflow: a key another workflow declares is not its setting', async () => {
    const { app, one, two } = await open();
    try {
      const session = await makeListSession(app, [{ workflowId: one.id }, { workflowId: two.id }]);
      await patchSession(app, session.id, { settings: { tone: 'warm', pace: 'fast' } });
      const result = await sendTurn(app, session.id);
      expect(result.assistantMessages.map((message) => message.content)).toEqual([
        'tone=warm pace=',
        'tone= pace=fast',
      ]);
      expect(result.executions!.map((log) => log.settings)).toEqual([{ tone: 'warm' }, { pace: 'fast' }]);
    } finally {
      await app.close();
    }
  });

  it('shows the union in a preset preview of the chat, the first declaration of a key winning', async () => {
    const { app, one, two } = await open();
    try {
      const session = await makeListSession(app, [{ workflowId: one.id }, { workflowId: two.id }]);
      await patchSession(app, session.id, { settings: { pace: 'fast' } });
      const preset = {
        id: randomUUID(),
        name: 'P',
        createdAt: '',
        updatedAt: '',
        inputs: [],
        entries: [
          {
            id: 'e',
            displayName: 'E',
            kind: 'message',
            role: 'system',
            enabled: true,
            content: 'pace={{settings.pace}} tone={{settings.tone}}',
          },
        ],
      };
      const preview = async (sessionId: string) =>
        (await app.inject({ method: 'POST', url: '/api/presets/preview', payload: { preset, sessionId } })).json()
          .messages;
      expect(await preview(session.id)).toEqual([{ role: 'system', content: 'pace=fast tone=' }]);
      // A chat of the first workflow alone has no `pace`.
      const alone = await makeListSession(app, [{ workflowId: one.id }]);
      expect(await preview(alone.id)).toEqual([{ role: 'system', content: 'pace= tone=' }]);
    } finally {
      await app.close();
    }
  });
});

describe('a refused turn', () => {
  it('leaves a chat whose enabled workflow is gone as a 404, as a chat of one workflow always did', async () => {
    const { app, one } = await open();
    try {
      const session = await makeListSession(app, [{ workflowId: one.id }]);
      await app.inject({ method: 'DELETE', url: `/api/sessions/${session.id}` });
      expect((await send(app, session.id)).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});

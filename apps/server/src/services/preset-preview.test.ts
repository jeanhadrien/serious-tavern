import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import Fastify from 'fastify';
import { expect, it } from 'vitest';
import { apiContract, presetSchema, type PromptMessage } from '@st/shared';
import { createContext } from '../context.js';
import { registerErrors } from '../errors.js';
import { registerPresets } from '../routes/presets.js';

it.each(
  [false, true].flatMap((withSession) => ['custom', 'empty', 'omitted'].map((input) => ({ withSession, input }))),
)('preview preserves $input messages inputs (withSession=$withSession)', async ({ withSession, input }) => {
  const directory = join(process.cwd(), '.test-data', `preview-${randomUUID()}`);
  const context = await createContext(directory, { seed: false });
  const app = Fastify();
  registerPresets(app, context);
  registerErrors(app);
  try {
    const sessionId = randomUUID();
    const sessionMessages = [{ role: 'assistant' as const, content: 'Session history', name: 'Session speaker' }];
    if (withSession)
      await context.sessions.save({
        id: sessionId,
        title: 'Test',
        workflowId: randomUUID(),
        createdAt: '',
        updatedAt: '',
        messages: sessionMessages.map((message) => ({ ...message, id: randomUUID(), createdAt: '' })),
      });
    const custom: PromptMessage[] = [
      { role: 'system', content: 'Custom history' },
      { role: 'assistant', content: 'Custom reply', name: 'Custom speaker' },
    ];
    const preset = presetSchema.parse({
      id: randomUUID(),
      name: 'Preview',
      createdAt: '',
      updatedAt: '',
      inputs: [{ id: 'history-input', key: 'history', dataType: 'messages' }],
      entries: [{ id: 'slot', displayName: 'History', kind: 'slot', enabled: true, inputKey: 'history' }],
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/presets/preview',
      payload: {
        preset,
        ...(withSession ? { sessionId } : {}),
        ...(input === 'omitted' ? {} : { inputs: { history: input === 'custom' ? custom : [] } }),
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    const result = apiContract.previewPreset.response.parse(response.json());
    const fallback = withSession
      ? sessionMessages
      : [
          { role: 'user', content: 'Hello!' },
          { role: 'assistant', content: 'Hi! How can I help?' },
        ];
    expect(result.messages).toEqual(input === 'custom' ? custom : input === 'empty' ? [] : fallback);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

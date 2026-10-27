import { randomUUID } from 'node:crypto';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { apiContract, errorEnvelopeSchema, presetSchema } from '@st/shared';
import { createApp } from './app.js';

type App = Awaited<ReturnType<typeof createApp>>;

const directories: string[] = [];
const apps: App[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function setup() {
  const directory = join(process.cwd(), '.test-data', `snippets-${randomUUID()}`);
  directories.push(directory);
  const app = await createApp(directory, { seed: false });
  apps.push(app);
  return { app, directory };
}

const create = (app: App, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/snippets', payload });

describe('snippets', () => {
  it('stores a snippet as a readable YAML file and refuses a name another snippet has', async () => {
    const { app, directory } = await setup();
    const created = await create(app, { name: 'tone', description: 'Voice', text: 'Speak softly.\nNever shout.' });
    expect(created.statusCode, created.body).toBe(201);
    const snippet = apiContract.createSnippet.response.parse(created.json());
    expect(await readdir(join(directory, 'snippets'))).toEqual(['tone.yaml']);
    const text = await readFile(join(directory, 'snippets', 'tone.yaml'), 'utf8');
    expect(text.startsWith('name: tone\ndescription: Voice\ntext: |-\n  Speak softly.\n  Never shout.\nid: ')).toBe(
      true,
    );

    const taken = await create(app, { name: 'tone', text: 'other' });
    expect(taken.statusCode).toBe(409);
    expect(errorEnvelopeSchema.parse(taken.json()).error.code).toBe('SNIPPET_NAME_TAKEN');
    const other = apiContract.createSnippet.response.parse((await create(app, { name: 'style', text: 'x' })).json());
    const rename = await app.inject({
      method: 'PUT',
      url: `/api/snippets/${other.id}`,
      payload: { name: 'tone', text: 'x' },
    });
    expect(rename.statusCode).toBe(409);
    // Saving a snippet under its own name is not a clash.
    const own = await app.inject({
      method: 'PUT',
      url: `/api/snippets/${snippet.id}`,
      payload: { name: 'tone', text: 'y' },
    });
    expect(own.statusCode).toBe(200);
    expect(own.json()).not.toHaveProperty('description');
  });

  it('refuses a name templates cannot read', async () => {
    const { app } = await setup();
    for (const name of ['two words', '1st', 'toString', ''])
      expect((await create(app, { name, text: 'x' })).statusCode, name).toBe(400);
  });

  it('renders snippets in chat turns, the oldest winning a name that hand-edited files repeat', async () => {
    const { app, directory } = await setup();
    await create(app, { name: 'greeting', text: 'Hello {{snippets.who}}, you said {{trigger.message}}' });
    const stamps = (date: string) => `id: ${randomUUID()}\ncreatedAt: ${date}\nupdatedAt: ${date}\n`;
    await writeFile(join(directory, 'snippets', 'who-old.yaml'), `name: who\ntext: Mira\n${stamps('2020-01-01')}`);
    await writeFile(join(directory, 'snippets', 'who-new.yaml'), `name: who\ntext: Alex\n${stamps('2021-01-01')}`);
    const created = (await app.inject({ method: 'POST', url: '/api/workflows', payload: { name: 'Echo' } })).json();
    await app.inject({
      method: 'PUT',
      url: `/api/workflows/${created.id}`,
      payload: {
        name: 'Echo',
        nodes: [
          { id: 'input', type: 'chat-input', config: {}, position: { x: 0, y: 0 } },
          {
            id: 'output',
            type: 'chat-output',
            config: { template: '{{snippets.greeting}}' },
            position: { x: 1, y: 0 },
          },
        ],
        edges: [{ id: 'reply', source: 'input', sourceHandle: 'message', target: 'output', targetHandle: 'value' }],
      },
    });
    const session = (
      await app.inject({ method: 'POST', url: '/api/sessions', payload: { workflowId: created.id } })
    ).json();
    const sent = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/messages`,
      payload: { content: 'hi' },
    });
    expect(sent.statusCode, sent.body).toBe(200);
    expect(apiContract.sendMessage.response.parse(sent.json()).assistantMessages[0]?.content).toBe(
      'Hello Mira, you said hi',
    );
  });

  it('renders snippets in the preset preview and warns about unknown ones', async () => {
    const { app } = await setup();
    await create(app, { name: 'rules', text: 'Stay in character as {{char}}.' });
    const preset = presetSchema.parse({
      id: randomUUID(),
      name: 'Preview',
      createdAt: '',
      updatedAt: '',
      inputs: [],
      entries: [
        {
          id: 'main',
          displayName: 'Main',
          kind: 'message',
          enabled: true,
          role: 'system',
          content: '{{snippets.rules}}{{snippets.missing}}',
          placement: { mode: 'ordered' },
        },
      ],
    });
    const response = await app.inject({ method: 'POST', url: '/api/presets/preview', payload: { preset } });
    expect(response.statusCode, response.body).toBe(200);
    const result = apiContract.previewPreset.response.parse(response.json());
    expect(result.messages).toEqual([{ role: 'system', content: 'Stay in character as .' }]);
    expect(result.warnings).toEqual([{ path: ['entries', 0, 'content'], message: 'Unknown snippet: missing' }]);
  });
});

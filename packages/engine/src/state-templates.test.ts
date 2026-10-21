import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  foldStoryState,
  presetSchema,
  stateSnapshot,
  stateTemplateValues,
  type ChatMessage,
  type Edge,
  type StateDefinition,
  type StateWrite,
  type Workflow,
} from '@st/shared';
import { executeWorkflow } from './executor.js';
import { renderPreset } from './preset.js';
import { registry } from './registry.js';
import { renderTemplate, type TemplateContext } from './template.js';
import { chatResponse, providerRecord, providerResources, restoreAdapter, useAdapter } from './test-providers.js';

const DEF = '11111111-1111-4111-8111-111111111111';
const scene: StateDefinition = {
  id: DEF,
  name: 'scene',
  keys: {
    tension: { type: 'number', default: 3, min: 0, max: 10 },
    mood: { type: 'enum', options: ['calm', 'tense'] },
    armed: { type: 'boolean' },
    note: { type: 'text' },
    log: { type: 'collection', cap: 3 },
  },
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};
const write = (key: string, value: unknown): StateWrite => ({
  op: 'set',
  target: { kind: 'definition', definitionId: DEF, key },
  nodeId: 'w',
  value,
});
const add = (id: string, text: string): StateWrite => ({
  op: 'add',
  target: { kind: 'definition', definitionId: DEF, key: 'log' },
  nodeId: 'w',
  item: { id, text, level: 2 },
});

/** The snapshot of a chat whose one present turn made `writes` (the turn being run is 2). */
function after(...writes: StateWrite[]) {
  const turns = [{ executionId: 'e1', at: '', completed: true, replies: 1, writes }];
  const story = foldStoryState({
    definitions: [scene],
    messages: [{ role: 'assistant', executionId: 'e1', status: 'final' }],
    state: { turns },
  });
  return stateSnapshot(story, [scene]);
}

const render = (template: string, ...writes: StateWrite[]) => {
  const snapshot = after(...writes);
  const context: TemplateContext = {
    inputs: {},
    trigger: { message: '', sessionId: 's', turn: snapshot.turn },
    state: { values: stateTemplateValues(snapshot) },
  };
  return renderTemplate(template, context);
};

describe('{{state.*}} in templates', () => {
  it('renders values by definition name and key', () => {
    expect(
      render(
        '{{state.scene.tension}}/{{state.scene.mood}}/{{state.scene.armed}}/[{{state.scene.note}}]',
        write('tension', 7),
        write('mood', 'tense'),
      ),
    ).toBe('7/tense/false/[]');
  });

  it('renders defaults for a chat with no state, and the key defaults of unwritten keys', () => {
    expect(render('{{state.scene.tension}} {{state.scene.mood}}')).toBe('3 calm');
  });

  it('compares numbers, text and booleans with the template helpers', () => {
    const template =
      '{{#if (gt state.scene.tension 5)}}high{{else}}low{{/if}} {{#if (eq state.scene.mood "tense")}}T{{else}}-{{/if}} {{#if state.scene.armed}}armed{{else}}safe{{/if}}';
    expect(render(template, write('tension', 7), write('mood', 'tense'), write('armed', true))).toBe('high T armed');
    expect(render(template)).toBe('low - safe');
  });

  it('treats an enum value as text: a bare word compares as a path, a quoted one as the value', () => {
    expect(render('{{#if (eq state.scene.mood tense)}}yes{{else}}no{{/if}}', write('mood', 'tense'))).toBe('no');
    expect(render('{{#if (eq state.scene.mood "tense")}}yes{{else}}no{{/if}}', write('mood', 'tense'))).toBe('yes');
  });

  it('iterates a collection newest first, with the item fields, and takes {{else}} when empty', () => {
    const template = '{{#each state.scene.log}}[{{this.id}}:{{this.text}}:{{this.level}}]{{else}}none{{/each}}';
    expect(render(template, add('a', 'one'), add('b', 'two'))).toBe('[b:two:2][a:one:2]');
    expect(render(template)).toBe('none');
  });

  it('renders structures as compact JSON', () => {
    expect(render('{{state.scene.log}}', add('a', 'one'))).toBe('[{"id":"a","text":"one","level":2}]');
    expect(render('{{state.scene}}', write('tension', 7))).toBe(
      '{"tension":7,"mood":"calm","armed":false,"note":"","log":[]}',
    );
    expect(JSON.parse(render('{{state}}'))).toEqual({
      scene: { tension: 3, mood: 'calm', armed: false, note: '', log: [] },
    });
  });

  it('renders an unknown definition or key as empty text', () => {
    expect(render('[{{state.nope.x}}][{{state.scene.nope}}][{{state.scene.tension.deeper}}]')).toBe('[][][]');
    expect(render('{{#if state.nope.x}}y{{else}}n{{/if}}')).toBe('n');
  });

  it('is case-sensitive like every other macro', () => {
    expect(render('[{{state.Scene.tension}}][{{State.scene.tension}}]')).toBe('[][]');
  });

  it('renders {{trigger.turn}} as the turn being run, and empty without one', () => {
    expect(render('turn {{trigger.turn}}', write('tension', 1))).toBe('turn 2');
    expect(render('{{#if (eq trigger.turn 2)}}two{{/if}}', write('tension', 1))).toBe('two');
    expect(renderTemplate('[{{trigger.turn}}]', { inputs: {}, trigger: { message: '', sessionId: 's' } })).toBe('[]');
    expect(
      renderTemplate('[{{state.scene.tension}}][{{state}}]', { inputs: {}, trigger: { message: '', sessionId: 's' } }),
    ).toBe('[][{}]');
  });

  it('shows {{trigger}} with the turn once a run has one', () => {
    expect(render('{{trigger}}')).toBe('{"message":"","sessionId":"s","turn":2}');
  });

  it('cannot reach into the data it renders from', () => {
    const snapshot = after(write('tension', 5));
    const values = stateTemplateValues(snapshot);
    renderTemplate('{{state.scene.tension}}{{#each state.scene.log}}{{this.text}}{{/each}}', {
      inputs: {},
      trigger: { message: '', sessionId: 's' },
      state: { values },
    });
    expect(values.scene?.tension).toBe(5);
  });
});

describe('state in a run', () => {
  const node = (id: string, type: string, config: Record<string, unknown> = {}) => ({
    id,
    type,
    config: { ...registry.get(type)?.defaultConfig, ...config },
    position: { x: 0, y: 0 },
  });
  const edge = (source: string, sourceHandle: string, target: string, targetHandle: string): Edge => ({
    id: `${source}-${sourceHandle}-${target}-${targetHandle}`,
    source,
    sourceHandle,
    target,
    targetHandle,
  });
  const graph = (nodes: Workflow['nodes'], edges: Edge[]): Workflow => ({
    id: 'w',
    name: 'W',
    nodes,
    edges,
    createdAt: '',
    updatedAt: '',
  });
  const options = {
    message: 'hello',
    sessionId: 'session',
    history: [] as ChatMessage[],
    secrets: { get: async () => undefined },
    state: after(write('tension', 8), write('mood', 'tense')),
  };

  afterEach(() => {
    vi.restoreAllMocks();
    restoreAdapter();
  });

  it('renders state and the turn in a Chat Output template', async () => {
    const wf = graph(
      [
        node('input', 'chat-input'),
        node('output', 'chat-output', { template: 't{{trigger.turn}} n={{state.scene.tension}} {{state.scene.mood}}' }),
      ],
      [edge('input', 'message', 'output', 'value')],
    );
    expect((await executeWorkflow(wf, options)).replies[0]?.content).toBe('t2 n=8 tense');
  });

  it('routes a Condition on a state value, in the left and right templates', async () => {
    const wf = (operator: string) =>
      graph(
        [
          node('input', 'chat-input'),
          node('condition', 'condition', { left: '{{state.scene.tension}}', operator, right: '5' }),
          node('yes', 'chat-output', { template: 'high', name: '' }),
          node('no', 'chat-output', { template: 'low', name: '' }),
        ],
        [
          edge('input', 'message', 'condition', 'value'),
          edge('condition', 'true', 'yes', 'value'),
          edge('condition', 'false', 'no', 'value'),
        ],
      );
    expect((await executeWorkflow(wf('gt'), options)).replies.map((reply) => reply.content)).toEqual(['high']);
    expect((await executeWorkflow(wf('lt'), options)).replies.map((reply) => reply.content)).toEqual(['low']);
  });

  it('gives an LLM node’s preset the state and the turn, and renders defaults without a snapshot', async () => {
    const chat = vi.fn().mockResolvedValue(chatResponse('ok'));
    useAdapter({ chat });
    const preset = presetSchema.parse({
      id: '2b041793-416b-4c94-a541-99ab866230b7',
      name: 'P',
      createdAt: '',
      updatedAt: '',
      inputs: [],
      entries: [
        {
          id: 'sys',
          displayName: 'System',
          kind: 'message',
          role: 'system',
          enabled: true,
          content: 'Turn {{trigger.turn}}. Tension {{state.scene.tension}} ({{state.scene.mood}}).',
        },
      ],
    });
    const wf = graph(
      [
        node('input', 'chat-input'),
        node('llm', 'llm', { presetId: preset.id, provider: 'fake', model: 'm' }),
        node('output', 'chat-output'),
      ],
      [edge('llm', 'text', 'output', 'value')],
    );
    const resources = { presets: { get: async () => preset }, providers: providerResources(providerRecord('fake')) };
    const secrets = { get: async () => 'key' };
    await executeWorkflow(wf, { ...options, resources, secrets });
    expect(chat.mock.calls[0]?.[0].messages).toEqual([{ role: 'system', content: 'Turn 2. Tension 8 (tense).' }]);
    const { state: _, ...bare } = options;
    await executeWorkflow(wf, { ...bare, resources, secrets });
    expect(chat.mock.calls[1]?.[0].messages).toEqual([{ role: 'system', content: 'Turn . Tension  ().' }]);
  });

  it('renders state in preset entries and drops an entry whose only variable is empty', () => {
    const preset = presetSchema.parse({
      id: '8f1fe1a9-3480-4e52-834c-f25d90684d71',
      name: 'Test',
      createdAt: '',
      updatedAt: '',
      inputs: [],
      entries: [
        {
          id: 'note',
          displayName: 'Note',
          kind: 'message',
          role: 'system',
          enabled: true,
          content: '{{state.scene.note}}',
        },
        {
          id: 'level',
          displayName: 'Level',
          kind: 'message',
          role: 'system',
          enabled: true,
          content: '{{#if (gt state.scene.tension 5)}}tense scene{{/if}}',
        },
      ],
    });
    const render = (...writes: StateWrite[]) =>
      renderPreset(preset, {
        inputs: {},
        templateContext: {
          trigger: { message: '', sessionId: 's' },
          state: { values: stateTemplateValues(after(...writes)) },
        },
      });
    expect(render(write('note', 'rain'), write('tension', 9))).toEqual([
      { role: 'system', content: 'rain' },
      { role: 'system', content: 'tense scene' },
    ]);
    expect(render()).toEqual([]);
  });
});

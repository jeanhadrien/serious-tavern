import { expect, it } from 'vitest';
import type { Workflow, Preset } from '@st/shared';
import { renderPreset, validateWorkflow } from '@st/engine';
import type { Repository } from './storage/repository.js';
import { defaultPreset, seed } from './seed.js';

it('keeps the built-in preset and entry IDs stable', () => {
  const first = defaultPreset();
  const second = defaultPreset();
  expect(first.id).toBe('5d6c72c7-5185-4963-8227-527f12ef9eea');
  expect(first.entries.map(entry => entry.id)).toEqual(second.entries.map(entry => entry.id));
  expect(first.inputs.map(input => input.key)).toEqual(['history', 'message']);
  expect(first.inputs.map(input => [input.key, input.dataType, input.label])).toEqual([
    ['history', 'messages', 'Chat history'], ['message', 'text', 'User message']
  ]);
  expect(first.entries.map(entry => [entry.kind, entry.name])).toEqual([
    ['message', 'Main prompt'], ['message', 'Character description'], ['message', 'Personality'],
    ['message', 'Scenario'], ['message', 'Persona'], ['message', 'Example dialogue'],
    ['slot', 'Chat history'], ['message', 'Post-history instructions'], ['slot', 'User message']
  ]);
  expect(first.entries.some(entry => entry.kind === 'message' && entry.content.includes('first_mes'))).toBe(false);
});

it('renders no blank default entries and preserves the character prompt field order', () => {
  const preset = defaultPreset();
  const templateContext = { trigger: { message: '', sessionId: 'session' }, history: [] };
  expect(renderPreset(preset, { inputs: { history: [], message: '' }, templateContext })).toEqual([]);
  const messages = renderPreset(preset, {
    inputs: { history: [], message: '' },
    templateContext: {
      ...templateContext,
      character: { id: 'c', name: 'Rin', description: 'description', personality: 'personality',
        scenario: 'scenario', first_mes: 'must not appear', mes_example: 'examples', creator_notes: '',
        system_prompt: 'main prompt', post_history_instructions: 'after history', alternate_greetings: [],
        tags: [], creator: '', character_version: '', extensions: {}, avatar: false, createdAt: '', updatedAt: '' },
      persona: { id: 'p', name: 'Sam', description: 'persona', avatar: false, createdAt: '', updatedAt: '' }
    }
  });
  expect(messages.map(message => message.content)).toEqual([
    'main prompt', 'description', 'personality', 'scenario', 'persona', 'examples', 'after history'
  ]);
});

it('seeds two valid workflows only once', async () => {
  const items = new Map<string, Workflow>();
  const repository: Repository<Workflow> = {
    list: async () => [...items.values()],
    get: async id => items.get(id),
    save: async item => { items.set(item.id, item); },
    update: async (id, mutator) => {
      const current = items.get(id);
      if (!current) return undefined;
      const updated = await mutator(current);
      items.set(id, updated);
      return updated;
    },
    delete: async id => { items.delete(id); }
  };
  const presets = new Map<string, Preset>();
  const presetRepository: Repository<Preset> = {
    list: async () => [...presets.values()], get: async key => presets.get(key),
    save: async preset => { presets.set(preset.id, preset); },
    update: async (key, mutator) => {
      const current = presets.get(key);
      if (!current) return undefined;
      const updated = await mutator(current);
      presets.set(key, updated);
      return updated;
    },
    delete: async key => { presets.delete(key); }
  };
  await seed(repository, presetRepository);
  expect(await Promise.all([...items.values()].map(async workflow => [workflow.name,
    await validateWorkflow(workflow, { presets: presetRepository })])))
    .toEqual([['Default Assistant', []], ['Parallel demo', []]]);
  await seed(repository, presetRepository);
  expect(items.size).toBe(2);
  expect(presets.size).toBe(1);
});
it('uses stable seed IDs when two initializers observe empty stores concurrently', async () => {
  const workflows = new Map<string, Workflow>();
  const presets = new Map<string, Preset>();
  const workflowRepository: Repository<Workflow> = {
    list: async () => [...workflows.values()], get: async key => workflows.get(key),
    save: async workflow => { workflows.set(workflow.id, workflow); },
    update: async (key, mutator) => {
      const current = workflows.get(key);
      if (!current) return undefined;
      const updated = await mutator(current);
      workflows.set(key, updated);
      return updated;
    },
    delete: async key => { workflows.delete(key); }
  };
  const presetRepository: Repository<Preset> = {
    list: async () => [...presets.values()], get: async key => presets.get(key),
    save: async preset => { presets.set(preset.id, preset); },
    update: async (key, mutator) => {
      const current = presets.get(key);
      if (!current) return undefined;
      const updated = await mutator(current);
      presets.set(key, updated);
      return updated;
    },
    delete: async key => { presets.delete(key); }
  };
  await Promise.all([seed(workflowRepository, presetRepository), seed(workflowRepository, presetRepository)]);
  expect(presets.size).toBe(1);
  expect(workflows.size).toBe(2);
  for (const workflow of workflows.values()) expect(await validateWorkflow(workflow, { presets: presetRepository })).toEqual([]);
});

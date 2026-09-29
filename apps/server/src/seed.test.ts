import { expect, it } from 'vitest';
import type { Workflow, Preset } from '@st/shared';
import { validateWorkflow } from '@st/engine';
import type { Repository } from './storage/repository.js';
import { defaultPreset, seed } from './seed.js';

it('keeps the built-in preset and entry IDs stable', () => {
  const first = defaultPreset();
  const second = defaultPreset();
  expect(first.id).toBe('5d6c72c7-5185-4963-8227-527f12ef9eea');
  expect(first.entries.map(entry => entry.id)).toEqual(second.entries.map(entry => entry.id));
  expect(first.inputs.map(input => input.key)).toEqual(['history', 'message']);
});

it('seeds two valid workflows only once', async () => {
  const items = new Map<string, Workflow>();
  const repository: Repository<Workflow> = {
    list: async () => [...items.values()],
    get: async id => items.get(id),
    save: async item => { items.set(item.id, item); },
    delete: async id => { items.delete(id); }
  };
  const presets = new Map<string, Preset>();
  const presetRepository: Repository<Preset> = {
    list: async () => [...presets.values()], get: async key => presets.get(key),
    save: async preset => { presets.set(preset.id, preset); }, delete: async key => { presets.delete(key); }
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
    save: async workflow => { workflows.set(workflow.id, workflow); }, delete: async key => { workflows.delete(key); }
  };
  const presetRepository: Repository<Preset> = {
    list: async () => [...presets.values()], get: async key => presets.get(key),
    save: async preset => { presets.set(preset.id, preset); }, delete: async key => { presets.delete(key); }
  };
  await Promise.all([seed(workflowRepository, presetRepository), seed(workflowRepository, presetRepository)]);
  expect(presets.size).toBe(1);
  expect(workflows.size).toBe(2);
  for (const workflow of workflows.values()) expect(await validateWorkflow(workflow, { presets: presetRepository })).toEqual([]);
});

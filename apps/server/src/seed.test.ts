import { expect, it } from 'vitest';
import type { Workflow, Preset } from '@st/shared';
import { validateWorkflow } from '@st/engine';
import type { Repository } from './storage/repository.js';
import { seed } from './seed.js';

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

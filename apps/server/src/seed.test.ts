import { expect, it } from 'vitest';
import type { Workflow } from '@st/shared';
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
  await seed(repository);
  expect([...items.values()].map(workflow => [workflow.name, validateWorkflow(workflow)]))
    .toEqual([['Default Assistant', []], ['Parallel demo', []]]);
  await seed(repository);
  expect(items.size).toBe(2);
});

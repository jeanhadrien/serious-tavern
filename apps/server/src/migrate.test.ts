import { expect, it } from 'vitest';
import type { Preset, Workflow } from '@st/shared';
import { validateWorkflow } from '@st/engine';
import { migrateLegacyLlm } from './migrate.js';
import type { Repository } from './storage/repository.js';

const repo = <T extends { id: string }>(items: T[]): Repository<T> => {
  const map = new Map(items.map(item => [item.id, item]));
  return { list: async () => [...map.values()], get: async id => map.get(id),
    save: async item => { map.set(item.id, structuredClone(item)); }, delete: async id => { map.delete(id); } };
};
it('migrates legacy LLM nodes once and preserves valid graph ports', async () => {
  const workflow: Workflow = { id: 'workflow', name: 'Legacy', createdAt: '', updatedAt: '',
    nodes: [
      { id: 'input', type: 'chat-input', config: {}, position: { x: 0, y: 0 } },
      { id: 'llm', type: 'llm', config: { model: 'test', systemPrompt: 'Be useful',
        includeHistory: true, promptTemplate: '' }, position: { x: 0, y: 0 } },
      { id: 'output', type: 'chat-output', config: {}, position: { x: 0, y: 0 } }
    ], edges: [
      { id: 'prompt', source: 'input', sourceHandle: 'message', target: 'llm', targetHandle: 'prompt' },
      { id: 'reply', source: 'llm', sourceHandle: 'text', target: 'output', targetHandle: 'value' }
    ] };
  const workflows = repo([workflow]);
  const presets = repo<Preset>([]);
  expect(await migrateLegacyLlm(workflows, presets)).toHaveLength(1);
  const migrated = (await workflows.list())[0]!;
  expect(migrated.nodes[1]?.config).toMatchObject({ presetId: expect.any(String), model: 'test', provider: 'openrouter' });
  expect(migrated.edges.map(edge => edge.targetHandle)).toEqual(['message', 'value', 'history']);
  expect((await presets.list())[0]?.entries.map(entry => entry.kind)).toEqual(['message', 'slot', 'slot']);
  expect(await validateWorkflow(migrated, { presets })).toEqual([]);
  expect(await migrateLegacyLlm(workflows, presets)).toEqual([]);
  expect((await presets.list())).toHaveLength(1);
});

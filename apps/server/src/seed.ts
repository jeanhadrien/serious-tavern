import { randomUUID } from 'node:crypto';
import type { Workflow, NodeInstance, Edge } from '@st/shared';
import { registry } from '@st/engine';
import type { Repository } from './storage/repository.js';

function makeWorkflow(name: string, specs: { id: string; type: string; config?: Record<string, unknown> }[],
  connections: [string, string, string, string][]): Workflow {
  const now = new Date().toISOString();
  return {
    id: randomUUID(), name, createdAt: now, updatedAt: now,
    nodes: specs.map((spec, index): NodeInstance => ({
      id: spec.id, type: spec.type, config: { ...registry.get(spec.type)!.defaultConfig, ...spec.config },
      position: { x: 100 + (index % 3) * 310, y: 100 + Math.floor(index / 3) * 230 }
    })),
    edges: connections.map(([source, sourceHandle, target, targetHandle]): Edge =>
      ({ id: randomUUID(), source, sourceHandle, target, targetHandle }))
  };
}
export async function seed(workflows: Repository<Workflow>): Promise<void> {
  if ((await workflows.list()).length) return;
  await workflows.save(makeWorkflow('Default Assistant',
    [{ id: 'input', type: 'chat-input' }, { id: 'memory', type: 'memory' }, { id: 'llm', type: 'llm' }, { id: 'output', type: 'chat-output' }],
    [['input', 'message', 'llm', 'prompt'], ['memory', 'history', 'llm', 'context'], ['llm', 'text', 'output', 'value']]));
  await workflows.save(makeWorkflow('Parallel demo',
    [{ id: 'input', type: 'chat-input' }, { id: 'http-a', type: 'http-request', config: { url: 'https://httpbin.org/anything?source=a' } },
      { id: 'http-b', type: 'http-request', config: { url: 'https://httpbin.org/anything?source=b' } },
      { id: 'merge', type: 'merge' }, { id: 'output', type: 'chat-output' }],
    [['input', 'message', 'http-a', 'input'], ['input', 'message', 'http-b', 'input'],
      ['http-a', 'body', 'merge', 'a'], ['http-b', 'body', 'merge', 'b'], ['merge', 'value', 'output', 'value']]));
}

import { randomUUID } from 'node:crypto';
import type { Workflow, NodeInstance, Edge, Preset } from '@st/shared';
import { registry } from '@st/engine';
import type { Repository } from './storage/repository.js';

function makeWorkflow(id: string, name: string, specs: { id: string; type: string; config?: Record<string, unknown> }[],
  connections: [string, string, string, string][]): Workflow {
  const now = new Date().toISOString();
  return {
    id, name, createdAt: now, updatedAt: now,
    nodes: specs.map((spec, index): NodeInstance => ({
      id: spec.id, type: spec.type, config: { ...registry.get(spec.type)!.defaultConfig, ...spec.config },
      position: { x: 100 + (index % 3) * 310, y: 100 + Math.floor(index / 3) * 230 }
    })),
    edges: connections.map(([source, sourceHandle, target, targetHandle]): Edge =>
      ({ id: randomUUID(), source, sourceHandle, target, targetHandle }))
  };
}
export function defaultPreset(): Preset {
  const date = new Date().toISOString();
  return { id: '5d6c72c7-5185-4963-8227-527f12ef9eea', name: 'Default', inputs: [
    { id: 'default-history', key: 'history', label: 'Chat history', dataType: 'messages' },
    { id: 'default-message', key: 'message', label: 'User message', dataType: 'text' }
  ], entries: [
    { id: 'default-main-prompt', name: 'Main prompt', enabled: true, kind: 'message', role: 'system',
      content: '{{char.name}}\n{{char.description}}\n{{char.personality}}\n{{char.scenario}}\n{{char.first_mes}}\n{{char.mes_example}}\n{{char.system_prompt}}\n{{char.post_history_instructions}}\nYou are speaking with {{user}}. {{user.description}}',
      placement: { mode: 'ordered' } },
    { id: 'default-history-slot', name: 'Chat history', enabled: true, kind: 'slot', inputKey: 'history', role: 'user' },
    { id: 'default-message-slot', name: 'User message', enabled: true, kind: 'slot', inputKey: 'message', role: 'user' }
  ], createdAt: date, updatedAt: date };
}
export async function seed(workflows: Repository<Workflow>, presets: Repository<Preset>): Promise<void> {
  let available = await presets.list();
  if (!available.length) { const preset = defaultPreset(); await presets.save(preset); available = [preset]; }
  if ((await workflows.list()).length) return;
  await workflows.save(makeWorkflow('9f042b0a-a269-415f-bf83-375a70ce9d92', 'Default Assistant',
    [{ id: 'input', type: 'chat-input' }, { id: 'llm', type: 'llm', config: { presetId: available[0]!.id } }, { id: 'output', type: 'chat-output' }],
    [['input', 'message', 'llm', 'message'], ['input', 'history', 'llm', 'history'], ['llm', 'text', 'output', 'value']]));
  await workflows.save(makeWorkflow('db4c4ad3-c814-4879-9fc4-9b06d444a6c9', 'Parallel demo',
    [{ id: 'input', type: 'chat-input' }, { id: 'http-a', type: 'http-request', config: { url: 'https://httpbin.org/anything?source=a' } },
      { id: 'http-b', type: 'http-request', config: { url: 'https://httpbin.org/anything?source=b' } },
      { id: 'merge', type: 'merge' }, { id: 'output', type: 'chat-output' }],
    [['input', 'message', 'http-a', 'input'], ['input', 'message', 'http-b', 'input'],
      ['http-a', 'body', 'merge', 'a'], ['http-b', 'body', 'merge', 'b'], ['merge', 'value', 'output', 'value']]));
}

import { randomUUID } from 'node:crypto';
import type { Workflow, Preset, PresetEntry } from '@st/shared';
import type { Repository } from './storage/repository.js';

export async function migrateLegacyLlm(workflows: Repository<Workflow>, presets: Repository<Preset>): Promise<string[]> {
  const changed: string[] = [];
  for (const workflow of await workflows.list()) {
    let dirty = false;
    for (const node of workflow.nodes.filter(n => n.type === 'llm')) {
      const config = node.config;
      const old = ['systemPrompt', 'promptTemplate', 'includeHistory'].some(key => Object.hasOwn(config, key)) ||
        workflow.edges.some(edge => edge.target === node.id && edge.targetHandle === 'prompt');
      if (!old) continue;
      const history = config.includeHistory !== false;
      const duplicateHistory = history && workflow.edges.some(edge => edge.target === node.id &&
        edge.targetHandle === 'context' && workflow.nodes.some(source => source.id === edge.source && source.type === 'memory'));
      if (duplicateHistory) {
        workflow.edges = workflow.edges.filter(edge => !(edge.target === node.id && edge.targetHandle === 'context' &&
          workflow.nodes.some(source => source.id === edge.source && source.type === 'memory')));
        workflow.nodes = workflow.nodes.filter(source => source.type !== 'memory' ||
          workflow.edges.some(edge => edge.source === source.id || edge.target === source.id));
      }
      const context = workflow.edges.some(edge => edge.target === node.id && edge.targetHandle === 'context');
      const date = new Date().toISOString();
      const entries: PresetEntry[] = [];
      const system = String(config.systemPrompt ?? '');
      if (system.trim()) entries.push({ id: randomUUID(), name: 'Main prompt', enabled: true, kind: 'message',
        role: 'system', content: system, placement: { mode: 'ordered' } });
      if (history) entries.push({ id: randomUUID(), name: 'History', enabled: true, kind: 'slot', key: 'history', dataType: 'messages', role: 'user' });
      entries.push({ id: randomUUID(), name: 'Message', enabled: true, kind: 'slot', key: 'message', dataType: 'text', role: 'user' });
      if (context) entries.push({ id: randomUUID(), name: 'Context', enabled: true, kind: 'slot', key: 'context', dataType: 'text', role: 'user' });
      const template = String(config.promptTemplate ?? '');
      if (template.trim()) entries.splice(history ? 2 : 1, 0, { id: randomUUID(), name: 'Legacy prompt template', enabled: true,
        kind: 'message', role: 'user', content: template, placement: { mode: 'ordered' } });
      const preset: Preset = { id: randomUUID(), name: `${workflow.name} — ${node.id}`, entries, createdAt: date, updatedAt: date };
      await presets.save(preset);
      node.config = { provider: 'openrouter', model: config.model ?? 'openai/gpt-4o-mini', presetId: preset.id,
        temperature: config.temperature ?? 0.7, maxTokens: config.maxTokens ?? 1024 };
      for (const edge of workflow.edges.filter(edge => edge.target === node.id)) {
        if (edge.targetHandle === 'prompt') edge.targetHandle = 'message';
      }
      if (!workflow.edges.some(edge => edge.target === node.id && edge.targetHandle === 'message')) {
        const input = workflow.nodes.find(candidate => candidate.type === 'chat-input');
        if (input) workflow.edges.push({ id: randomUUID(), source: input.id, sourceHandle: 'message', target: node.id, targetHandle: 'message' });
      }
      if (history && !workflow.edges.some(edge => edge.target === node.id && edge.targetHandle === 'history')) {
        const input = workflow.nodes.find(candidate => candidate.type === 'chat-input');
        if (input) workflow.edges.push({ id: randomUUID(), source: input.id, sourceHandle: 'history', target: node.id, targetHandle: 'history' });
      }
      dirty = true;
      changed.push(`${workflow.name}: ${node.id} → ${preset.name}`);
    }
    if (dirty) { workflow.updatedAt = new Date().toISOString(); await workflows.save(workflow); }
  }
  return changed;
}

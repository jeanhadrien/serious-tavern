import { pruneInvalidEdges } from '@st/engine';
import { now, type AppContext } from '../context.js';

/** Drops the server-owned `source` from a client preset body, so no write can set or change it. */
export function withoutSource<T extends object>(fields: T): Omit<T, 'source'> {
  const { source: _source, ...rest } = fields as T & { source?: unknown };
  return rest;
}

/** Drops workflow edges into preset inputs that no longer exist, for every workflow whose LLM nodes use the preset. */
export async function pruneWorkflowsUsingPreset(
  { workflows, presets, characters }: Pick<AppContext, 'workflows' | 'presets' | 'characters'>,
  presetId: string,
): Promise<void> {
  for (const workflow of await workflows.list()) {
    if (!workflow.nodes.some((node) => node.type === 'llm' && node.config.presetId === presetId)) continue;
    const pruned = await pruneInvalidEdges(workflow, { presets, characters });
    if (pruned.edges.length !== workflow.edges.length)
      await workflows.update(workflow.id, (old) => ({ ...old, edges: pruned.edges, updatedAt: now() }));
  }
}
